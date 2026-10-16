"""Prompt builders shared by M4 training, evaluation and serving (one source of truth)."""
from __future__ import annotations

import datetime as dt

from .intent_sampler import WEEKDAYS, payee_book_text

INTENT_KEYS = ["kind", "payee", "amount", "category", "when", "conditions", "ambiguities", "language"]
RULE_KEYS = ["type", "payee", "category", "amount", "period", "date", "day_of_month", "max_risk_class"]

SYSTEM_INTENT = (
    "You are the YINGLONG intent parser. Convert the user's wallet message into ONE JSON object with keys "
    "kind, payee, amount, category, when, conditions, ambiguities, language. "
    "kind: pay|convert|escrow|sweep|schedule|query_balance|query_activity|query_forecast|change_mandate|add_payee|pause|unknown. "
    "payee: a PayeeBook id, NEW_PAYEE_REQUEST for anyone not in the PayeeBook, or null. Never output an address. "
    "amount: {{value: decimal string with ASCII digits exactly as stated, unit: tHKD|tUSD|USDC|CNY}} or null; no currency conversion; "
    "if no unit is stated use the payee's unit, else the default unit. "
    "when: {{date: YYYY-MM-DD resolved against today or null, recurrence: none|weekly|monthly}}. "
    "conditions: short snake_case tags. ambiguities: missing_amount|missing_payee|missing_date|conflicting_instructions|unknown_payee|unclear_unit. "
    "language: en|bn|zh|mixed. Output JSON only.\n"
    "Today: {today} ({weekday}). Default unit: {unit}.\nPayeeBook: {book}"
)

SYSTEM_MANDATE = (
    "You are the YINGLONG mandate drafter. Convert the user's rules into ONE JSON object {{rules: [...], ambiguities: [...], language}}. "
    "Each rule has keys type, payee, category, amount, period, date, day_of_month, max_risk_class. "
    "type: payee_payment|category_budget|reserve_floor|deadline_payment|approval_threshold|new_payee_requires_approval|velocity|suitability|jurisdiction. "
    "payee: a PayeeBook id or null; never an address. amount: {{value: decimal string, unit: tHKD|tUSD|USDC|CNY}} or null "
    "(velocity: value is the number of payments). period: day|week|month|null. Unused fields are null. "
    "language: en|bn|zh|mixed. Output JSON only.\n"
    "Today: {today} ({weekday}). Default unit: {unit}.\nPayeeBook: {book}"
)


def system_prompt(task: str, sc: dict, today: str) -> str:
    d = dt.date.fromisoformat(today)
    tpl = SYSTEM_INTENT if task == "intent" else SYSTEM_MANDATE
    return tpl.format(today=today, weekday=WEEKDAYS[d.weekday()], unit=sc["default_unit"], book=payee_book_text(sc))


def ordered(obj: dict, task: str) -> dict:
    """Stable key order for targets."""
    if task == "intent":
        o = {k: obj.get(k) for k in INTENT_KEYS}
        if isinstance(o["amount"], dict):
            o["amount"] = {"value": o["amount"]["value"], "unit": o["amount"]["unit"]}
        w = o["when"] or {}
        o["when"] = {"date": w.get("date"), "recurrence": w.get("recurrence", "none")}
        return o
    return {"rules": [{k: r.get(k) for k in RULE_KEYS} for r in obj["rules"]], "ambiguities": obj.get("ambiguities", []), "language": obj.get("language")}


def messages(task: str, sc: dict, today: str, text: str) -> list[dict]:
    return [{"role": "system", "content": system_prompt(task, sc, today)}, {"role": "user", "content": text}]
