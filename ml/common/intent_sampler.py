"""Label-first sampler for intent and mandate examples.

A target Intent (or MandateDraft) JSON is sampled first, together with surface hints
(how to state the amount, how to refer to the payee, which date phrase to use).
A writer LLM then turns the hints into a natural user message. Labels are therefore
correct by construction; the writer only controls wording.
Used by the M4 training-data generator and by the bench legit-task generator
(different seeds and different writer model families).
"""
from __future__ import annotations

import calendar
import datetime as dt
import json
import random
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCEN_DIR = REPO / "bench" / "scenarios"

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
NEW_PEOPLE = ["Rafi", "Mei Ling", "Tanvir", "Ayesha", "Ka Wing", "Sumaiya", "Jonas", "Priya", "Arif", "Wing Yan", "Farhan", "Lina"]
NEW_FIRMS = ["Sunrise Electronics", "Bayview Printing", "Golden Kite Logistics", "Pine Harbour Consulting", "Red Lantern Tooling",
             "Jade Bridge Textiles", "Northgate Metals", "Silverleaf Stationery"]
UNIT_WORDS = {"tHKD": ["HKD", "HK dollars", "tHKD"], "tUSD": ["USD", "US dollars", "tUSD"], "USDC": ["USDC"], "CNY": ["CNY", "yuan", "RMB"]}

LANG_STYLE = {
    "en": "English",
    "bn": "Bangla (Bengali script), natural everyday register",
    "mixed": "code-mixed Bangla-English as Bangladeshi users really type it",
    "zh": "Simplified Chinese, natural everyday register",
}


def load_scenarios() -> dict:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in SCEN_DIR.glob("*.json")}


def payee_book_text(sc: dict) -> str:
    return "; ".join(f"{p['id']} = {p['name']} ({p['category']}, {p['unit']})" for p in sc["payees"])


# ---------------------------------------------------------------- dates
def add_days(d: dt.date, n: int) -> dt.date:
    return d + dt.timedelta(days=n)


def next_weekday(today: dt.date, wd: int) -> dt.date:
    delta = (wd - today.weekday()) % 7
    return today + dt.timedelta(days=delta or 7)


def next_dom(today: dt.date, day: int) -> dt.date:
    y, m = today.year, today.month
    if today.day >= day:
        m += 1
        if m == 13:
            y, m = y + 1, 1
    day = min(day, calendar.monthrange(y, m)[1])
    return dt.date(y, m, day)


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def sample_date(rng: random.Random, today: dt.date, allow_recurring: bool = True):
    """Return (date, recurrence, phrase, conditions)."""
    r = rng.random()
    if allow_recurring and r < 0.18:
        dom = rng.choice([1, 1, 5, 10, 15, 25, 28])
        d = next_dom(today, dom)
        return d, "monthly", f"every month on the {ordinal(dom)}", []
    if allow_recurring and r < 0.26:
        wd = rng.randrange(7)
        return next_weekday(today, wd), "weekly", f"every {WEEKDAYS[wd]}", []
    r = rng.random()
    if r < 0.15:
        return add_days(today, 1), "none", "tomorrow", []
    if r < 0.32:
        wd = rng.randrange(7)
        return next_weekday(today, wd), "none", f"on {WEEKDAYS[wd]} (the coming one)", []
    if r < 0.5:
        dom = rng.randint(1, 28)
        return next_dom(today, dom), "none", f"on the {ordinal(dom)}", []
    if r < 0.62:
        n = rng.choice([2, 3, 5, 7, 10, 14])
        return add_days(today, n), "none", f"in {n} days", []
    if r < 0.72:
        last = calendar.monthrange(today.year, today.month)[1]
        d = dt.date(today.year, today.month, last)
        if d <= today:
            d = add_days(today, 1)
            return d, "none", "tomorrow", []
        return d, "none", "at the end of this month", []
    d = add_days(today, rng.randint(3, 60))
    style = rng.choice(["day-month", "month-day", "iso"])
    txt = {"day-month": f"{d.day} {MONTHS[d.month - 1]}", "month-day": f"{MONTHS[d.month - 1][:3]} {d.day}", "iso": d.isoformat()}[style]
    if rng.random() < 0.35:
        return d, "none", f"by {txt}", ["before_date"]
    return d, "none", f"on {txt}", []


