"""Runtime loaders for credentials kept OUTSIDE the repository.

Nothing in this module prints or logs a secret. Values are returned to the
caller or placed into os.environ of the current process only.
The directory can be overridden with YL_SECRETS_DIR.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

SECRETS_DIR = Path(os.environ.get("YL_SECRETS_DIR", r"D:\fintechatho_2026_china"))
WORK_DIR = Path(os.environ.get("YL_WORK_DIR", r"D:\yl-ml-work"))


def openrouter_key() -> str:
    for line in (SECRETS_DIR / "AI_LLM_API_KEY.txt").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*openrouter\s*:\s*(\S+)\s*$", line)
        if m:
            return m.group(1)
    raise RuntimeError("OpenRouter key not found")


def hf_tokens() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in (SECRETS_DIR / "HF_AC_token.txt").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*(read|write)\s*:\s*(\S+)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def kaggle_tokens() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in (SECRETS_DIR / "kggle api keys.txt").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*(ac_\d+)\s*key\s*:\s*(\S+)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def use_kaggle_account(account: str = "ac_1") -> Path:
    """Write the account token under WORK_DIR/kaggle/<account>/ and point the CLI at it."""
    tok = kaggle_tokens()[account]
    cfg = WORK_DIR / "kaggle" / account
    cfg.mkdir(parents=True, exist_ok=True)
    (cfg / "access_token").write_text(tok, encoding="utf-8")
    os.environ["KAGGLE_CONFIG_DIR"] = str(cfg)
    os.environ["KAGGLE_API_TOKEN"] = tok
    return cfg


def use_hf(role: str = "write") -> str:
    tok = hf_tokens()[role]
    os.environ["HF_TOKEN"] = tok
    return tok


# Kaggle usernames are public identifiers (resolved once with `kaggle config view`).
KAGGLE_USERS = {"ac_1": "abdullahrubab1", "ac_2": "absanim", "ac_3": "tanvirhossin24231e14", "ac_4": "shabab28"}
