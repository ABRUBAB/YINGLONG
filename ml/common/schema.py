"""Intent and MandateDraft JSON schemas, canonicalisation and validation.

The intent model can never emit an address: payee is an enum of PayeeBook ids,
NEW_PAYEE_REQUEST or null, and the validator rejects any 0x-hex string anywhere.
Amounts are decimal strings (never floats); canonical form has ASCII digits,
no separators and no trailing fractional zeros.
"""
from __future__ import annotations

import copy
import json
import re
from decimal import Decimal, InvalidOperation

import jsonschema

KINDS = ["pay", "convert", "escrow", "sweep", "schedule", "query_balance", "query_activity",
         "query_forecast", "change_mandate", "add_payee", "pause", "unknown"]
UNITS = ["tHKD", "tUSD", "USDC", "CNY"]
CATEGORIES = ["rent", "food", "tuition", "transport", "utilities", "services", "supplier", "payroll", "treasury", "other"]
AMBIGUITIES = ["missing_amount", "missing_payee", "missing_date", "conflicting_instructions", "unknown_payee", "unclear_unit"]
LANGS = ["en", "bn", "zh", "mixed"]
RULE_TYPES = ["payee_payment", "category_budget", "reserve_floor", "deadline_payment", "approval_threshold",
              "new_payee_requires_approval", "velocity", "suitability", "jurisdiction"]
CONDITION_TAGS = ["before_date", "after_date", "after_enrolment_confirmed", "after_invoice_verified", "after_goods_received",
                  "if_balance_above_reserve", "if_rate_below_limit", "if_rate_above_limit", "on_salary_day", "after_approval",
                  "split_into_instalments", "only_if_unpaid"]

AMOUNT = {"type": ["object", "null"], "additionalProperties": False, "required": ["value", "unit"],
          "properties": {"value": {"type": "string", "pattern": r"^[0-9]+(\.[0-9]+)?$"}, "unit": {"enum": UNITS}}}
DATE = {"type": ["string", "null"], "pattern": r"^\d{4}-\d{2}-\d{2}$"}


def intent_schema(payee_ids: list[str] | None = None) -> dict:
    payee = {"type": ["string", "null"], "pattern": r"^[a-z][a-z0-9_]*$|^NEW_PAYEE_REQUEST$"}
    if payee_ids is not None:
        payee = {"enum": list(payee_ids) + ["NEW_PAYEE_REQUEST", None]}
    return {
        "type": "object", "additionalProperties": False,
        "required": ["kind", "payee", "amount", "category", "when", "conditions", "ambiguities", "language"],
        "properties": {
            "kind": {"enum": KINDS},
            "payee": payee,
            "amount": AMOUNT,
            "category": {"enum": CATEGORIES + [None]},
            "when": {"type": "object", "additionalProperties": False, "required": ["date", "recurrence"],
                     "properties": {"date": DATE, "recurrence": {"enum": ["none", "weekly", "monthly"]}}},
            "conditions": {"type": "array", "items": {"type": "string", "pattern": r"^[a-z][a-z0-9_]*$"}, "maxItems": 4},
            "ambiguities": {"type": "array", "items": {"enum": AMBIGUITIES}, "maxItems": 6},
            "language": {"enum": LANGS},
        },
    }


def mandate_schema(payee_ids: list[str] | None = None) -> dict:
    payee = {"type": ["string", "null"], "pattern": r"^[a-z][a-z0-9_]*$"}
    if payee_ids is not None:
        payee = {"enum": list(payee_ids) + [None]}
    rule = {
        "type": "object", "additionalProperties": False,
        "required": ["type", "payee", "category", "amount", "period", "date", "day_of_month", "max_risk_class"],
        "properties": {
            "type": {"enum": RULE_TYPES}, "payee": payee, "category": {"enum": CATEGORIES + [None]},
            "amount": AMOUNT, "period": {"enum": ["day", "week", "month", None]}, "date": DATE,
            "day_of_month": {"type": ["integer", "null"], "minimum": 1, "maximum": 31},
            "max_risk_class": {"type": ["integer", "null"], "minimum": 1, "maximum": 5},
        },
    }
    return {"type": "object", "additionalProperties": False, "required": ["rules", "ambiguities", "language"],
            "properties": {"rules": {"type": "array", "items": rule, "minItems": 0, "maxItems": 8},
                           "ambiguities": {"type": "array", "items": {"enum": AMBIGUITIES}},
                           "language": {"enum": LANGS}}}


ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{6,}")
BN_DIGITS = {ord(c): str(i) for i, c in enumerate("০১২৩৪৫৬৭৮৯")}
FW_DIGITS = {0xFF10 + i: str(i) for i in range(10)}  # full-width digits, mapped by code point


def canon_amount_value(v: str) -> str:
    s = str(v).translate(BN_DIGITS).translate(FW_DIGITS).replace(",", "").replace("_", "").replace(" ", "")
    try:
        d = Decimal(s)
    except InvalidOperation:
        return s
    if d == d.to_integral_value():
        return str(d.quantize(Decimal(1)))
    return format(d.normalize(), "f")


def canonical(obj: dict, kind: str = "intent") -> dict:
    """Canonical form used for exact-match scoring and for training labels."""
    o = copy.deepcopy(obj)

    def fix_amount(a):
        if isinstance(a, dict) and "value" in a:
            a["value"] = canon_amount_value(a["value"])
        return a

    if kind == "intent":
        o["amount"] = fix_amount(o.get("amount"))
        o["conditions"] = sorted(set(o.get("conditions") or []))
        o["ambiguities"] = sorted(set(o.get("ambiguities") or []))
    else:
        for r in o.get("rules", []):
            r["amount"] = fix_amount(r.get("amount"))
        o["rules"] = sorted(o.get("rules", []), key=lambda r: json.dumps(r, sort_keys=True))
        o["ambiguities"] = sorted(set(o.get("ambiguities") or []))
    return o


def validate(obj: dict, kind: str = "intent", payee_ids: list[str] | None = None) -> list[str]:
    schema = intent_schema(payee_ids) if kind == "intent" else mandate_schema(payee_ids)
    errs = [e.message for e in jsonschema.Draft202012Validator(schema).iter_errors(obj)]
    if ADDRESS_RE.search(json.dumps(obj)):
        errs.append("address-like string present")
    return errs


def dumps(obj: dict) -> str:
    """Compact, key-ordered serialisation used as the model's target text."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


_CJK_RANGES = [(0x3000, 0x303F), (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xFF00, 0xFFEF)]
CJK_RE = re.compile("[" + "".join(f"{chr(a)}-{chr(b)}" for a, b in _CJK_RANGES) + "]")
BENGALI_RE = re.compile("[ঀ-৿]")


def has_cjk(s: str) -> bool:
    return bool(CJK_RE.search(s))
