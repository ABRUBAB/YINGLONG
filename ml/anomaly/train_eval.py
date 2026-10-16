"""M3 behaviour anomaly: IsolationForest + LightGBM + Mondrian conformal escalation (CPU).

The model ESCALATES ONLY: its output can raise a tier (to T2 / ask) but never blocks or lowers a tier.
Held-out family (never seen by LightGBM): world.HELDOUT. Wallet-level split: train 60% / calibration 20% / test 20%.
Writes ml/results/m3_anomaly.json and model files to ml/artifacts/m3/ (gitignored; mirrored to HF).
Run: uv run python anomaly/train_eval.py   (from ml/)
"""
from __future__ import annotations

import hashlib
import json
import pickle
import sys
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, roc_auc_score

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from anomaly import world  # noqa: E402
from intent.metrics import wilson  # noqa: E402

ML = HERE.parent
ART = ML / "artifacts" / "m3"
TARGET_FER = 0.02  # target false-escalation rate on normal calibration actions


def split_of(wallet: str) -> str:
    h = int(hashlib.sha1(wallet.encode()).hexdigest(), 16) % 10
    return "train" if h < 6 else ("calib" if h < 8 else "test")


def conformal_p(cal_scores: np.ndarray, s: np.ndarray) -> np.ndarray:
    """p-value that a score this high comes from the normal calibration distribution (higher score = more anomalous)."""
    cal = np.sort(cal_scores)
    n = len(cal)
    ge = n - np.searchsorted(cal, s, side="left")
    return (ge + 1) / (n + 1)


def main():
    t0 = time.time()
    df = world.build()
    feats = [c for c in df.columns if c.startswith("f_")]
    df["split"] = df.wallet.map(split_of)
    df["y"] = (df.family != "normal").astype(int)
    tr, ca, te = (df[df.split == s] for s in ("train", "calib", "test"))
    X = lambda d: d[feats].to_numpy(dtype=np.float32)  # noqa: E731

    # IsolationForest per archetype (Mondrian by archetype), trained on normal train actions only
    iso, cal_iso = {}, {}
    for arch in ("student", "sme"):
        m = IsolationForest(n_estimators=300, max_samples=4096, contamination="auto", random_state=0, n_jobs=-1)
        m.fit(X(tr[(tr.archetype == arch) & (tr.y == 0)]))
        iso[arch] = m
        cal_iso[arch] = -m.score_samples(X(ca[(ca.archetype == arch) & (ca.y == 0)]))

    # LightGBM on known families only (held-out family removed from training)
    trl = tr[tr.family != world.HELDOUT]
    params = {"objective": "binary", "learning_rate": 0.05, "num_leaves": 31, "min_data_in_leaf": 40, "feature_fraction": 0.9,
              "bagging_fraction": 0.9, "bagging_freq": 1, "lambda_l2": 1.0, "verbose": -1, "seed": 0,
              "scale_pos_weight": float((trl.y == 0).sum() / max(1, trl.y.sum()))}
    gbm = lgb.train(params, lgb.Dataset(X(trl), trl.y.to_numpy()), num_boost_round=400)
    cal_gbm = {arch: gbm.predict(X(ca[(ca.archetype == arch) & (ca.y == 0)])) for arch in ("student", "sme")}

    def scores(d):
        s_iso = np.zeros(len(d)); p_iso = np.ones(len(d)); s_gbm = gbm.predict(X(d)); p_gbm = np.ones(len(d))
        for arch in ("student", "sme"):
            mask = (d.archetype == arch).to_numpy()
            if mask.any():
                s_iso[mask] = -iso[arch].score_samples(X(d[mask]))
                p_iso[mask] = conformal_p(cal_iso[arch], s_iso[mask])
                p_gbm[mask] = conformal_p(cal_gbm[arch], s_gbm[mask])
        # combined: Bonferroni-style min of the two conformal p-values
        p_comb = np.minimum(1.0, 2 * np.minimum(p_iso, p_gbm))
        return s_iso, s_gbm, p_iso, p_gbm, p_comb

    # choose alpha on calibration normals for the target false-escalation rate
    _, _, _, _, pc_cal = scores(ca[ca.y == 0])
    alpha = float(np.quantile(pc_cal, TARGET_FER))
    s_iso, s_gbm, p_iso, p_gbm, p_comb = scores(te)
    esc = p_comb <= alpha
    y = te.y.to_numpy()
    res = {"model": "M3 behaviour anomaly (IsolationForest + LightGBM + Mondrian conformal by archetype)", "escalates_only": True,
           "heldout_family": world.HELDOUT, "families": world.FAMILIES,
           "data": {"actions": int(len(df)), "wallets": int(df.wallet.nunique()), "anomalous_actions": int(df.y.sum()),
                    "by_split": {s: {"actions": int((df.split == s).sum()), "anomalous": int(df[df.split == s].y.sum())} for s in ("train", "calib", "test")}},
           "features": feats, "alpha": alpha, "target_false_escalation_rate": TARGET_FER}
    m_all = {"auroc_isoforest": roc_auc_score(y, s_iso), "auroc_lightgbm": roc_auc_score(y, s_gbm), "auroc_combined": roc_auc_score(y, -p_comb),
             "auprc_isoforest": average_precision_score(y, s_iso), "auprc_lightgbm": average_precision_score(y, s_gbm), "auprc_combined": average_precision_score(y, -p_comb)}
    res["test_overall"] = {k: round(float(v), 4) for k, v in m_all.items()}
    nn = int((y == 0).sum()); fe = int(esc[y == 0].sum())
    res["test_overall"]["false_escalation_rate"] = round(fe / max(1, nn), 4)
    res["test_overall"]["false_escalation_ci95"] = wilson(fe, nn)
    res["test_overall"]["normal_actions"] = nn
    per = {}
    fam = te.family.to_numpy()
    for f in world.FAMILIES:
        m = fam == f
        k = int(esc[m].sum()); n = int(m.sum())
        mask = (fam == f) | (y == 0)
        per[f] = {"n": n, "escalation_recall": round(k / max(1, n), 4), "recall_ci95": wilson(k, n),
                  "auroc_combined": round(float(roc_auc_score(y[mask], -p_comb[mask])), 4) if n else None,
                  "auroc_isoforest": round(float(roc_auc_score(y[mask], s_iso[mask])), 4) if n else None,
                  "auroc_lightgbm": round(float(roc_auc_score(y[mask], s_gbm[mask])), 4) if n else None,
                  "heldout": f == world.HELDOUT}
    res["test_per_family"] = per
    imp = gbm.feature_importance("gain")
    res["lightgbm_top_features"] = [feats[i] for i in np.argsort(-imp)[:10]]
    res["runtime_secs"] = round(time.time() - t0, 1)
    ART.mkdir(parents=True, exist_ok=True)
    with open(ART / "m3_models.pkl", "wb") as f:
        pickle.dump({"iso": iso, "cal_iso": cal_iso, "cal_gbm": cal_gbm, "alpha": alpha, "features": feats}, f)
    gbm.save_model(str(ART / "m3_lightgbm.txt"))
    res["artifacts_sha256"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ART.glob("m3_*"))}
    (ML / "results").mkdir(exist_ok=True)
    (ML / "results" / "m3_anomaly.json").write_text(json.dumps(res, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: res[k] for k in ("data", "test_overall")}, indent=1))
    for f, v in per.items():
        print(f"{f:22s} n={v['n']:5d} recall={v['escalation_recall']:.3f} auroc={v['auroc_combined']}{'  (HELD-OUT)' if v['heldout'] else ''}")


if __name__ == "__main__":
    main()
