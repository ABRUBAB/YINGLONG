"""Clean, validate and split the generated M4 intent / mandate data.

Input : private HF dataset ABRUBAB/yl-private-data, gen/v1/intent/*.jsonl (written by ml/datagen/kaggle_datagen.py).
Output: private full splits (incl. Chinese) -> YL_WORK_DIR/private/intent_v1 and HF intent/v1/;
        repo copy without Chinese rows -> ml/data/intent/intent_v1_{train,val,test}.jsonl;
        ml/results/intent_data_manifest.json (counts, drop reasons, SHA-256).
Every kept label is validated against the JSON schema (PayeeBook enum) and canonicalised.
"""
from __future__ import annotations

import collections
import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "ml"))
from common import intent_sampler as S  # noqa: E402
from common import keys, prompts, schema  # noqa: E402

HF_REPO = "ABRUBAB/yl-private-data"
OUT = keys.WORK_DIR / "private" / "intent_v1"
REPO_DATA = REPO / "ml" / "data" / "intent"
REFUSAL = re.compile(r"(i'm sorry|i am sorry|i can't|i cannot|as an ai)", re.I)
PREFACE = re.compile(r"^(here is|here's|sure[,!]|certainly[,!]|message:)[^\n]*\n*", re.I)


def clean(t: str) -> str:
    t = re.sub(r"<think>.*?</think>", "", t, flags=re.S).strip()
    t = PREFACE.sub("", t).strip()
    if len(t) > 2 and t[0] in "\"'" and t[-1] == t[0]:
        t = t[1:-1].strip()
    return t


def lang_ok(t: str, lang: str) -> bool:
    bn = len(schema.BENGALI_RE.findall(t))
    cjk = schema.has_cjk(t)
    latin = len(re.findall(r"[A-Za-z]", t))
    letters = bn + latin + (5 if cjk else 0)
    if lang == "zh":
        return cjk and bn == 0
    if cjk:
        return False
    if lang == "bn":
        return bn > 0 and bn / max(1, letters) > 0.5
    if lang == "en":
        return bn == 0
    return latin > 0  # mixed: Bangla script + English, or romanised Bangla


def amount_ok(t: str, spec: dict) -> bool:
    a = spec["label"].get("amount") if spec["task"] == "intent" else None
    if not a:
        return True
    hint = " ".join(spec["hints"])
    norm = t.translate(schema.BN_DIGITS).translate(schema.FW_DIGITS).replace(",", "").replace(" ", "")
    v = a["value"]
    if "plain digits" in hint or "thousands separators" in hint or "Bangla digits" in hint:
        return v in norm or v.rstrip("0").rstrip(".") in norm
    if "k suffix" in hint:
        return re.search(r"\d(\.\d+)?\s*[kK]", t) is not None or v in norm
    return True


def verdict_ok(s: dict, v: dict | None) -> str | None:
    """Round-trip consistency between the sampled label and the extractor verdict (ml/datagen/kaggle_verify.py)."""
    if v is None:
        return "no_verdict"
    if v.get("parse_error"):
        return "verdict_parse_error"
    c = schema.canon_amount_value
    y = s["label"]
    if s["task"] == "intent":
        a = y.get("amount")
        got = v.get("amount")
        if a and (got is None or c(str(got)) != c(a["value"])):
            return "verify_amount_mismatch"
        if "missing_amount" in y["ambiguities"] and got not in (None, "", "null"):
            return "verify_amount_should_be_missing"
        d = (y.get("when") or {}).get("date")
        if d and v.get("date") != d:
            return "verify_date_mismatch"
        if "missing_date" in y["ambiguities"] and v.get("date") not in (None, "", "null"):
            return "verify_date_should_be_missing"
        rec = (y.get("when") or {}).get("recurrence", "none")
        if rec != "none" and v.get("recurrence") != rec:
            return "verify_recurrence_mismatch"
        return None
    gold = {c(r["amount"]["value"]) for r in y["rules"] if r.get("amount") and r["type"] != "velocity"}
    got = {c(str(x)) for x in (v.get("all_amounts") or []) if x is not None}
    if v.get("amount"):
        got.add(c(str(v["amount"])))
    return None if gold <= got else "verify_mandate_amount_missing"


