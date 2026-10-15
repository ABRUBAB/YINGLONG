from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from yinglong_verify.deployment import Deployment, bundled_path, parse_deployment

HERE = Path(__file__).resolve().parent
VECTORS = HERE / "vectors" / "ts-vectors.json"
GOLDEN_NAMES = ["nadia", "lotus"]


def golden_path(name: str) -> Path:
    """The repository's golden file when running in a checkout, else the bundled copy."""
    repo = HERE.parent.parent.parent / "packages" / "mandate" / "golden" / f"{name}.json"
    return repo if repo.exists() else bundled_path("golden", f"{name}.json")


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def deployment_for(name: str) -> Deployment:
    repo = HERE.parent.parent.parent / "contracts" / "deployments" / f"{name}.json"
    p = repo if repo.exists() else bundled_path("deployments", f"{name}.json")
    if not p.exists():
        pytest.skip(f"no deployment file for {name}")
    return parse_deployment(load_json(p), str(p))


@pytest.fixture(scope="session")
def vectors() -> dict:
    if not VECTORS.exists():
        pytest.skip("tests/vectors/ts-vectors.json missing (run: npx tsx tools/verify-py/scripts/ts-vectors.ts)")
    return load_json(VECTORS)


@pytest.fixture(scope="session")
def anvil_deployment() -> Deployment:
    return deployment_for("anvil")


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # Tests choose their RPC explicitly; ambient overrides must not leak in.
    for k in ("ANVIL_RPC_URL", "BASE_SEPOLIA_RPC_URL", "YINGLONG_DEPLOYMENTS"):
        monkeypatch.delenv(k, raising=False)
    os.environ.setdefault("COLUMNS", "140")
