"""Assemble the M1 sentinel dataset (binary: 1 = injection / malicious, 0 = benign).

Sources (licences in ml/THIRD_PARTY.md):
  * neuralchemy/Prompt-injection-dataset, config "full" (Apache-2.0): train/validation/test kept as published.
  * deepset/prompt-injections (Apache-2.0): train/test kept as published.
  * DAMO-NLP-SG/MultiJail (MIT): en and bn rows (+ zh rows in the private copy) as label 1, kind "jailbreak";
    split by question id so all languages of one question share a split.
  * YINGLONG finance synthetic set (Qwen-family writer, generated on Kaggle): label-first specs, split by spec id.
  * nvidia/Nemotron-RL-Agentic-Indirect-Prompt-Injection-v1 (CC-BY-4.0): EVALUATION ONLY (external indirect-injection
    test). It is excluded from training because the bench attacks were written by the same model family (authorship separation).
The YINGLONG-Bench held-out family (memory_implant) is never used for training; a guard below refuses any row whose
text overlaps the held-out file.

Outputs:
  * private full set (incl. Chinese rows) -> YL_WORK_DIR/private/sentinel_v1/{train,validation,test,ext_nvidia}.jsonl,
    uploaded to the private HF dataset ABRUBAB/yl-private-data under sentinel/v1/.
  * repo copy WITHOUT Chinese rows -> ml/data/sentinel/finance_synth_v1.jsonl (finance synthetic part only, en/bn/mixed).
"""
from __future__ import annotations

import collections
import hashlib
import json
import random
import re
import sys
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "ml"))
from common import keys, schema  # noqa: E402

PUB = keys.WORK_DIR / "dl" / "public"
OUT = keys.WORK_DIR / "private" / "sentinel_v1"
REPO_DATA = REPO / "ml" / "data" / "sentinel"
HF_REPO = "ABRUBAB/yl-private-data"

REFUSAL = re.compile(r"^(i'm sorry|i am sorry|i can't|i cannot|sorry,|as an ai)", re.I)
PREFACE = re.compile(r"^(here is|here's|sure[,!]|certainly[,!])[^\n]*\n+", re.I)


BANGLISH = re.compile(r"\b(ami|amar|tumi|apni|apnar|taka|dao|diye|koro|korte|korbo|hobe|ache|kalke|ajke|bhai|ekta|jonno|theke|kore|korun|dite|pathao)\b", re.I)


def lang_of(text: str) -> str:
    """en / bn / mixed (Bangla script with >= 10% Latin letters, or romanised Bangla) / zh."""
    if schema.has_cjk(text):
        return "zh"
    bn = len(schema.BENGALI_RE.findall(text))
    latin = len(re.findall(r"[A-Za-z]", re.sub(r"0x[0-9a-fA-F]+", "", text)))
    if bn:
        return "mixed" if latin / (bn + latin) >= 0.10 else "bn"
    return "mixed" if len(BANGLISH.findall(text)) >= 2 else "en"


def row(text, label, source, kind, split, lang=None, rid=None, channel=None):
    text = str(text).strip()
    return {"id": rid or hashlib.sha1(f"{source}|{text}".encode()).hexdigest()[:16], "text": text, "label": int(label), "source": source,
            "kind": kind, "language": lang or lang_of(text), "channel": channel or "prompt", "split": split}


def public_rows() -> list[dict]:
    rows = []
    base = PUB / "neuralchemy__Prompt-injection-dataset" / "full"
    for split, name in (("train", "train"), ("validation", "validation"), ("test", "test")):
        df = pd.read_parquet(base / f"{name}-00000-of-00001.parquet")
        for t, l, c in zip(df.text, df.label, df.category):
            rows.append(row(t, l, "neuralchemy", str(c) if l else "benign", split))
    base = PUB / "deepset__prompt-injections" / "data"
    for f in base.glob("*.parquet"):
        split = "test" if f.name.startswith("test") else "train"
        df = pd.read_parquet(f)
        for t, l in zip(df.text, df.label):
            rows.append(row(t, l, "deepset", "direct_injection" if l else "benign", split))
    df = pd.read_csv(PUB / "DAMO-NLP-SG__MultiJail" / "MultiJail.csv")
    rng = random.Random(7)
    for _, r in df.iterrows():
        split = rng.choices(["train", "validation", "test"], [70, 10, 20])[0]
        for lang in ("en", "bn", "zh"):
            if isinstance(r[lang], str) and r[lang].strip():
                rows.append(row(r[lang], 1, "multijail", "jailbreak", split, lang=lang, rid=f"mj-{r['id']}-{lang}"))
    return rows


def nvidia_rows() -> list[dict]:
    rows = []
    path = PUB / "nvidia__Nemotron-RL-Agentic-Indirect-Prompt-Injection-v1" / "train.jsonl"
    rng = random.Random(11)
    for line in path.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        inj = r["injection"]["injection_text"]
        vec = r["injection"]["vector"]
        benign_pool, poisoned = [], None

        def walk(o, key=""):
            nonlocal poisoned
            if isinstance(o, dict):
                for k, v in o.items():
                    walk(v, k)
            elif isinstance(o, list):
                for v in o:
                    walk(v, key)
            elif isinstance(o, str) and len(o) > 60:
                if inj[:40] in o:
                    poisoned = o
                elif key == vec or len(o) > 120:
                    benign_pool.append(o)
        walk(r["environment"])
        if poisoned:
            rows.append(row(poisoned, 1, "nvidia_ipi", f"indirect_{r['attack_category']}", "ext_test", channel=f"{r['domain']}:{vec}"))
        if benign_pool:
            rows.append(row(rng.choice(benign_pool), 0, "nvidia_ipi", "benign_tool_output", "ext_test", channel=f"{r['domain']}:benign"))
    return rows


