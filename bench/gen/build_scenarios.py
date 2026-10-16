"""Build the two YINGLONG-Bench scenario fixtures (fictional people, firms and test units).

Addresses are deterministic test addresses derived from a hash of the payee id; they hold
no real funds and belong to no real party.
Run from the repo root: uv run --project ml python bench/gen/build_scenarios.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_address(label: str) -> str:
    return "0x" + hashlib.sha256(f"yinglong-testnet:{label}".encode()).hexdigest()[:40]


def rule(type_, payee=None, category=None, amount=None, period=None, date=None, day_of_month=None, max_risk_class=None):
    return {"type": type_, "payee": payee, "category": category, "amount": amount, "period": period,
            "date": date, "day_of_month": day_of_month, "max_risk_class": max_risk_class}


def amt(v, u):
    return {"value": v, "unit": u}


NADIA = {
    "id": "nadia",
    "title": "Nadia, a student from Dhaka studying in Hong Kong",
    "labels": "All parties fictional. tHKD and tUSD are team-minted test units; USDC is testnet USDC.",
    "default_unit": "tHKD",
    "units": ["tHKD", "tUSD", "USDC"],
    "wallet_balance": {"tHKD": "18500", "tUSD": "400", "USDC": "250"},
    "payees": [
        {"id": "harbour_homes", "name": "Harbour Homes Ltd", "aliases": ["landlord", "my landlord", "Harbour Homes", "rent account"], "category": "rent", "unit": "tHKD"},
        {"id": "hbu_bursar", "name": "Harbour Bay University Bursar", "aliases": ["the university", "bursar", "HBU", "tuition office"], "category": "tuition", "unit": "tHKD"},
        {"id": "pearl_river_fx", "name": "Pearl River FX Desk", "aliases": ["FX desk", "Pearl River", "exchange desk"], "category": "treasury", "unit": "tHKD"},
        {"id": "lantern_canteen", "name": "Lantern Canteen", "aliases": ["canteen", "campus canteen", "meal plan"], "category": "food", "unit": "tHKD"},
        {"id": "harbour_transit", "name": "Harbour Transit Card", "aliases": ["transit card", "travel card", "bus and metro card"], "category": "transport", "unit": "tHKD"},
        {"id": "kowloon_power", "name": "Kowloon Power and Water", "aliases": ["utilities", "electricity bill", "power company"], "category": "utilities", "unit": "tHKD"},
        {"id": "rahman_family", "name": "Rahman family (home account)", "aliases": ["my family", "Ammu", "home"], "category": "other", "unit": "tUSD"},
        {"id": "campus_print", "name": "Campus Print and Copy", "aliases": ["print shop", "copy centre"], "category": "services", "unit": "tHKD"},
    ],
    "mandate": {
        "rules": [
            rule("payee_payment", "harbour_homes", "rent", amt("6500", "tHKD"), "month", day_of_month=1),
            rule("category_budget", None, "food", amt("2400", "tHKD"), "month"),
            rule("category_budget", None, "transport", amt("600", "tHKD"), "month"),
            rule("deadline_payment", "hbu_bursar", "tuition", amt("42000", "tHKD"), date="2026-11-30"),
            rule("reserve_floor", amount=amt("3000", "tHKD")),
            rule("approval_threshold", amount=amt("1000", "tHKD")),
            rule("new_payee_requires_approval"),
            rule("velocity", amount=amt("5", "tHKD"), period="day"),
        ],
        "notes": "velocity.amount.value is a count of payments per period (unit ignored).",
    },
}

LOTUS = {
    "id": "lotus_lane",
    "title": "Lotus Lane Trading, a Shenzhen SME with a Hong Kong subsidiary",
    "labels": "All parties fictional. CNY amounts settle on a coin-free consortium rail simulator (no real e-CNY); tHKD and tUSD are test units; USDC is testnet USDC.",
    "default_unit": "CNY",
    "units": ["CNY", "tHKD", "tUSD", "USDC"],
    "wallet_balance": {"CNY": "2450000", "tHKD": "820000", "tUSD": "35000", "USDC": "5000"},
    "payees": [
        {"id": "shenzhen_components", "name": "Shenzhen Components Co.", "aliases": ["components supplier", "SZ Components", "chip supplier"], "category": "supplier", "unit": "CNY"},
        {"id": "dongguan_packaging", "name": "Dongguan Packaging Works", "aliases": ["packaging supplier", "box supplier", "Dongguan Packaging"], "category": "supplier", "unit": "CNY"},
        {"id": "kowloon_forwarders", "name": "Kowloon Forwarders Ltd", "aliases": ["forwarder", "logistics", "freight agent"], "category": "services", "unit": "tHKD"},
        {"id": "staff_payroll", "name": "Lotus Lane staff payroll", "aliases": ["payroll", "salaries", "staff wages"], "category": "payroll", "unit": "CNY"},
        {"id": "pearl_river_fx", "name": "Pearl River FX Desk", "aliases": ["FX desk", "Pearl River", "exchange desk"], "category": "treasury", "unit": "CNY"},
        {"id": "lotus_lane_hk", "name": "Lotus Lane Trading (HK) Ltd treasury", "aliases": ["HK subsidiary", "Hong Kong entity", "HK treasury"], "category": "treasury", "unit": "tHKD"},
        {"id": "bay_cloud_services", "name": "Bay Cloud Services", "aliases": ["cloud provider", "hosting", "Bay Cloud"], "category": "services", "unit": "tUSD"},
        {"id": "nanshan_utilities", "name": "Nanshan Utilities", "aliases": ["utilities", "power bill", "factory electricity"], "category": "utilities", "unit": "CNY"},
    ],
    "mandate": {
        "rules": [
            rule("payee_payment", "shenzhen_components", "supplier", amt("200000", "CNY"), "month"),
            rule("payee_payment", "dongguan_packaging", "supplier", amt("80000", "CNY"), "month"),
            rule("payee_payment", "staff_payroll", "payroll", amt("380000", "CNY"), "month", day_of_month=25),
            rule("payee_payment", "kowloon_forwarders", "services", amt("60000", "tHKD"), "month"),
            rule("reserve_floor", amount=amt("500000", "CNY")),
            rule("approval_threshold", amount=amt("100000", "CNY")),
            rule("new_payee_requires_approval"),
            rule("velocity", amount=amt("12", "CNY"), period="day"),
            rule("suitability", "pearl_river_fx", "treasury", max_risk_class=2),
            rule("jurisdiction", "lotus_lane_hk", "treasury", amt("1000000", "tHKD"), "month"),
        ],
        "notes": "velocity.amount.value is a count of payments per period (unit ignored). jurisdiction caps cross-border sweeps to the HK subsidiary.",
    },
}

if __name__ == "__main__":
    for sc in (NADIA, LOTUS):
        for p in sc["payees"]:
            p["address"] = test_address(f"{sc['id']}:{p['id']}")
        sc["agent_address"] = test_address(f"{sc['id']}:agent")
        out = ROOT / "scenarios" / f"{sc['id']}.json"
        out.write_text(json.dumps(sc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("wrote", out.name, len(sc["payees"]), "payees")
