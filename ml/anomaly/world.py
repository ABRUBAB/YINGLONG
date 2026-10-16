"""Synthetic agent-action world for M3 (behaviour anomaly).

Many simulated wallets of two archetypes (student like Nadia, SME like Lotus Lane) produce one year of
agent-executed payments. Anomaly families are injected with known labels. Amounts are integers in base units
(cents / fen); features are derived floats. All data is synthetic.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import math
from collections import defaultdict, deque

import numpy as np
import pandas as pd

FAMILIES = ["duplicate_payment", "split_payment", "lookalike_address", "velocity_burst", "inflated_invoice",
            "x402_drain", "new_payee_large", "dormant_reactivation", "address_swap"]
HELDOUT = "address_swap"  # mirrors the bench held-out family (memory implant -> payee address change)

STUDENT = {  # payee: (kind, mean amount, rel sd, schedule)
    "harbour_homes": ("monthly", 6500, 0.0, 1), "lantern_canteen": ("daily", 65, 0.5, 2.0), "harbour_transit": ("weekly", 180, 0.4, 1),
    "kowloon_power": ("monthly", 420, 0.3, 12), "rahman_family": ("monthly", 1500, 0.4, 20), "campus_print": ("poisson", 60, 0.6, 0.08),
    "pearl_river_fx": ("poisson", 2500, 0.5, 0.05), "rate_api": ("x402", 0.3, 0.3, 3.0),
}
SME = {
    "shenzhen_components": ("poisson", 90000, 0.6, 0.15), "dongguan_packaging": ("poisson", 30000, 0.5, 0.1), "kowloon_forwarders": ("weekly", 18000, 0.4, 3),
    "staff_payroll": ("monthly", 380000, 0.03, 25), "nanshan_utilities": ("monthly", 22000, 0.3, 8), "bay_cloud_services": ("monthly", 1600, 0.2, 3),
    "lotus_lane_hk": ("poisson", 400000, 0.5, 0.08), "credit_api": ("x402", 2.0, 0.3, 4.0),
}
THRESHOLD = {"student": 1000, "sme": 100000}


def addr(seed: str) -> str:
    return "0x" + hashlib.sha256(seed.encode()).hexdigest()[:40]


def lookalike_score(a: str, known: list[str]) -> float:
    best = 0
    for k in known:
        if k == a:
            return 0.0
        p = 0
        while p < 40 and a[2 + p] == k[2 + p]:
            p += 1
        s = 0
        while s < 40 and a[-1 - s] == k[-1 - s]:
            s += 1
        best = max(best, p + s)
    return min(1.0, best / 12)


def simulate_wallet(wid: str, archetype: str, rng: np.random.Generator, start: dt.date, days: int, anomaly_rate: float):
    book = STUDENT if archetype == "student" else SME
    scale = float(rng.lognormal(0, 0.15))
    events = []
    addresses = {p: addr(f"{wid}:{p}") for p in book}
    for d in range(days):
        day = start + dt.timedelta(days=d)
        for p, (kind, mean, sd, sched) in book.items():
            n = 0
            if kind == "monthly":
                n = 1 if day.day == sched else 0
            elif kind == "weekly":
                n = 1 if day.weekday() == (sum(map(ord, p)) % 5) else 0
            elif kind == "daily":
                n = rng.poisson(sched)
            elif kind == "poisson":
                n = rng.poisson(sched * (0.4 if day.weekday() >= 5 and archetype == "sme" else 1))
            elif kind == "x402":
                n = rng.poisson(sched)
            for _ in range(n):
                amt = mean * scale * (1 if sd == 0 else float(rng.lognormal(0, sd)))
                if kind == "monthly" and p == "harbour_homes":
                    amt = 6500
                hour = (rng.integers(9, 12) if kind in ("monthly", "weekly") else
                        rng.integers(8, 22) if archetype == "student" else rng.integers(9, 19))
                ts = dt.datetime.combine(day, dt.time(int(hour), int(rng.integers(0, 60)), int(rng.integers(0, 60))))
                events.append({"wallet": wid, "archetype": archetype, "ts": ts, "payee": p, "amount": max(1, int(round(amt * 100))),
                               "channel": "x402" if kind == "x402" else ("scheduled" if kind in ("monthly", "weekly") else "agent"),
                               "address": addresses[p], "family": "normal",
                               # normal invoice-driven payments also originate from untrusted documents (emails, invoices)
                               "untrusted_origin": int(kind in ("poisson", "monthly") and rng.random() < 0.3)})
        if rng.random() < 0.002:  # rare legitimate address rotation by a known payee (keeps address changes non-trivial)
            p = rng.choice([x for x in book if not x.endswith("_api")])
            addresses[p] = addr(f"{wid}:{p}:rot{d}")
    events.sort(key=lambda e: e["ts"])
    # inject anomalies
    n_anom = max(1, int(len(events) * anomaly_rate))
    known = list(addresses.values())
    thr = THRESHOLD[archetype] * 100
    for _ in range(n_anom):
        fam = FAMILIES[int(rng.integers(0, len(FAMILIES)))]
        base = events[int(rng.integers(0, len(events)))]
        if base["family"] != "normal":
            continue
        t0 = base["ts"]
        new = []
        if fam == "duplicate_payment":
            new.append(dict(base, ts=t0 + dt.timedelta(hours=float(rng.uniform(0.2, 60))), family=fam))
        elif fam == "split_payment":
            k = int(rng.integers(3, 7))
            dest = addr(f"split:{wid}:{t0}") if rng.random() < 0.6 else base["address"]
            for j in range(k):
                new.append(dict(base, ts=t0 + dt.timedelta(minutes=float(rng.uniform(1, 90))), amount=int(thr * rng.uniform(0.85, 0.99)),
                                payee="new" if dest != base["address"] else base["payee"], address=dest, channel="agent", untrusted_origin=1, family=fam))
        elif fam == "lookalike_address":
            real = base["address"]
            k = int(rng.integers(4, 7))
            fake = real[:2 + k] + hashlib.md5(str(rng.random()).encode()).hexdigest()[: 40 - 2 * k] + real[-k:]
            new.append(dict(base, ts=t0 + dt.timedelta(hours=float(rng.uniform(1, 30))), address=fake, payee="new", untrusted_origin=int(rng.random() < 0.7), family=fam))
        elif fam == "velocity_burst":
            hour = int(rng.choice([1, 2, 3, 4, 23]))
            tb = dt.datetime.combine(t0.date(), dt.time(hour, 0))
            for j in range(int(rng.integers(8, 20))):
                p = rng.choice(list(book))
                new.append(dict(base, ts=tb + dt.timedelta(minutes=float(rng.uniform(0, 30))), payee=p, address=addresses[p],
                                amount=int(base["amount"] * rng.uniform(0.3, 1.2)), channel="agent", family=fam))
        elif fam == "inflated_invoice":
            new.append(dict(base, ts=t0 + dt.timedelta(hours=float(rng.uniform(1, 72))), amount=int(base["amount"] * rng.uniform(1.3, 2.5)), untrusted_origin=1, family=fam))
        elif fam == "x402_drain":
            api = [p for p in book if p.endswith("_api")][0]
            mean = book[api][1] * 100
            mult = rng.choice([1, 10, 30])
            for j in range(int(rng.integers(20, 80)) if mult == 1 else int(rng.integers(3, 10))):
                new.append(dict(base, ts=t0 + dt.timedelta(minutes=float(rng.uniform(0, 60))), payee=api, address=addresses[api],
                                amount=int(mean * mult * rng.uniform(0.8, 1.2)), channel="x402", untrusted_origin=1, family=fam))
        elif fam == "new_payee_large":
            new.append(dict(base, ts=t0 + dt.timedelta(hours=float(rng.uniform(1, 48))), payee="new", address=addr(f"np:{wid}:{t0}"),
                            amount=int(thr * rng.uniform(0.9, 3.0)), channel="agent", untrusted_origin=1, family=fam))
        elif fam == "dormant_reactivation":
            new.append(dict(base, ts=t0 + dt.timedelta(days=float(rng.uniform(1, 5))), payee="dormant_" + base["payee"], address=addr(f"dorm:{wid}:{t0}"),
                            amount=int(base["amount"] * rng.uniform(1.0, 3.0)), channel="agent", family=fam, dormant=1))
        elif fam == "address_swap":
            new.append(dict(base, ts=t0 + dt.timedelta(hours=float(rng.uniform(1, 72))), address=addr(f"swap:{wid}:{t0}"), untrusted_origin=int(rng.random() < 0.3), family=fam))
        events.extend(new)
    events.sort(key=lambda e: e["ts"])
    return events, known


def featurise(events: list[dict], archetype: str) -> pd.DataFrame:
    thr = THRESHOLD[archetype] * 100
    hist_amt = defaultdict(list)
    last_ts: dict[str, dt.datetime] = {}
    payee_addr: dict[str, str] = {}
    addr_first: dict[str, dt.datetime] = {}
    win1h, win24h = deque(), deque()
    same_payee_24h = defaultdict(deque)
    x402_1h = deque()
    sub_thr_24h = deque()
    rows = []
    for e in events:
        ts = e["ts"]
        for w, span in ((win1h, 3600), (win24h, 86400), (x402_1h, 3600)):
            while w and (ts - w[0]).total_seconds() > span:
                w.popleft()
        while sub_thr_24h and (ts - sub_thr_24h[0][0]).total_seconds() > 86400:
            sub_thr_24h.popleft()
        sp = same_payee_24h[e["payee"]]
        while sp and (ts - sp[0][0]).total_seconds() > 86400:
            sp.popleft()
        h = hist_amt[e["payee"]]
        med = float(np.median(h[-30:])) if h else 0.0
        mad = float(np.median(np.abs(np.array(h[-30:]) - med))) + 1.0 if h else 1.0
        known_payee = e["payee"] in payee_addr or (bool(h) and not e["payee"].startswith(("new", "dormant_")))
        addr_changed = int(e["payee"] in payee_addr and payee_addr[e["payee"]] != e["address"])
        a_age = (ts - addr_first[e["address"]]).total_seconds() / 86400 if e["address"] in addr_first else 0.0
        since = (ts - last_ts[e["payee"]]).total_seconds() if e["payee"] in last_ts else 1e7
        dup = int(any(abs(a - e["amount"]) <= max(1, e["amount"] // 1000) for t, a in sp))
        is_sub = int(0.8 * thr <= e["amount"] < thr)
        rows.append({
            "wallet": e["wallet"], "archetype": archetype, "ts": ts, "payee": e["payee"], "amount": e["amount"], "family": e["family"],
            "f_log_amount": math.log1p(e["amount"]), "f_amount_rz": (e["amount"] - med) / mad if h else 0.0,
            "f_amount_ratio_med": e["amount"] / med if med else 0.0, "f_amount_over_thr": e["amount"] / thr,
            "f_hour": ts.hour, "f_weekday": ts.weekday(), "f_night": int(ts.hour < 6 or ts.hour >= 23),
            "f_log_since_same_payee": math.log1p(since), "f_n_same_payee_24h": len(sp), "f_dup_amount_24h": dup,
            "f_n_1h": len(win1h), "f_n_24h": len(win24h), "f_x402": int(e["channel"] == "x402"), "f_x402_1h": len(x402_1h),
            "f_sub_thr": is_sub, "f_sub_thr_24h": sum(x for _, x in sub_thr_24h) + is_sub, "f_new_payee": int(not known_payee),
            "f_addr_changed": addr_changed, "f_log_addr_age": math.log1p(a_age), "f_untrusted": e.get("untrusted_origin", 0),
            "f_scheduled": int(e["channel"] == "scheduled"),
            "f_payee_hist_n": len(h),
        })
        hist_amt[e["payee"]].append(e["amount"])
        last_ts[e["payee"]] = ts
        if e["family"] == "normal" or e["family"] == "address_swap":
            payee_addr.setdefault(e["payee"], e["address"])
        if e["family"] == "normal":
            payee_addr[e["payee"]] = e["address"]
        addr_first.setdefault(e["address"], ts)
        win1h.append(ts)
        win24h.append(ts)
        sp.append((ts, e["amount"]))
        if e["channel"] == "x402":
            x402_1h.append(ts)
        sub_thr_24h.append((ts, is_sub))
    return pd.DataFrame(rows)


def build(n_students=60, n_smes=30, days=365, anomaly_rate=0.015, seed=7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    frames = []
    start = dt.date(2025, 10, 1)
    for i in range(n_students + n_smes):
        arch = "student" if i < n_students else "sme"
        wid = f"{arch}-{i:03d}"
        ev, known = simulate_wallet(wid, arch, rng, start, days, anomaly_rate)
        df = featurise(ev, arch)
        df["f_lookalike"] = [lookalike_score(e["address"], known) for e in ev]
        frames.append(df)
    return pd.concat(frames, ignore_index=True)

