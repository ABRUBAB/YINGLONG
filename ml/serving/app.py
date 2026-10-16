"""YINGLONG ML signal service (CPU only; fits the 2 vCPU server).

Endpoints
  POST /sentinel  {text}                      -> {score, label, threshold, model_sha}
  POST /anomaly   {archetype, features}       -> {escalate, p_value, scores, model_sha}   (escalates only; never blocks)
  POST /forecast  {history, future, floor_fen} -> {quantiles per day, p_breach_14d, model_sha}
  GET  /health                                -> loaded models and their SHA-256

Models are pinned in models.lock.json (HF repo, revision, file SHA-256). Startup FAILS CLOSED if a file is missing or its
hash differs. Fetch them with: uv run python fetch_models.py
Every output is an advisory signal: deterministic policy code decides; these signals may only raise a tier.
"""
from __future__ import annotations

import hashlib
import json
import os
import pickle
import re
import unicodedata
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
MODELS_DIR = Path(os.environ.get("YL_MODELS_DIR", HERE / "models"))
LOCK = json.loads((HERE / "models.lock.json").read_text(encoding="utf-8"))

INVISIBLE = re.compile("[" + "".join(chr(c) for c in [*range(0x200B, 0x2010), *range(0x202A, 0x202F), *range(0x2060, 0x2065), 0xFEFF]) + "]")


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 22), b""):
            h.update(c)
    return h.hexdigest()


def verified(model_key: str, fname: str) -> Path:
    spec = LOCK[model_key]
    p = MODELS_DIR / model_key / fname
    want = spec["files"][fname]
    if not p.exists():
        raise RuntimeError(f"missing model file {p}")
    got = sha256(p)
    if got != want:
        raise RuntimeError(f"hash mismatch for {p}: refusing to start")
    return p


def normalise(text: str) -> str:
    return INVISIBLE.sub("", unicodedata.normalize("NFKC", text))


class Sentinel:
    def __init__(self):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        spec = LOCK["m1"]
        so = ort.SessionOptions()
        so.intra_op_num_threads = int(os.environ.get("YL_ORT_THREADS", "2"))
        self.sess = ort.InferenceSession(str(verified("m1", "model_int8.onnx")), so, providers=["CPUExecutionProvider"])
        self.tok = Tokenizer.from_file(str(verified("m1", "tokenizer.json")))
        self.tok.no_padding()  # tokenizer.json may carry a padding config from export time
        self.tok.enable_truncation(max_length=spec.get("max_len", 320))
        self.threshold = float(spec["threshold"])
        self.sha = spec["files"]["model_int8.onnx"]
        self.model_id = f"{spec['repo']}@{spec['revision']}"

    def score(self, text: str) -> float:
        e = self.tok.encode(normalise(text))
        ids = np.array([e.ids], dtype=np.int64)
        mask = np.array([e.attention_mask], dtype=np.int64)
        lo = self.sess.run(["logits"], {"input_ids": ids, "attention_mask": mask})[0][0].astype(np.float64)
        p = np.exp(lo - lo.max())
        return float(p[1] / p.sum())


class Anomaly:
    def __init__(self):
        import lightgbm as lgb
        with open(verified("m3", "m3_models.pkl"), "rb") as f:
            self.m = pickle.load(f)  # file is hash-pinned above before unpickling
        self.gbm = lgb.Booster(model_file=str(verified("m3", "m3_lightgbm.txt")))
        self.sha = LOCK["m3"]["files"]["m3_models.pkl"]

    @staticmethod
    def _p(cal, s):
        cal = np.sort(cal)
        return float((len(cal) - np.searchsorted(cal, s, side="left") + 1) / (len(cal) + 1))

    def score(self, archetype: str, features: dict) -> dict:
        x = np.array([[float(features.get(f, 0.0)) for f in self.m["features"]]], dtype=np.float32)
        s_iso = float(-self.m["iso"][archetype].score_samples(x)[0])
        s_gbm = float(self.gbm.predict(x)[0])
        p = min(1.0, 2 * min(self._p(self.m["cal_iso"][archetype], s_iso), self._p(self.m["cal_gbm"][archetype], s_gbm)))
        return {"escalate": p <= self.m["alpha"], "p_value": p, "alpha": self.m["alpha"], "score_isoforest": s_iso, "score_lightgbm": s_gbm}