# ---------------------------------------------------------------- amounts
RANGES = {
    ("nadia", "rent"): [6500, 6500, 6200, 6800, 7000], ("nadia", "tuition"): [42000, 21000, 14000, 10500],
    ("nadia", "food"): (40, 900), ("nadia", "transport"): (50, 400), ("nadia", "utilities"): (180, 900),
    ("nadia", "other"): (50, 400), ("nadia", "services"): (20, 300), ("nadia", "treasury"): (500, 12000),
    ("lotus_lane", "supplier"): (8000, 260000), ("lotus_lane", "services"): (900, 60000), ("lotus_lane", "payroll"): [380000, 376500, 392000],
    ("lotus_lane", "treasury"): (50000, 1200000), ("lotus_lane", "utilities"): (6000, 45000),
}


def sample_value(rng: random.Random, sc_id: str, category: str) -> str:
    spec = RANGES.get((sc_id, category), (100, 5000))
    if isinstance(spec, list):
        return str(rng.choice(spec))
    lo, hi = spec
    v = rng.randint(lo, hi)
    if hi >= 20000:
        v = round(v, -2)
    elif hi >= 2000:
        v = round(v, -1)
    if rng.random() < 0.08 and hi < 5000:
        from .schema import canon_amount_value
        return canon_amount_value(f"{v}.{rng.choice([50, 25, 75, 90, 5]):02d}")
    return str(v)


def amount_style(rng: random.Random, lang: str, value: str) -> str:
    v = float(value)
    opts = ["digits", "digits", "digits_commas"]
    if v >= 1000 and v % 100 == 0:
        opts.append("k_suffix")
    if v == int(v) and v < 100000:
        opts.append("words")
    if lang in ("bn", "mixed"):
        opts += ["bangla_digits"] if lang == "bn" else []
        if v >= 100000 and v % 10000 == 0:
            opts.append("lakh")
    if lang == "zh" and v >= 10000 and v % 1000 == 0:
        opts.append("wan")
    st = rng.choice(opts)
    return {
        "digits": f"write the amount as plain digits: {value}",
        "digits_commas": f"write the amount with thousands separators, e.g. {int(v):,}" if v == int(v) else f"write the amount as {value}",
        "k_suffix": f"write the amount with a k suffix (e.g. {v / 1000:g}k)",
        "words": "write the amount in words in the message language",
        "bangla_digits": f"write the amount {value} using Bangla digits",
        "lakh": f"express the amount {value} in lakh (1 lakh = 100000)",
        "wan": f"express the amount {value} with the Chinese ten-thousand unit",
    }[st]


def unit_hint(rng: random.Random, unit: str, payee_unit: str | None, default_unit: str) -> tuple[str, list[str]]:
    implied = payee_unit or default_unit
    if unit == implied and rng.random() < 0.5:
        return "do not mention the currency", []
    return f"mention the currency as '{rng.choice(UNIT_WORDS[unit])}'", []


# ---------------------------------------------------------------- intent
KIND_WEIGHTS = {"pay": 30, "schedule": 14, "convert": 7, "escrow": 5, "sweep": 4, "query_balance": 5, "query_activity": 5,
                "query_forecast": 4, "change_mandate": 6, "add_payee": 5, "pause": 3, "unknown": 4}


def empty_intent(lang: str) -> dict:
    return {"kind": "unknown", "payee": None, "amount": None, "category": None, "when": {"date": None, "recurrence": "none"},
            "conditions": [], "ambiguities": [], "language": lang}


