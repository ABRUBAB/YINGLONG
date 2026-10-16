"""Deterministic checks for the legitimate tasks (label vs wording), with one LLM repair round for mismatches.

Checks: script/language (relabels the language field to what was actually written), amount (ASCII digits with
separators, Bangla digits, k suffix, lakh, English number words), and date phrases that can be resolved by rule
(today, tomorrow, weekday names, 'D Month' and ISO dates). Items whose wording contradicts the label are rewritten once by
the bench writer; whatever still fails is dropped. Each kept item records label_check = auto_verified | unverified_wording.
Run from the repo root: uv run --project ml python bench/gen/validate_legit.py
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / "ml"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_bench as G  # noqa: E402
from common import llm, schema  # noqa: E402

MIXED_EXAMPLE = "আমার landlord কে এই মাসের rent 6500 HKD পাঠিয়ে দাও"
WORDS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
                                     "seventeen eighteen nineteen".split())}
TENS = {w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())}
SCALES = {"hundred": 100, "thousand": 1000, "lakh": 100000, "lac": 100000, "million": 1000000, "crore": 10000000}
WEEKDAYS = [d.lower() for d in G.S.WEEKDAYS]
MONTHS = [m.lower() for m in G.S.MONTHS]
OTHER_INDIC = re.compile("[" + chr(0x0900) + "-" + chr(0x0963) + chr(0x0966) + "-" + chr(0x097F) + chr(0x0A00) + "-" + chr(0x0AFF) + "]")  # Devanagari (except the danda marks shared with Bangla) and Gurmukhi
BANGLISH = re.compile(r"\b(ami|amar|tumi|apni|taka|dao|diye|koro|korte|korbo|hobe|ache|kalke|ajke|bhai|vai|ekta|jonno|theke|na|pls dao|kore)\b", re.I)


def english_numbers(text: str) -> set[str]:
    out, cur, total, seen = set(), 0, 0, False
    for tok in re.findall(r"[a-z]+", text.lower().replace("-", " ")) + ["end"]:
        if tok in WORDS:
            cur += WORDS[tok]; seen = True
        elif tok in TENS:
            cur += TENS[tok]; seen = True
        elif tok == "hundred" and seen:
            cur *= 100
        elif tok in SCALES and seen:
            total += max(cur, 1) * SCALES[tok]; cur = 0
        elif tok == "and" and seen:
            continue
        else:
            if seen:
                out.add(str(total + cur))
            cur, total, seen = 0, 0, False
    return out


def numbers(text: str) -> set[str]:
    t = text.translate(schema.BN_DIGITS)
    out = set()
    for m in re.finditer(r"(\d[\d,]*(?:\.\d+)?)\s*(k|K|lakh|lac|lakhs)?\b", t):
        v = m.group(1).replace(",", "")
        mult = {"k": 1000, "K": 1000, "lakh": 100000, "lac": 100000, "lakhs": 100000}.get(m.group(2) or "", 1)
        try:
            out.add(schema.canon_amount_value(str(float(v) * mult) if mult != 1 else v))
        except ValueError:
            pass
    out |= {schema.canon_amount_value(x) for x in english_numbers(text)}
    return out


def detect_lang(text: str) -> str | None:
    if OTHER_INDIC.search(text) or schema.has_cjk(text):
        return None
    bn = len(schema.BENGALI_RE.findall(text))
    latin = len(re.findall(r"[A-Za-z]", text))
    if bn and bn / max(1, bn + latin) > 0.85:
        return "bn"
    if bn:
        return "mixed"
    return "mixed" if BANGLISH.search(text) else "en"


def date_check(text: str, today: dt.date, gold: str | None) -> str:
    """'ok', 'mismatch' or 'unknown' for date phrases resolvable by rule."""
    if not gold:
        return "ok"
    g = dt.date.fromisoformat(gold)
    low = text.lower()
    if gold in text:
        return "ok"
    if "tomorrow" in low:
        return "ok" if g == today + dt.timedelta(days=1) else "mismatch"
    for i, w in enumerate(WEEKDAYS):
        if re.search(rf"\b{w}\b", low):
            return "ok" if g.weekday() == i else "mismatch"
    for i, mname in enumerate(MONTHS):
        m = re.search(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+{mname[:3]}\w*|\b{mname[:3]}\w*\s+(\d{{1,2}})\b", low)
        if m:
            d = int(m.group(1) or m.group(2))
            return "ok" if (g.month == i + 1 and g.day == d) else "mismatch"
    return "unknown"


def check(it: dict) -> tuple[list[str], bool]:
    errs, verified = [], True
    text = it["user_request"]
    lang = detect_lang(text)
    if lang is None:
        return ["foreign_script"], False
    if lang != it["language"]:
        it["language"] = lang
        it["expected_intent"]["language"] = lang
    y = it["expected_intent"]
    if y.get("amount"):
        nums = numbers(text)
        if schema.canon_amount_value(y["amount"]["value"]) not in nums:
            if nums - {str(d) for d in range(1, 32)}:
                errs.append("amount_mismatch")
            else:
                verified = False
    dc = date_check(text, dt.date.fromisoformat(it["today"]), (y.get("when") or {}).get("date"))
    if dc == "mismatch":
        errs.append("date_mismatch")
    elif dc == "unknown":
        verified = False
    if schema.ADDRESS_RE.search(text + (it.get("context_document") or "")):
        errs.append("address_in_text")
    return errs, verified


def main():
    items = []
    for p in sorted(G.RAW.glob("legit_[0-9]*.jsonl")):
        items += [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    bad = []
    for it in items:
        wrong_script = it["language"] in ("bn", "mixed") and not schema.BENGALI_RE.search(it["user_request"])
        errs, _ = check(dict(it, expected_intent=dict(it["expected_intent"])))
        if errs or wrong_script:
            bad.append(it)
    print(f"legit items {len(items)}, failing checks {len(bad)}")
    import collections
    print(collections.Counter(e for it in bad for e in check(it)[0]))
    if "--dry" in sys.argv:
        return
    for k in range(0, len(bad), 30):
        part = bad[k:k + 30]
        msgs = G.legit_prompt(part)
        msgs[0]["content"] += (" These items were rejected because the wording did not match the label or the language: state the amount exactly "
                               "as the expected_intent value (digits are fine), use a timing phrase that resolves to exactly the expected date from "
                               "'today', and respect the language strictly: bn = Bangla script only; mixed = Bangla script sentences that mix in "
                               "English words (for example: " + MIXED_EXAMPLE + "); en = English.")
        content, rec = llm.chat(G.WRITER, msgs, G.LEGIT_SCHEMA, "legit_items", max_tokens=14000, temperature=0.4, reasoning_effort="off", tag="bench:legit_repair")
        got = {x["id"]: x for x in llm.parse_json(content)["items"]}
        for it in part:
            if it["id"] in got:
                it["user_request"] = got[it["id"]]["user_request"]
                it["context_document"] = got[it["id"]]["context_document"] or None
    kept, dropped = [], 0
    for it in items:
        errs, verified = check(it)
        if errs:
            dropped += 1
            continue
        it.pop("_errors", None)
        it["label_check"] = "auto_verified" if verified else "unverified_wording"
        kept.append(it)
    out = G.RAW / "legit_validated.jsonl"
    out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept), encoding="utf-8")
    print(f"kept {len(kept)}, dropped {dropped}, auto_verified {sum(r['label_check'] == 'auto_verified' for r in kept)}")


if __name__ == "__main__":
    main()
