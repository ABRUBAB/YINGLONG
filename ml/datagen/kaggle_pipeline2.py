"""Kaggle job: intent top-up generation (seed 2) followed by round-trip verification of all intent and sentinel rows."""
from __future__ import annotations

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

if __name__ == "__main__":
    r1 = subprocess.run([sys.executable, os.path.join(HERE, "kaggle_datagen.py"), "--kind", "intent2"]).returncode
    r2 = subprocess.run([sys.executable, os.path.join(HERE, "kaggle_verify.py"), "--kinds", "intent,sentinel"]).returncode
    print("pipeline2 exit codes", r1, r2, flush=True)