class Forecast:
    QS = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]
    COVS = ["payroll_out", "ap_due_out", "utilities_out", "forwarders_out", "cloud_out", "sweep_out", "is_weekend", "is_holiday"]

    def __init__(self):
        import lightgbm as lgb
        self.models = {q: lgb.Booster(model_file=str(verified("m5", f"m5_lgbm_q{q}.txt"))) for q in self.QS}
        self.sha = hashlib.sha256("".join(LOCK["m5"]["files"][f"m5_lgbm_q{q}.txt"] for q in self.QS).encode()).hexdigest()

    def predict(self, history: list[dict], future: list[dict], floor_fen: int) -> dict:
        import datetime as dt
        if len(history) < 29 or not future:
            raise ValueError("need at least 29 days of history and 1 future day")
        b = np.array([h["balance_fen"] for h in history], dtype=np.float64) / 100
        net = np.diff(b, prepend=b[0])
        t = len(b) - 1
        base = [b[t], net[t - 6:].mean(), net[t - 27:].mean(), net[t - 27:].std(), b[t] - b[t - 7], b[t] - b[t - 28]]
        rows, cum = [], {c: 0.0 for c in self.COVS}
        wk = 0.0
        for h, f in enumerate(future, start=1):
            d = dt.date.fromisoformat(f["date"])
            for c in self.COVS:
                cum[c] += float(f.get(c, 0)) / (100.0 if c.endswith("_out") else 1.0)
            wk += float(f.get("is_weekend", 0))
            rows.append(base + [h, d.day, d.weekday()] + [cum[c] for c in self.COVS] + [wk])
        X = np.array(rows)
        q = np.sort(np.stack([b[t] + self.models[a].predict(X) for a in self.QS], axis=1), axis=1)
        floor = floor_fen / 100
        pb = 0.0
        for h in range(min(14, len(future))):
            qs = np.maximum.accumulate(q[h])
            pb = max(pb, 1.0 if floor >= qs[-1] else (float(np.interp(floor, qs, self.QS)) if floor > qs[0] else 0.0))
        return {"quantile_levels": self.QS, "balance_quantiles_fen": [[int(round(v * 100)) for v in row] for row in q], "p_breach_14d": pb}


MODELS: dict = {}


@asynccontextmanager
async def lifespan(_app):
    enabled = os.environ.get("YL_MODELS", "m1,m3,m5").split(",")
    if "m1" in enabled:
        MODELS["m1"] = Sentinel()
    if "m3" in enabled:
        MODELS["m3"] = Anomaly()
    if "m5" in enabled:
        MODELS["m5"] = Forecast()
    yield
    MODELS.clear()


app = FastAPI(title="YINGLONG ML signals", version="0.1.0", lifespan=lifespan)


class SentinelIn(BaseModel):
    text: str = Field(max_length=20000)


class AnomalyIn(BaseModel):
    archetype: str = Field(pattern="^(student|sme)$")
    features: dict[str, float]


class ForecastIn(BaseModel):
    history: list[dict]
    future: list[dict]
    floor_fen: int


@app.get("/health")
def health():
    return {"ok": True, "models": {k: getattr(v, "sha", None) for k, v in MODELS.items()}}


@app.post("/sentinel")
def sentinel(body: SentinelIn):
    m = MODELS.get("m1")
    if m is None:
        raise HTTPException(503, "sentinel not loaded")
    s = m.score(body.text)
    return {"score": round(s, 6), "label": "injection" if s >= m.threshold else "benign", "threshold": m.threshold, "model_sha": m.sha,
            "model": m.model_id, "advisory": "raises the tier only; deterministic policy decides"}


@app.post("/anomaly")
def anomaly(body: AnomalyIn):
    m = MODELS.get("m3")
    if m is None:
        raise HTTPException(503, "anomaly model not loaded")
    return m.score(body.archetype, body.features) | {"model_sha": m.sha, "advisory": "escalates only; never blocks"}


@app.post("/forecast")
def forecast(body: ForecastIn):
    m = MODELS.get("m5")
    if m is None:
        raise HTTPException(503, "forecast model not loaded")
    try:
        return m.predict(body.history, body.future, body.floor_fen) | {"model_sha": m.sha}
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
