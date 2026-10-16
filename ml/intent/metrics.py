"""M4 metrics: JSON validity, canonical exact match, slot-level micro F1, Wilson 95% intervals."""
from __future__ import annotations

import json
import math
import re

from common import schema


def wilson(k: int, n: int, z: float = 1.959964) -> list[float]:
    if n == 0:
        return [0.0, 0.0]
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]


def parse_output(text: str):
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b < a:
        return None
    try:
        return json.loads(text[a:b + 1])
    except Exception:  # noqa: BLE001
        return None


def slots(obj: dict | None, task: str) -> set:
    if not isinstance(obj, dict):
        return set()
    s = set()
    try:
        if task == "intent":
            for k in ("kind", "payee", "category", "language"):
                if obj.get(k) is not None:
                    s.add((k, str(obj[k])))
            a = obj.get("amount")
            if isinstance(a, dict):
                s.add(("amount.value", schema.canon_amount_value(a.get("value", ""))))
                s.add(("amount.unit", str(a.get("unit"))))
            w = obj.get("when") or {}
            if isinstance(w, dict):
                if w.get("date"):
                    s.add(("when.date", str(w["date"])))
                if w.get("recurrence") not in (None, "none"):
                    s.add(("when.recurrence", str(w["recurrence"])))
            for t in obj.get("conditions") or []:
                s.add(("condition", str(t)))
            for t in obj.get("ambiguities") or []:
                s.add(("ambiguity", str(t)))
        else:
            if obj.get("language"):
                s.add(("language", str(obj["language"])))
            for t in obj.get("ambiguities") or []:
                s.add(("ambiguity", str(t)))
            seen: dict[str, int] = {}
            for r in sorted(obj.get("rules") or [], key=lambda r: json.dumps(r, sort_keys=True, default=str)):
                if not isinstance(r, dict):
                    continue
                t = str(r.get("type"))
                i = seen[t] = seen.get(t, -1) + 1
                s.add((f"rule:{t}#{i}", "present"))
                for k in ("payee", "category", "period", "date", "day_of_month", "max_risk_class"):
                    if r.get(k) is not None:
                        s.add((f"rule:{t}#{i}.{k}", str(r[k])))
                a = r.get("amount")
                if isinstance(a, dict):
                    s.add((f"rule:{t}#{i}.amount.value", schema.canon_amount_value(a.get("value", ""))))
                    s.add((f"rule:{t}#{i}.amount.unit", str(a.get("unit"))))
    except Exception:  # noqa: BLE001
        return set()
    return s


def score(rows: list[dict]) -> dict:
    """rows: {task, language, gold, pred_text, payee_ids} -> metrics overall / per task / per language."""
    def agg(rs):
        n = len(rs)
        valid = em = 0
        tp = fp = fn = 0
        for r in rs:
            pred = parse_output(r["pred_text"])
            ok = pred is not None and not schema.validate(pred, r["task"], r.get("payee_ids"))
            valid += ok
            g = schema.canonical(r["gold"], r["task"])
            if ok and schema.canonical(pred, r["task"]) == g:
                em += 1
            gs, ps = slots(r["gold"], r["task"]), slots(pred, r["task"])
            tp += len(gs & ps)
            fp += len(ps - gs)
            fn += len(gs - ps)
        prec = tp / max(1, tp + fp)
        rec = tp / max(1, tp + fn)
        f1 = 2 * prec * rec / max(1e-9, prec + rec)
        return {"n": n, "json_validity": round(valid / max(1, n), 4), "json_validity_ci95": wilson(valid, n),
                "exact_match": round(em / max(1, n), 4), "exact_match_ci95": wilson(em, n),
                "slot_precision": round(prec, 4), "slot_recall": round(rec, 4), "slot_f1": round(f1, 4)}
    out = {"overall": agg(rows)}
    for key in ("task", "language"):
        for v in sorted({r[key] for r in rows}):
            out[f"{key}={v}"] = agg([r for r in rows if r[key] == v])
    return out
