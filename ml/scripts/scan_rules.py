"""Scan every file under ml/ and bench/ (tracked or not) for the repo hard rules.

Checks: CJK code points (U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+FF00-FFEF), secret-looking strings, AI attribution.
scripts/check-rules.mjs only sees git-tracked files; run this before handing files over.
Usage (repo root): uv run --project ml python ml/scripts/scan_rules.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CJK = re.compile("[" + "".join(f"{chr(a)}-{chr(b)}" for a, b in [(0x3000, 0x303F), (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xFF00, 0xFFEF)]) + "]")
SECRETS = [re.compile(p) for p in (r"sk-or-v1-[0-9a-f]{40,}", r"\bhf_[A-Za-z0-9]{30,}", r"\bgh[pousr]_[A-Za-z0-9]{36,}", r"KGAT_[A-Za-z0-9]{20,}",
                                   r"-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----")]
ATTRIB = re.compile(r"co-authored-by|generated with \[?claude|noreply@anthropic", re.I)
SKIP_DIRS = {".venv", "__pycache__", "artifacts", "runs", "models", ".pytest_cache", ".ruff_cache"}
BINARY = re.compile(r"\.(png|jpe?g|webp|gif|ico|onnx|gguf|bin|pt|safetensors|pkl|parquet|zip|gz)$", re.I)


def main() -> int:
    bad = 0
    n = 0
    for top in ("ml", "bench"):
        for p in (REPO / top).rglob("*"):
            if p.is_dir() or any(part in SKIP_DIRS for part in p.relative_to(REPO).parts) or BINARY.search(p.name):
                continue
            if CJK.search(p.name):
                print("CJK in filename:", p.relative_to(REPO)); bad += 1
            try:
                text = p.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            n += 1
            for i, line in enumerate(text.split("\n"), 1):
                if CJK.search(line):
                    print(f"CJK: {p.relative_to(REPO)}:{i}"); bad += 1
                    break
            if p.name != "scan_rules.py":
                for rx in SECRETS:
                    if rx.search(text):
                        print(f"secret-like string ({rx.pattern[:12]}...): {p.relative_to(REPO)}"); bad += 1
                if ATTRIB.search(text):
                    print(f"attribution: {p.relative_to(REPO)}"); bad += 1
    print(f"scanned {n} text files under ml/ and bench/: {'OK' if not bad else str(bad) + ' problem(s)'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