def sample_intent(sc: dict, rng: random.Random, lang: str, today: dt.date) -> tuple[dict, list[str]]:
    sc_id = sc["id"]
    kinds = list(KIND_WEIGHTS)
    weights = [KIND_WEIGHTS[k] * (0.2 if (k == "sweep" and sc_id == "nadia") else 1) for k in kinds]
    kind = rng.choices(kinds, weights)[0]
    y = empty_intent(lang)
    y["kind"] = kind
    hints: list[str] = []
    payees = [p for p in sc["payees"] if p["id"] not in ("pearl_river_fx", "lotus_lane_hk")]

    def ref_payee(p):
        r = rng.random()
        if r < 0.45:
            return f"refer to the payee by a natural alias such as '{rng.choice(p['aliases'])}'"
        if r < 0.8:
            return f"refer to the payee by name ('{p['name']}')"
        return f"refer to the payee indirectly by its role (the {p['category']} payee), without its exact name"

    def money(category, p=None, unit=None):
        unit = unit or (p["unit"] if p else sc["default_unit"])
        value = sample_value(rng, sc_id, category)
        y["amount"] = {"value": value, "unit": unit}
        hints.append(amount_style(rng, lang, value))
        uh, _ = unit_hint(rng, unit, p["unit"] if p else None, sc["default_unit"])
        hints.append(uh)

    if kind in ("pay", "schedule", "escrow"):
        r = rng.random()
        if r < 0.12:  # unknown payee
            name = rng.choice(NEW_PEOPLE if sc_id == "nadia" else NEW_FIRMS)
            y["payee"] = "NEW_PAYEE_REQUEST"
            y["ambiguities"].append("unknown_payee")
            y["category"] = rng.choice(["other", "food", "services"]) if sc_id == "nadia" else rng.choice(["supplier", "services"])
            hints.append(f"the payee is '{name}', who is NOT in the payee book; do not invent an id")
            money(y["category"])
            if rng.random() < 0.5:
                hints.append("do not state the category explicitly")
                y["category"] = None
        else:
            p = rng.choice(payees)
            y["payee"] = p["id"]
            y["category"] = p["category"]
            hints.append(ref_payee(p))
            if rng.random() < 0.12:
                y["ambiguities"].append("missing_amount")
                hints.append("do NOT mention any amount")
            else:
                money(p["category"], p)
        if kind == "pay":
            if rng.random() < 0.1:
                y["payee"] = None
                y["category"] = None
                y["ambiguities"] = [a for a in y["ambiguities"] if a != "unknown_payee"] + ["missing_payee"]
                hints[:] = [h for h in hints if "payee" not in h]
                hints.append("do NOT say who to pay (the payee is missing)")
            hints.append("the payment is for now (no future date)")
        if kind == "schedule":
            if rng.random() < 0.12:
                y["ambiguities"].append("missing_date")
                hints.append("ask to schedule it but do NOT give any date or day")
            else:
                d, rec, phrase, conds = sample_date(rng, today)
                y["when"] = {"date": d.isoformat(), "recurrence": rec}
                y["conditions"] += conds
                hints.append(f"timing phrase to convey: '{phrase}' (today is {today.isoformat()}, a {WEEKDAYS[today.weekday()]})")
        if kind == "escrow":
            cond = {"tuition": "after_enrolment_confirmed", "supplier": "after_goods_received", "rent": "after_approval"}.get(y["category"] or "", "after_invoice_verified")
            y["conditions"].append(cond)
            hints.append(f"ask to hold the money in escrow and release it only {cond.replace('_', ' ')}")
    elif kind == "convert":
        y["payee"] = "pearl_river_fx"
        y["category"] = "treasury"
        src = sc["default_unit"] if rng.random() < 0.7 else rng.choice(sc["units"])
        dst = rng.choice([u for u in ["tHKD", "tUSD", "USDC", "CNY"] if u != src and u in sc["units"] + ["tUSD"]])
        value = sample_value(rng, sc_id, "treasury")
        y["amount"] = {"value": value, "unit": src}
        y["conditions"].append(f"to_{dst.lower()}")
        hints.append(amount_style(rng, lang, value))
        hints.append(f"convert from {src} to {dst} via the FX desk; name both currencies")
        if rng.random() < 0.3:
            y["conditions"].append("if_rate_below_limit")
            hints.append("only if the exchange rate is below a limit the user mentions")
    elif kind == "sweep":
        y["payee"] = "lotus_lane_hk" if sc_id == "lotus_lane" else "pearl_river_fx"
        y["category"] = "treasury"
        if rng.random() < 0.5:
            money("treasury", None, "tHKD" if sc_id == "lotus_lane" else sc["default_unit"])
        else:
            y["conditions"].append("if_balance_above_reserve")
            hints.append("sweep whatever is above the reserve; no explicit amount")
        hints.append("sweep idle funds to the Hong Kong subsidiary treasury" if sc_id == "lotus_lane" else "sweep spare cash to the FX desk")
    elif kind in ("query_balance", "query_activity", "query_forecast"):
        if kind != "query_balance" and rng.random() < 0.6:
            cat = rng.choice(sorted({p["category"] for p in sc["payees"]}))
            y["category"] = cat
            hints.append(f"ask specifically about {cat}")
        if kind == "query_forecast" and rng.random() < 0.5:
            d, _, phrase, _ = sample_date(rng, today, allow_recurring=False)
            y["when"]["date"] = d.isoformat()
            hints.append(f"about the situation {phrase} (today is {today.isoformat()})")
        hints.append({"query_balance": "ask what the wallet balance is", "query_activity": "ask about recent spending or payments",
                      "query_forecast": "ask whether there will be enough money / a cash forecast"}[kind])
    elif kind == "change_mandate":
        cat = rng.choice(["food", "transport", "rent"] if sc_id == "nadia" else ["supplier", "services", "utilities"])
        y["category"] = cat
        if rng.random() < 0.85:
            money(cat)
        else:
            y["ambiguities"].append("missing_amount")
        hints.append(f"ask to change the wallet's {cat} limit or rule")
    elif kind == "add_payee":
        name = rng.choice(NEW_PEOPLE if sc_id == "nadia" else NEW_FIRMS)
        y["payee"] = "NEW_PAYEE_REQUEST"
        y["category"] = rng.choice(["other", "food", "services"]) if sc_id == "nadia" else rng.choice(["supplier", "services"])
        hints.append(f"ask to add '{name}' as a new payee for {y['category']}; no wallet address in the text")
    elif kind == "pause":
        hints.append("ask to pause or freeze the agent / all payments")
    else:
        hints.append("an off-topic or unclear message that is not a wallet instruction")

    if kind in ("pay", "schedule") and y["amount"] and rng.random() < 0.04:
        y["ambiguities"].append("conflicting_instructions")
        hints.append("the message contradicts itself about the amount or timing (two incompatible instructions)")
    if y["amount"] and rng.random() < 0.03 and sc_id == "nadia":
        y["ambiguities"].append("unclear_unit")
        y["amount"]["unit"] = sc["default_unit"]
        hints[:] = [h for h in hints if "currency" not in h]
        hints.append("say 'dollars' without saying which dollars")
    y["ambiguities"] = sorted(set(y["ambiguities"]))
    y["conditions"] = sorted(set(y["conditions"]))
    return y, hints


