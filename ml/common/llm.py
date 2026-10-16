"""Minimal OpenRouter client (OpenAI-compatible) with retries and spend accounting.

Usage numbers (tokens, cost) are appended to a log OUTSIDE the repository
(YL_WORK_DIR/logs/openrouter_usage.jsonl). Prompts and completions are never logged.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import keys

API = "https://openrouter.ai/api/v1/chat/completions"
USAGE_LOG = keys.WORK_DIR / "logs" / "openrouter_usage.jsonl"


class LLMError(RuntimeError):
    pass


def chat(model: str, messages: list[dict], schema: dict | None = None, schema_name: str = "out",
         max_tokens: int = 8000, temperature: float = 0.8, reasoning_effort: str | None = "low",
         retries: int = 6, timeout: int = 600, tag: str = "") -> tuple[str, dict]:
    body: dict = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if schema is not None:
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}}
        body["provider"] = {"require_parameters": True}
    if reasoning_effort == "off":
        body["reasoning"] = {"enabled": False}
    elif reasoning_effort:
        body["reasoning"] = {"effort": reasoning_effort, "exclude": True}
    data = json.dumps(body).encode()
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(API, data=data, headers={
            "Authorization": f"Bearer {keys.openrouter_key()}", "Content-Type": "application/json",
            "X-Title": "yinglong-ml-datagen"})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                d = json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode("utf-8", "replace")
            last = f"HTTP {e.code}: {msg}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(min(120, 15 * (attempt + 1)))
                continue
            raise LLMError(last)
        except Exception as e:  # network
            last = f"{type(e).__name__}: {e}"
            time.sleep(10 * (attempt + 1))
            continue
        if "error" in d:
            last = str(d["error"])[:300]
            time.sleep(15 * (attempt + 1))
            continue
        content = (d.get("choices") or [{}])[0].get("message", {}).get("content")
        usage = d.get("usage") or {}
        rec = {"ts": time.time(), "model": model, "tag": tag, "secs": round(time.time() - t0, 1),
               "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
               "cost": usage.get("cost", 0)}
        USAGE_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(USAGE_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
        if not content:
            last = "empty content"
            if (usage.get("completion_tokens") or 0) >= max_tokens:
                raise LLMError("token budget exhausted without content")
            continue
        return content, rec
    raise LLMError(f"failed after {retries} attempts: {last}")


def total_spend() -> dict:
    if not USAGE_LOG.exists():
        return {"calls": 0, "cost_usd": 0.0}
    rows = [json.loads(l) for l in USAGE_LOG.read_text(encoding="utf-8").splitlines() if l.strip()]
    by_model: dict[str, dict] = {}
    for r in rows:
        m = by_model.setdefault(r["model"], {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0})
        m["calls"] += 1
        m["prompt_tokens"] += r.get("prompt_tokens") or 0
        m["completion_tokens"] += r.get("completion_tokens") or 0
        m["cost_usd"] += float(r.get("cost") or 0)
    return {"calls": len(rows), "cost_usd": round(sum(m["cost_usd"] for m in by_model.values()), 6), "by_model": by_model}


def parse_json(content: str):
    s = content.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1].rsplit("```", 1)[0]
    return json.loads(s)