def main():
    from huggingface_hub import HfApi, hf_hub_download
    keys.use_hf("write")
    api = HfApi()
    scen = S.load_scenarios()
    all_files = api.list_repo_files(HF_REPO, repo_type="dataset")
    verdicts = {}
    for f in [f for f in all_files if f.startswith("gen/v1/verify_intent/")]:
        for line in open(hf_hub_download(HF_REPO, f, repo_type="dataset"), encoding="utf-8"):
            r = json.loads(line)
            verdicts[r["id"]] = r["verdict"]
    files = [f for f in all_files if f.startswith("gen/v1/intent/")]
    drops = collections.Counter()
    rows = []
    seen_text = set()
    for f in sorted(files):
        for line in open(hf_hub_download(HF_REPO, f, repo_type="dataset"), encoding="utf-8"):
            s = json.loads(line)
            t = clean(s["text"])
            sc = scen[s["scenario"]]
            ids = [p["id"] for p in sc["payees"]]
            reason = None
            if s["finish"] != "stop" or len(t) < 4:
                reason = "truncated_or_empty"
            elif REFUSAL.search(t[:80]):
                reason = "refusal"
            elif schema.ADDRESS_RE.search(t):
                reason = "address_in_text"
            elif not lang_ok(t, s["language"]):
                reason = "language_mismatch"
            elif not amount_ok(t, s):
                reason = "amount_not_in_text"
            elif schema.validate(s["label"], s["task"], ids):
                reason = "label_schema_error"
            elif t.lower() in seen_text:
                reason = "duplicate_text"
            else:
                reason = verdict_ok(s, verdicts.get(s["id"]))
            if reason:
                drops[reason] += 1
                continue
            seen_text.add(t.lower())
            label = prompts.ordered(schema.canonical(s["label"], s["task"]), s["task"])
            h = int(hashlib.sha1(s["id"].encode()).hexdigest(), 16) % 100
            split = "test" if h < 10 else ("val" if h < 14 else "train")
            rows.append({"id": s["id"], "task": s["task"], "scenario": s["scenario"], "today": s["today"], "language": s["language"],
                         "text": t, "label": label, "split": split, "writer": s["writer"]})
    OUT.mkdir(parents=True, exist_ok=True)
    REPO_DATA.mkdir(parents=True, exist_ok=True)
    stats, sha_private, sha_repo = {}, {}, {}
    for split in ("train", "val", "test"):
        part = [r for r in rows if r["split"] == split]
        p = OUT / f"{split}.jsonl"
        p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in part), encoding="utf-8", newline="\n")
        sha_private[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
        rp = REPO_DATA / f"intent_v1_{split}.jsonl"
        keep = [r for r in part if r["language"] != "zh" and not schema.has_cjk(json.dumps(r, ensure_ascii=False))]
        rp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in keep), encoding="utf-8", newline="\n")
        sha_repo[rp.name] = hashlib.sha256(rp.read_bytes()).hexdigest()
        stats[split] = {"n": len(part), "repo_rows": len(keep), "by_language": dict(collections.Counter(r["language"] for r in part)),
                        "by_task": dict(collections.Counter(r["task"] for r in part)),
                        "by_kind": dict(collections.Counter(r["label"].get("kind", "mandate") for r in part))}
    info = api.upload_folder(folder_path=str(OUT), path_in_repo="intent/v1", repo_id=HF_REPO, repo_type="dataset", commit_message="intent v1 splits")
    manifest = {"version": "intent_v1", "generated": sum(drops.values()) + len(rows), "kept": len(rows), "drops": dict(drops), "stats": stats,
                "private_sha256": sha_private, "repo_sha256": sha_repo, "hf_dataset": HF_REPO, "hf_commit": getattr(info, "oid", None)}
    (REPO / "ml" / "results").mkdir(exist_ok=True)
    (REPO / "ml" / "results" / "intent_data_manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("generated", "kept", "drops")}, indent=1))
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
