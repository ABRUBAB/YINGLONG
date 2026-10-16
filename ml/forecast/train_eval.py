"""M5 cash-flow forecaster on synthetic Lotus Lane ledgers (CPU).

Methods (same origins, same horizon H=28 days, same quantile levels):
  * chronos2     : amazon/chronos-2 zero-shot with KNOWN future covariates (scheduled outflows, calendar flags)
  * lgbm_quantile: LightGBM 4.x direct multi-horizon quantile regression on the balance change, with the same covariates
  * seasonal_naive: repeat the balance change of 28 days earlier + empirical residual quantiles per horizon
Metrics on test origins: mean pinball loss (CNY and scaled by mean |balance|), 90% interval coverage (raw and after
split-conformal CQR adjustment fitted on calibration origins), Brier score of "reserve breach within 14 days"
(raw and isotonic-calibrated on calibration origins), with the climatology Brier for reference.
Writes ml/results/m5_forecast.json.  Run from ml/: uv run python forecast/train_eval.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from forecast import ledger  # noqa: E402

H, BREACH_H, CTX = 28, 14, 512
QS = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]
ML = HERE.parent


def origins(df_item: pd.DataFrame):
    n = len(df_item)
    test = list(range(n - H - 1, n - H - 1 - 270, -7))[::-1]
    calib = list(range(test[0] - 7, test[0] - 7 - 182, -7))[::-1]
    train = list(range(CTX // 2, calib[0] - H))
    return train, calib, test


def lgbm_rows(g: pd.DataFrame, idx: list[int]):
    b = g.balance_fen.to_numpy() / 100.0
    net = np.diff(b, prepend=b[0])
    covs = {c: g[c].to_numpy() / (100.0 if c.endswith("_out") else 1.0) for c in ledger.COVARIATES}
    dom = g.timestamp.dt.day.to_numpy(); dow = g.timestamp.dt.weekday.to_numpy()
    X, Y, meta = [], [], []
    for t in idx:
        base = [b[t], net[t - 6:t + 1].mean(), net[t - 27:t + 1].mean(), net[t - 27:t + 1].std(), b[t] - b[t - 7], b[t] - b[t - 28]]
        for h in range(1, H + 1):
            sl = slice(t + 1, t + h + 1)
            feat = base + [h, dom[t + h], dow[t + h]] + [covs[c][sl].sum() for c in ledger.COVARIATES] + [covs["is_weekend"][sl].sum()]
            X.append(feat)
            Y.append(b[t + h] - b[t] if t + h < len(b) else np.nan)
            meta.append((t, h))
    return np.array(X, dtype=np.float64), np.array(Y), meta


def pinball(y, q, levels):
    out = []
    for j, a in enumerate(levels):
        d = y - q[..., j]
        out.append(np.maximum(a * d, (a - 1) * d))
    return float(np.mean(out))


def breach_prob(qmat: np.ndarray, floor: float) -> float:
    """qmat [H, len(QS)] balance quantiles; P(min over first BREACH_H days < floor) ~ max_h F_h(floor)."""
    ps = []
    for h in range(BREACH_H):
        qs = np.maximum.accumulate(qmat[h])
        if floor <= qs[0]:
            p = QS[0] * max(0.0, 1 - (qs[0] - floor) / (abs(qs[0]) * 0.5 + 1))
        elif floor >= qs[-1]:
            p = 1.0
        else:
            p = float(np.interp(floor, qs, QS))
        ps.append(p)
    return float(max(ps))


def main():
    t_start = time.time()
    df = ledger.build()
    items = sorted(df.item_id.unique())
    fc = {m: {} for m in ("chronos2", "lgbm_quantile", "seasonal_naive")}  # (item, t) -> [H, Q] balance quantiles
    truth, floors, splits = {}, {}, {}
    # ---------------- LightGBM quantile
    Xtr, Ytr = [], []
    for it in items:
        g = df[df.item_id == it].reset_index(drop=True)
        tr, ca, te = origins(g)
        X, Y, _ = lgbm_rows(g, tr[::2])
        Xtr.append(X); Ytr.append(Y)
    Xtr, Ytr = np.vstack(Xtr), np.concatenate(Ytr)
    ok = ~np.isnan(Ytr)
    models = {}
    for a in QS:
        models[a] = lgb.train({"objective": "quantile", "alpha": a, "learning_rate": 0.05, "num_leaves": 31, "min_data_in_leaf": 50, "verbose": -1, "seed": 0},
                              lgb.Dataset(Xtr[ok], Ytr[ok]), num_boost_round=300)
    t_lgbm = time.time() - t_start
    art = ML / "artifacts" / "m5"
    art.mkdir(parents=True, exist_ok=True)
    for a in QS:
        models[a].save_model(str(art / f"m5_lgbm_q{a}.txt"))
    # ---------------- Chronos-2
    from chronos import Chronos2Pipeline
    pipe = Chronos2Pipeline.from_pretrained("amazon/chronos-2", device_map="cpu")
    ctx_rows, fut_rows = [], []
    t0 = time.time()
    for it in items:
        g = df[df.item_id == it].reset_index(drop=True)
        tr, ca, te = origins(g)
        b = g.balance_fen.to_numpy() / 100.0
        X, _, meta = lgbm_rows(g, ca + te)
        qpred = np.stack([models[a].predict(X) for a in QS], axis=1)
        for k, (t, h) in enumerate(meta):
            fc["lgbm_quantile"].setdefault((it, t), np.zeros((H, len(QS))))[h - 1] = np.sort(b[t] + qpred[k])
        for t in ca + te:
            key = (it, t)
            truth[key] = b[t + 1:t + H + 1]
            floors[key] = g.reserve_floor_fen.iloc[0] / 100.0
            splits[key] = "calib" if t in ca else "test"
            c = g.iloc[max(0, t - CTX + 1):t + 1].copy()
            c["item_id"] = f"{it}@{t}"
            c["target"] = c.balance_fen / 100.0
            for col in ledger.COVARIATES:
                c[col] = c[col] / (100.0 if col.endswith("_out") else 1.0)
            ctx_rows.append(c[["item_id", "timestamp", "target"] + ledger.COVARIATES])
            f = g.iloc[t + 1:t + H + 1].copy()
            f["item_id"] = f"{it}@{t}"
            for col in ledger.COVARIATES:
                f[col] = f[col] / (100.0 if col.endswith("_out") else 1.0)
            fut_rows.append(f[["item_id", "timestamp"] + ledger.COVARIATES])
            # seasonal naive: repeat the change of 28 days earlier
            sn = b[t] + (b[t - 28 + 1:t - 28 + H + 1] - b[t - 28])
            fc["seasonal_naive"][key] = np.repeat(sn[:, None], len(QS), axis=1)
    ctx, fut = pd.concat(ctx_rows), pd.concat(fut_rows)
    pred = pipe.predict_df(ctx, future_df=fut, id_column="item_id", timestamp_column="timestamp", target="target",
                           prediction_length=H, quantile_levels=QS, batch_size=64)
    t_chronos = time.time() - t0
    for iid, g in pred.groupby("item_id"):
        it, t = iid.split("@")
        fc["chronos2"][(it, int(t))] = np.sort(g[[str(q) for q in QS]].to_numpy(), axis=1)
    # seasonal naive residual quantiles from calibration origins
    res_by_h = np.array([truth[k] - fc["seasonal_naive"][k][:, 0] for k in truth if splits[k] == "calib"])
    qres = np.quantile(res_by_h, QS, axis=0).T  # [H, Q]
    for k in fc["seasonal_naive"]:
        fc["seasonal_naive"][k] = fc["seasonal_naive"][k][:, 0][:, None] + qres
    # ---------------- metrics
    out = {"model": "M5 cash-flow forecaster", "horizon_days": H, "breach_window_days": BREACH_H, "context_days": CTX, "quantiles": QS,
           "series": items, "origins": {"calib": sum(v == "calib" for v in splits.values()), "test": sum(v == "test" for v in splits.values())},
           "label": "synthetic ledgers (fictional SMEs, CNY on a simulator rail)", "methods": {}}
    test_keys = [k for k in truth if splits[k] == "test"]
    cal_keys = [k for k in truth if splits[k] == "calib"]
    y_breach = lambda ks: np.array([float(truth[k][:BREACH_H].min() < floors[k]) for k in ks])  # noqa: E731
    yb_te, yb_ca = y_breach(test_keys), y_breach(cal_keys)
    scale = float(np.mean([np.abs(truth[k]).mean() for k in test_keys]))
    base_rate = float(yb_ca.mean())
    for m, F in fc.items():
        Y = np.stack([truth[k] for k in test_keys]); Q = np.stack([F[k] for k in test_keys])
        Yc = np.stack([truth[k] for k in cal_keys]); Qc = np.stack([F[k] for k in cal_keys])
        lo, hi = QS.index(0.05), QS.index(0.95)
        cov_raw = float(((Y >= Q[..., lo]) & (Y <= Q[..., hi])).mean())
        # CQR: conformity score max(q_lo - y, y - q_hi) on calibration, per horizon
        sc = np.maximum(Qc[..., lo] - Yc, Yc - Qc[..., hi])
        adj = np.quantile(sc, 0.9 * (1 + 1 / len(cal_keys)), axis=0)
        cov_cqr = float(((Y >= Q[..., lo] - adj) & (Y <= Q[..., hi] + adj)).mean())
        p_te = np.array([breach_prob(F[k], floors[k]) for k in test_keys])
        p_ca = np.array([breach_prob(F[k], floors[k]) for k in cal_keys])
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(p_ca, yb_ca)
        p_cal = iso.predict(p_te)
        out["methods"][m] = {
            "pinball_loss_cny": round(pinball(Y, Q, QS), 1), "scaled_pinball": round(pinball(Y, Q, QS) / scale, 5),
            "pinball_h1_7_cny": round(pinball(Y[:, :7], Q[:, :7], QS), 1), "pinball_h8_28_cny": round(pinball(Y[:, 7:], Q[:, 7:], QS), 1),
            "coverage90_raw": round(cov_raw, 4), "coverage90_cqr": round(cov_cqr, 4),
            "brier_breach14_raw": round(float(np.mean((p_te - yb_te) ** 2)), 4), "brier_breach14_isotonic": round(float(np.mean((p_cal - yb_te) ** 2)), 4)}
    out["breach_base_rate_test"] = round(float(yb_te.mean()), 4)
    out["breach_base_rate_calib"] = round(base_rate, 4)
    out["brier_climatology"] = round(float(np.mean((base_rate - yb_te) ** 2)), 4)
    out["runtime_secs"] = {"lgbm_train": round(t_lgbm, 1), "chronos2_inference_cpu": round(t_chronos, 1), "total": round(time.time() - t_start, 1)}
    out["versions"] = {"lightgbm": lgb.__version__, "chronos_model": "amazon/chronos-2"}
    try:
        import chronos
        out["versions"]["chronos_forecasting"] = getattr(chronos, "__version__", None)
    except Exception:  # noqa: BLE001
        pass
    import hashlib
    out["artifacts_sha256"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(art.glob("m5_lgbm_q*.txt"))}
    (ML / "results").mkdir(exist_ok=True)
    (ML / "results" / "m5_forecast.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(out["methods"], indent=1), out["breach_base_rate_test"], out["brier_climatology"], out["runtime_secs"])


if __name__ == "__main__":
    main()