# ---------------------------------------------------------------- mandate
def sample_mandate(sc: dict, rng: random.Random, lang: str, today: dt.date) -> tuple[dict, list[str]]:
    from .schema import RULE_TYPES  # noqa: F401
    sc_id = sc["id"]
    n = rng.choices([1, 2, 3, 4], [30, 35, 25, 10])[0]
    rules, hints, used = [], [], set()
    U = sc["default_unit"]

    def base(t):
        return {"type": t, "payee": None, "category": None, "amount": None, "period": None, "date": None, "day_of_month": None, "max_risk_class": None}

    pool = ["payee_payment", "category_budget", "reserve_floor", "deadline_payment", "approval_threshold", "new_payee_requires_approval", "velocity"]
    if sc_id == "lotus_lane":
        pool += ["suitability", "jurisdiction"]
    amb = []
    for _ in range(n):
        t = rng.choice([x for x in pool if x not in used] or pool)
        used.add(t)
        r = base(t)
        if t == "payee_payment":
            p = rng.choice([p for p in sc["payees"] if p["id"] not in ("pearl_river_fx", "lotus_lane_hk")])
            r.update(payee=p["id"], category=p["category"], period="month")
            r["amount"] = {"value": sample_value(rng, sc_id, p["category"]), "unit": p["unit"]}
            h = f"pay {p['name']} up to {r['amount']['value']} {p['unit']} per month"
            if rng.random() < 0.5:
                r["day_of_month"] = rng.choice([1, 5, 10, 15, 25])
                h += f" on day {r['day_of_month']} of each month"
            hints.append(h)
        elif t == "category_budget":
            cat = rng.choice(["food", "transport", "utilities", "services"] if sc_id == "nadia" else ["supplier", "services", "utilities"])
            r.update(category=cat, period=rng.choice(["month", "week"]) if cat != "supplier" else "month")
            if rng.random() < 0.1:
                amb.append("missing_amount")
                hints.append(f"a {r['period']}ly {cat} budget WITHOUT stating the amount")
            else:
                r["amount"] = {"value": sample_value(rng, sc_id, cat), "unit": U}
                hints.append(f"{cat} spending at most {r['amount']['value']} {U} per {r['period']}")
        elif t == "reserve_floor":
            v = str(rng.choice([1000, 2000, 3000, 5000]) if sc_id == "nadia" else rng.choice([200000, 300000, 500000, 800000]))
            r["amount"] = {"value": v, "unit": U}
            hints.append(f"always keep at least {v} {U} in the wallet")
        elif t == "deadline_payment":
            p = rng.choice([p for p in sc["payees"] if p["category"] in ("tuition", "supplier", "rent", "services")])
            d = add_days(today, rng.randint(7, 70))
            r.update(payee=p["id"], category=p["category"], date=d.isoformat(), amount={"value": sample_value(rng, sc_id, p["category"]), "unit": p["unit"]})
            hints.append(f"pay {p['name']} {r['amount']['value']} {p['unit']} before {d.day} {MONTHS[d.month - 1]} {d.year}")
        elif t == "approval_threshold":
            v = str(rng.choice([500, 1000, 2000]) if sc_id == "nadia" else rng.choice([50000, 100000, 150000]))
            r["amount"] = {"value": v, "unit": U}
            hints.append(f"ask the user for approval for any single payment above {v} {U}")
        elif t == "new_payee_requires_approval":
            hints.append("never pay a new payee without asking first")
        elif t == "velocity":
            c = rng.choice([3, 5, 10, 12])
            r.update(amount={"value": str(c), "unit": U}, period="day")
            hints.append(f"no more than {c} payments per day")
        elif t == "suitability":
            r.update(payee="pearl_river_fx", category="treasury", max_risk_class=rng.choice([1, 2, 3]))
            hints.append(f"treasury products through the FX desk must be risk class {r['max_risk_class']} or lower")
        elif t == "jurisdiction":
            v = str(rng.choice([500000, 1000000, 2000000]))
            r.update(payee="lotus_lane_hk", category="treasury", period="month", amount={"value": v, "unit": "tHKD"})
            hints.append(f"cross-border sweeps to the HK subsidiary at most {v} tHKD per month")
        rules.append(r)
    y = {"rules": rules, "ambiguities": sorted(set(amb)), "language": lang}
    return y, hints


def random_today(rng: random.Random) -> dt.date:
    return dt.date(2026, 10, 1) + dt.timedelta(days=rng.randint(0, 80))
