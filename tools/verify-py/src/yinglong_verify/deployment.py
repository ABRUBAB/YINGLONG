"""Ledger profiles and deployment files (twin of packages/sdk/src/ledgers.ts and deployments.ts)."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from importlib import resources
from pathlib import Path
from typing import Any

from .constants import CONTRACT_NAMES

LEDGER_NAMES = ["anvil", "base-sepolia", "fisco"]


@dataclass
class Ledger:
    name: str
    label: str
    chain_id: int
    rpc_url: str
    rpc_source: str
    time_unit: str  # "s" or "ms": unit of block.timestamp
    badge: str
    explorer_tx: str | None = None
    explorer_address: str | None = None
    # chainId used inside EIP-712 domains (FISCO BCOS may return 0 from CHAINID).
    domain_chain_id: int | None = None


def _env(k: str) -> str | None:
    v = os.environ.get(k)
    return v if v else None


def ledger(name: str, rpc_override: str | None = None) -> Ledger:
    if name == "anvil":
        rpc, src = (_env("ANVIL_RPC_URL"), "env ANVIL_RPC_URL") if _env("ANVIL_RPC_URL") else ("http://127.0.0.1:8645", "default")
        lg = Ledger("anvil", "Local Anvil (bench)", 31337, rpc, src, "s", "Anvil bench (simulated)")
    elif name == "base-sepolia":
        if _env("BASE_SEPOLIA_RPC_URL"):
            rpc, src = _env("BASE_SEPOLIA_RPC_URL"), "env BASE_SEPOLIA_RPC_URL"
        else:
            rpc, src = "https://sepolia.base.org", "default"
        lg = Ledger(
            "base-sepolia",
            "Base Sepolia (public testnet)",
            84532,
            rpc,  # type: ignore[arg-type]
            src,
            "s",
            "Base Sepolia (testnet)",
            explorer_tx="https://sepolia.basescan.org/tx/{}",
            explorer_address="https://sepolia.basescan.org/address/{}",
        )
    elif name == "fisco":
        if _env("FISCO_RPC_URL"):
            rpc, src = _env("FISCO_RPC_URL"), "env FISCO_RPC_URL"
        else:
            rpc, src = "http://127.0.0.1:8545", "default (set FISCO_RPC_URL)"
        unit = _env("FISCO_TIME_UNIT") or "s"
        if unit not in ("s", "ms"):
            raise ValueError("FISCO_TIME_UNIT must be s or ms")
        dom = _env("FISCO_DOMAIN_CHAIN_ID")
        lg = Ledger(
            "fisco",
            "FISCO BCOS 3.17.1 (consortium ledger)",
            int(_env("FISCO_CHAIN_ID") or 20200),
            rpc,  # type: ignore[arg-type]
            src,
            unit,
            "FISCO BCOS (team-run consortium ledger)",
            explorer_tx="https://app.yinglong-agent.tech/proof/tx/fisco/{}",
            domain_chain_id=int(dom) if dom is not None else None,
        )
    else:
        raise ValueError(f"unknown ledger {name!r} (expected one of {LEDGER_NAMES})")
    if rpc_override:
        lg.rpc_url, lg.rpc_source = rpc_override, "--rpc"
    return lg


@dataclass
class Deployment:
    ledger: str
    chain_id: int
    deployer: str
    domain_salt: str
    framework_mode: str
    deployed_at_block: int
    contracts: dict[str, dict[str, str]]  # name -> {"address", "codeHash"}
    source: str = ""
    sha256: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def addr(self, name: str) -> str:
        return self.contracts[name]["address"]

    def code_hash(self, name: str) -> str:
        return self.contracts[name]["codeHash"]

    def all_contracts(self) -> dict[str, dict[str, str]]:
        """Every contract entry in the file: the CONTRACT_NAMES set plus extras (e.g. the ZK verifier stack)."""
        return {**{k: v for k, v in self.extra.items() if isinstance(v, dict) and "address" in v}, **self.contracts}

    def all_names_by_address(self) -> dict[str, str]:
        out = {v["address"].lower(): k for k, v in self.extra.items() if isinstance(v, dict) and "address" in v}
        out.update(self.name_by_address())
        return out

    def name_by_address(self) -> dict[str, str]:
        """Lower-case address -> contract name (later names win, as in the TypeScript Map)."""
        out: dict[str, str] = {}
        for n in CONTRACT_NAMES:
            out[self.contracts[n]["address"].lower()] = n
        return out


def parse_deployment(raw: dict[str, Any], source: str = "", digest: str = "") -> Deployment:
    contracts: dict[str, dict[str, str]] = {}
    for name in CONTRACT_NAMES:
        v = raw.get(name)
        o = json.loads(v) if isinstance(v, str) else v
        if not isinstance(o, dict) or not o.get("address"):
            raise ValueError(f"deployment is missing {name}")
        contracts[name] = {"address": o["address"], "codeHash": o.get("codeHash", "")}
    # Keep any extra contract entries (address + codeHash) for code-hash checks and labels.
    extra = {}
    for k, v in raw.items():
        if k in contracts:
            continue
        o = json.loads(v) if isinstance(v, str) and v.startswith("{") else v
        if isinstance(o, dict) and "address" in o:
            extra[k] = o
    return Deployment(
        ledger=str(raw["ledger"]),
        chain_id=int(raw["chainId"]),
        deployer=str(raw.get("deployer", "")),
        domain_salt=str(raw.get("domainSalt", "")),
        framework_mode=str(raw.get("frameworkMode", "")),
        deployed_at_block=int(raw.get("deployedAtBlock", 0)),
        contracts=contracts,
        source=source,
        sha256=digest,
        extra=extra,
    )


def find_repo_root(start: Path | None = None) -> Path | None:
    """Walk up from `start` (default: cwd) to a YINGLONG checkout (has contracts/deployments)."""
    p = (start or Path.cwd()).resolve()
    for cand in [p, *p.parents]:
        if (cand / "contracts" / "deployments").is_dir() and (cand / "packages" / "mandate").is_dir():
            return cand
    return None


def bundled_path(*parts: str) -> Path:
    return Path(str(resources.files("yinglong_verify").joinpath("data", *parts)))


def deployment_candidates(name: str) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    env_dir = _env("YINGLONG_DEPLOYMENTS")
    if env_dir:
        out.append(("env YINGLONG_DEPLOYMENTS", Path(env_dir) / f"{name}.json"))
    root = find_repo_root()
    if root is not None:
        out.append(("repository checkout", root / "contracts" / "deployments" / f"{name}.json"))
    out.append(("bundled snapshot", bundled_path("deployments", f"{name}.json")))
    return out


def load_deployment(name: str, path: str | None = None) -> Deployment:
    if path:
        p = Path(path)
        label = "--deployment"
    else:
        for label, p in deployment_candidates(name):
            if p.exists():
                break
        else:
            raise FileNotFoundError(
                f"no deployment file for {name}: looked in "
                + ", ".join(str(c[1]) for c in deployment_candidates(name))
                + " (pass --deployment PATH)"
            )
    data = p.read_bytes()
    d = parse_deployment(json.loads(data.decode("utf-8")), f"{p} ({label})", hashlib.sha256(data).hexdigest())
    if d.ledger != name:
        raise ValueError(f"deployment file {p} is for ledger {d.ledger!r}, not {name!r}")
    return d


def known_deployment_files() -> list[tuple[str, Path]]:
    seen: list[tuple[str, Path]] = []
    root = find_repo_root()
    if root is not None:
        for p in sorted((root / "contracts" / "deployments").glob("*.json")):
            seen.append(("repository", p))
    bdir = bundled_path("deployments")
    if bdir.is_dir():
        for p in sorted(bdir.glob("*.json")):
            seen.append(("bundled", p))
    return seen
