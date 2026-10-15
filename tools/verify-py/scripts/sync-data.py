#!/usr/bin/env python3
"""Refresh the data bundled inside the yinglong-verify package from the repository.

Copies, byte for byte:
  contracts/deployments/*.json      -> src/yinglong_verify/data/deployments/
  packages/mandate/golden/*.json    -> src/yinglong_verify/data/golden/
and exports ABIs from the Foundry build output (contracts/out, run `forge build` first) into
  src/yinglong_verify/abi/<Contract>.json
Writes src/yinglong_verify/data/MANIFEST.json with the SHA-256 of every bundled file and its source path,
so a judge can check that the bundle equals the repository at a given commit.

Usage (from anywhere):  python tools/verify-py/scripts/sync-data.py [--check]
  --check   do not write; exit 1 if the bundle differs from the repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent / "src" / "yinglong_verify"
REPO = HERE.parent.parent.parent

# (Foundry output file, contract name). Framework contracts first, then YINGLONG contracts.
ABI_CONTRACTS: list[tuple[str, str]] = [
    ("DelegationManager.sol", "DelegationManager"),
    ("EntryPoint.sol", "EntryPoint"),
    ("HybridDeleGator.sol", "HybridDeleGator"),
    ("MultiSigDeleGator.sol", "MultiSigDeleGator"),
    ("SimpleFactory.sol", "SimpleFactory"),
    ("AllowedTargetsEnforcer.sol", "AllowedTargetsEnforcer"),
    ("AllowedMethodsEnforcer.sol", "AllowedMethodsEnforcer"),
    ("AllowedCalldataEnforcer.sol", "AllowedCalldataEnforcer"),
    ("ValueLteEnforcer.sol", "ValueLteEnforcer"),
    ("LimitedCallsEnforcer.sol", "LimitedCallsEnforcer"),
    ("TimestampEnforcer.sol", "TimestampEnforcer"),
    ("NonceEnforcer.sol", "NonceEnforcer"),
    ("RedeemerEnforcer.sol", "RedeemerEnforcer"),
    ("ERC20TransferAmountEnforcer.sol", "ERC20TransferAmountEnforcer"),
    ("MandateRegistry.sol", "MandateRegistry"),
    ("AccountabilityLedger.sol", "AccountabilityLedger"),
    ("KillSwitchRegistry.sol", "KillSwitchRegistry"),
    ("PayeeBook.sol", "PayeeBook"),
    ("YinglongPassportRegistry.sol", "YinglongPassportRegistry"),
    ("ProductRegistry.sol", "ProductRegistry"),
    ("MandateBindingEnforcer.sol", "MandateBindingEnforcer"),
    ("ForbiddenTargetsEnforcer.sol", "ForbiddenTargetsEnforcer"),
    ("AgentLineageEnforcer.sol", "AgentLineageEnforcer"),
    ("VerifiedPayeeEnforcer.sol", "VerifiedPayeeEnforcer"),
    ("CategoryBudgetEnforcer.sol", "CategoryBudgetEnforcer"),
    ("ReserveFloorEnforcer.sol", "ReserveFloorEnforcer"),
    ("VelocityEnforcer.sol", "VelocityEnforcer"),
    ("SuitabilityEnforcer.sol", "SuitabilityEnforcer"),
    ("JurisdictionEnforcer.sol", "JurisdictionEnforcer"),
    ("GlobalPauseEnforcer.sol", "GlobalPauseEnforcer"),
    ("ReputationGateEnforcer.sol", "ReputationGateEnforcer"),
    ("CoSignEnforcer.sol", "CoSignEnforcer"),
    ("VetoTimelockEnforcer.sol", "VetoTimelockEnforcer"),
    ("ZKMandateEnforcer.sol", "ZKMandateEnforcer"),
    ("ZKVerifierRouter.sol", "ZKVerifierRouter"),
    ("TestUnits.sol", "TestUnits"),
    ("TestMoneyMarketFund.sol", "TestMoneyMarketFund"),
    ("ProtectedPayment.sol", "ProtectedPayment"),
    ("SignedQuoteSettlement.sol", "SignedQuoteSettlement"),
    ("ConditionalPaymentInstructions.sol", "ConditionalPaymentInstructions"),
    ("YinglongCreate2Deployer.sol", "YinglongCreate2Deployer"),
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def planned_files() -> dict[Path, bytes]:
    """Every file the bundle should contain, mapped to its exact bytes."""
    out: dict[Path, bytes] = {}
    sources: dict[str, dict[str, str]] = {}

    dep_dir = REPO / "contracts" / "deployments"
    for p in sorted(dep_dir.glob("*.json")):
        data = p.read_bytes()
        rel = f"data/deployments/{p.name}"
        out[PKG / rel] = data
        sources[rel] = {"source": f"contracts/deployments/{p.name}", "sha256": sha256(data)}

    gold_dir = REPO / "packages" / "mandate" / "golden"
    for p in sorted(gold_dir.glob("*.json")):
        data = p.read_bytes()
        rel = f"data/golden/{p.name}"
        out[PKG / rel] = data
        sources[rel] = {"source": f"packages/mandate/golden/{p.name}", "sha256": sha256(data)}

    out_dir = REPO / "contracts" / "out"
    if out_dir.is_dir():
        for file, name in ABI_CONTRACTS:
            p = out_dir / file / f"{name}.json"
            if not p.exists():
                print(f"warning: missing {p} (run forge build in contracts/)", file=sys.stderr)
                continue
            abi = json.loads(p.read_text(encoding="utf-8"))["abi"]
            data = (json.dumps(abi, indent=1, sort_keys=True) + "\n").encode("utf-8")
            rel = f"abi/{name}.json"
            out[PKG / rel] = data
            sources[rel] = {"source": f"contracts/out/{file}/{name}.json (abi only)", "sha256": sha256(data)}
    else:
        # Keep the ABIs already bundled when the Foundry output is not available.
        for p in sorted((PKG / "abi").glob("*.json")):
            data = p.read_bytes()
            rel = f"abi/{p.name}"
            out[p] = data
            sources[rel] = {"source": "(kept; contracts/out not built)", "sha256": sha256(data)}

    manifest = {
        "description": "Files bundled into yinglong-verify by tools/verify-py/scripts/sync-data.py; do not edit by hand.",
        "files": dict(sorted(sources.items())),
    }
    out[PKG / "data" / "MANIFEST.json"] = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 if the bundle is out of date; write nothing")
    a = ap.parse_args()

    files = planned_files()
    stale = [p for p, data in files.items() if not p.exists() or p.read_bytes() != data]
    managed_dirs = [PKG / "data" / "deployments", PKG / "data" / "golden", PKG / "abi"]
    extra = [p for d in managed_dirs if d.is_dir() for p in d.glob("*.json") if p not in files]

    if a.check:
        for p in stale:
            print(f"out of date: {p.relative_to(PKG)}")
        for p in extra:
            print(f"not in repository: {p.relative_to(PKG)}")
        return 1 if stale or extra else 0

    for p in extra:
        p.unlink()
        print(f"removed {p.relative_to(PKG)}")
    for p in stale:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(files[p])
        print(f"wrote {p.relative_to(PKG)}")
    print(f"bundle has {len(files)} files ({len(stale)} updated)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
