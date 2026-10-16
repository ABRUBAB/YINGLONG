"""Synthetic daily ledgers for Lotus Lane Trading and seven sibling SMEs (all fictional, CNY on a simulator rail).

Amounts are integers in fen (CNY base units). Scheduled outflows (payroll on the 25th, supplier invoices with due
dates set when the invoice arrives, utilities, weekly forwarder payments, cloud fees, mid-month sweeps to the HK
subsidiary decided on the 1st) are KNOWN in advance and exposed as future covariates. Receipts, ad-hoc expenses and
credit-line draws are not.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

START, END = dt.date(2023, 10, 1), dt.date(2026, 10, 15)
RESERVE_FLOOR_FEN = 500_000 * 100
COVARIATES = ["payroll_out", "ap_due_out", "utilities_out", "forwarders_out", "cloud_out", "sweep_out", "is_weekend", "is_holiday"]


def holiday(d: dt.date) -> int:
    # fictional calendar approximating the Lunar New Year shutdown and the October Golden Week
    lny = {2024: dt.date(2024, 2, 10), 2025: dt.date(2025, 1, 29), 2026: dt.date(2026, 2, 17)}.get(d.year)
    if lny and -3 <= (d - lny).days <= 10:
        return 1
    return int(d.month == 10 and 1 <= d.day <= 7)


def simulate(company: str, seed: int, scale: float = 1.0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    days = (END - START).days + 1
    dates = [START + dt.timedelta(days=i) for i in range(days)]
    cov = {c: np.zeros(days, dtype=np.int64) for c in COVARIATES}
    receipts = np.zeros(days, dtype=np.int64)
    adhoc = np.zeros(days, dtype=np.int64)
    credit = np.zeros(days, dtype=np.int64)
    bal = np.zeros(days, dtype=np.int64)
    b = int(1_300_000 * 100 * scale)
    growth = 1 + rng.uniform(0.05, 0.15)
    for i, d in enumerate(dates):
        g = growth ** (i / 365)
        cov["is_weekend"][i] = int(d.weekday() >= 5)
        cov["is_holiday"][i] = holiday(d)
        # invoices arriving today become due in 30-45 days (known from arrival)
        for _ in range(rng.poisson(0.35)):
            due = i + int(rng.integers(30, 46))
            if due < days:
                cov["ap_due_out"][due] += int(rng.lognormal(np.log(60_000), 0.6) * 100 * scale * g)
        if d.day == 25:
            cov["payroll_out"][i] = int(380_000 * 100 * scale * g)
        if d.day == 8:
            cov["utilities_out"][i] = int(rng.normal(22_000, 3_000) * 100 * scale)
        if d.weekday() == 2:
            cov["forwarders_out"][i] = int(rng.lognormal(np.log(15_000), 0.3) * 100 * scale)
        if d.day == 3:
            cov["cloud_out"][i] = int(11_000 * 100 * scale)
        # receipts: weekday + month + season + noise, plus occasional large customer payments
        base = 33_500 * scale * g * (0.25 if d.weekday() >= 5 else 1.0) * (0.15 if cov["is_holiday"][i] else 1.0)
        base *= 1.25 if d.day <= 10 else 1.0
        base *= 1.15 if d.month in (10, 11, 12) else 1.0
        r = rng.lognormal(np.log(max(base, 1)), 0.45)
        if rng.random() < 0.06:
            r += rng.lognormal(np.log(350_000 * scale), 0.4)
        receipts[i] = int(r * 100)
        adhoc[i] = int(rng.lognormal(np.log(4_000 * scale), 0.8) * 100) if rng.random() < 0.5 else 0
    for i, d in enumerate(dates):
        if d.day == 15 and i >= 14:
            decided = bal[i - 14]  # decided on the 1st from the balance then; scheduled two weeks ahead
            cov["sweep_out"][i] = max(0, int((decided - 1_100_000 * 100 * scale) * 0.8))
        out = sum(int(cov[c][i]) for c in COVARIATES if c.endswith("_out")) + int(adhoc[i])
        b = b + int(receipts[i]) - out
        if b < 250_000 * 100 * scale:  # automatic credit-line draw (not known in advance)
            credit[i] = int(400_000 * 100 * scale)
            b += int(credit[i])
        bal[i] = b
    df = pd.DataFrame({"item_id": company, "timestamp": pd.to_datetime(dates), "balance_fen": bal, "receipts_fen": receipts,
                       "reserve_floor_fen": int(RESERVE_FLOOR_FEN * scale),
                       "adhoc_fen": adhoc, "credit_draw_fen": credit, **cov})
    return df


def build() -> pd.DataFrame:
    names = ["lotus_lane"] + [f"sibling_{i}" for i in range(1, 8)]
    scales = [1.0, 0.6, 0.8, 1.2, 1.5, 0.7, 1.1, 0.9]
    return pd.concat([simulate(n, 100 + k, s) for k, (n, s) in enumerate(zip(names, scales))], ignore_index=True)


if __name__ == "__main__":
    df = build()
    for n, g in df.groupby("item_id"):
        b = g.balance_fen / 100
        print(n, f"min {b.min():,.0f} median {b.median():,.0f} max {b.max():,.0f} days<floor {(g.balance_fen < g.reserve_floor_fen).mean():.2%} credit draws {(g.credit_draw_fen > 0).sum()}")
