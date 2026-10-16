"""Automatic quality report for the bench files (counts only; nothing is edited). Writes bench/QUALITY.json.
Known generator artefacts are counted so readers can judge the data: scenario-brief text echoed into attack content,
stray Devanagari characters inside Bangla text, missing attacker addresses, and legit tasks whose wording could not be
verified by rule. Run from the repo root: uv run --project ml python bench/gen/quality_report.py
"""
from __future__ import annotations

import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEV = re.compile("[" + chr(0x0900) + "-" + chr(0x0963) + chr(0x0966) + "-" + chr(0x097F) + "]")
ECHO = ("with a Hong Kong subsidiary; pays suppliers", "wallet in tHKD test units; pays rent")


def main():
    rep = {"attacks": {}, "legit": {}}
    for f in sorted((ROOT / "attacks").glob("*.jsonl")):
        rows = [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
        c = collections.Counter()
        for r in rows:
            t = r["untrusted_content"] + " " + r["user_task"]
            c["items"] += 1
            c["scenario_brief_echo"] += any(e in t for e in ECHO)
            c["devanagari_glitch"] += bool(DEV.search(t))
            c["attacker_address_present"] += bool(r["attacker"].get("address")) and r["attacker"]["address"] in t
            c["lang_" + r["language"]] += 1
        rep["attacks"][f.stem] = dict(c)
    legit = [json.loads(l) for l in (ROOT / "tasks" / "legit.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    rep["legit"] = {"items": len(legit), "label_check": dict(collections.Counter(r.get("label_check") for r in legit)),
                    "languages": dict(collections.Counter(r["language"] for r in legit)),
                    "tier_hints": dict(collections.Counter(r["expected_tier_hint"] for r in legit)),
                    "with_context_document": sum(bool(r.get("context_document")) for r in legit),
                    "devanagari_glitch": sum(bool(DEV.search(r["user_request"] + (r.get("context_document") or ""))) for r in legit)}
    tot = collections.Counter()
    for v in rep["attacks"].values():
        tot.update(v)
    rep["attacks_total"] = dict(tot)
    (ROOT / "QUALITY.json").write_text(json.dumps(rep, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(rep["attacks_total"], indent=1), json.dumps(rep["legit"], indent=1))


if __name__ == "__main__":
    main()