def synth_rows() -> list[dict]:
    from huggingface_hub import HfApi, hf_hub_download
    keys.use_hf("read")
    api = HfApi()
    all_files = api.list_repo_files(HF_REPO, repo_type="dataset")
    files = [f for f in all_files if f.startswith("gen/v1/sentinel/")]
    verdicts = {}
    for f in [f for f in all_files if f.startswith("gen/v1/verify_sentinel/")]:
        for line in open(hf_hub_download(HF_REPO, f, repo_type="dataset"), encoding="utf-8"):
            r = json.loads(line)
            verdicts[r["id"]] = r["verdict"]
    rows, dropped = [], collections.Counter()
    for f in files:
        p = hf_hub_download(HF_REPO, f, repo_type="dataset")
        for line in open(p, encoding="utf-8"):
            s = json.loads(line)
            t = re.sub(r"<think>.*?</think>", "", s["text"], flags=re.S).strip()
            t = PREFACE.sub("", t).strip().strip('"').strip()
            if s["finish"] != "stop" or len(t) < 8:
                dropped["truncated_or_empty"] += 1
                continue
            if REFUSAL.search(t):
                dropped["refusal"] += 1
                continue
            if s["label"] == 1 and s.get("attacker_address") and "address" in s["attack"] and s["attacker_address"] not in t:
                dropped["missing_attacker_address"] += 1
                continue
            if s["label"] == 0 and re.search(r"0x[0-9a-fA-F]{40}", t) and (not s.get("include_on_file_address") or s["include_on_file_address"] not in t):
                dropped["benign_with_unknown_address"] += 1
                continue
            det = lang_of(t)
            if (s["language"] == "zh") != (det == "zh") or (s["language"] == "en" and det != "en"):
                dropped["language_mismatch"] += 1
                continue
            s["language"] = det if s["language"] in ("bn", "mixed") else s["language"]  # mixed requested but pure Bangla written -> bn
            v = verdicts.get(s["id"])
            if v is None or "malicious" not in v:
                dropped["no_verdict"] += 1
                continue
            if bool(v["malicious"]) != bool(s["label"]):
                dropped["judge_disagrees_with_label"] += 1
                continue
            h = int(hashlib.sha1(s["id"].encode()).hexdigest(), 16) % 100
            split = "train" if h < 75 else ("validation" if h < 85 else "test")
            kind = ("finance_" + s["channel"]) if s["label"] else ("finance_benign_" + s["channel"])
            rows.append(row(t, s["label"], "yl_finance_synth", kind, split, lang=s["language"], rid=s["id"], channel=s["channel"]))
    print("synthetic dropped:", dict(dropped))
    return rows


def heldout_guard(rows: list[dict]):
    held = [json.loads(l) for l in (REPO / "bench" / "attacks" / "heldout.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    probes = {h["untrusted_content"][:60] for h in held if len(h.get("untrusted_content", "")) >= 60}
    bad = [r for r in rows if any(p in r["text"] for p in probes)]
    assert not bad, f"{len(bad)} rows overlap the held-out family"


def main():
    pub, nv, syn = public_rows(), nvidia_rows(), synth_rows()
    rows = pub + syn + nv
    heldout_guard(rows)
    seen, uniq = set(), []
    for r in rows:  # exact-duplicate removal across splits (keep first, test sets win by order below)
        key = (r["text"].lower(), r["split"] == "ext_test")
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    # drop train rows whose text also appears in validation/test
    eval_texts = {r["text"].lower() for r in uniq if r["split"] in ("validation", "test")}
    uniq = [r for r in uniq if not (r["split"] == "train" and r["text"].lower() in eval_texts)]
    OUT.mkdir(parents=True, exist_ok=True)
    stats = {}
    for split in ("train", "validation", "test", "ext_test"):
        part = [r for r in uniq if r["split"] == split]
        with open(OUT / f"{split}.jsonl", "w", encoding="utf-8", newline="\n") as f:
            for r in part:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        stats[split] = {"n": len(part), "pos": sum(r["label"] for r in part),
                        "by_lang": dict(collections.Counter(r["language"] for r in part)),
                        "by_source": dict(collections.Counter(r["source"] for r in part))}
    hashes = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(OUT.glob("*.jsonl"))}
    manifest = {"version": "sentinel_v1", "stats": stats, "sha256": hashes}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    # repo copy: finance synthetic, no Chinese
    REPO_DATA.mkdir(parents=True, exist_ok=True)
    keep = [r for r in uniq if r["source"] == "yl_finance_synth" and r["language"] != "zh" and not schema.has_cjk(r["text"])]
    with open(REPO_DATA / "finance_synth_v1.jsonl", "w", encoding="utf-8", newline="\n") as f:
        for r in keep:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    # upload private full set
    from huggingface_hub import HfApi
    keys.use_hf("write")
    info = HfApi().upload_folder(folder_path=str(OUT), path_in_repo="sentinel/v1", repo_id=HF_REPO, repo_type="dataset", commit_message="sentinel v1 splits")
    manifest["hf_commit"] = getattr(info, "oid", None) or str(info)
    manifest["repo_copy"] = {"file": "ml/data/sentinel/finance_synth_v1.jsonl", "rows": len(keep),
                             "sha256": hashlib.sha256((REPO_DATA / "finance_synth_v1.jsonl").read_bytes()).hexdigest()}
    (REPO / "ml" / "results").mkdir(exist_ok=True)
    (REPO / "ml" / "results" / "sentinel_data_manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
