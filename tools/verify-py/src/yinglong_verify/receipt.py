"""Accountability receipt EIP-712 hash (twin of packages/sdk/src/receipt.ts) and sorted-pair Merkle trees
(twin of packages/sdk/src/merkle.ts, the OpenZeppelin MerkleProof convention used by
AccountabilityLedger.verifyReceipt)."""

from __future__ import annotations

from typing import Any

from eth_abi import encode

from .constants import OUTCOMES, SOURCES, TIERS
from .hexutil import hex_to_bytes, keccak, require_address, to_hex

RECEIPT_FIELDS: list[tuple[str, str]] = [
    ("receiptId", "bytes32"),
    ("chainId", "uint256"),
    ("agentId", "uint256"),
    ("mandateHash", "bytes32"),
    ("delegationHash", "bytes32"),
    ("intentHash", "bytes32"),
    ("planHash", "bytes32"),
    ("policyDecisionHash", "bytes32"),
    ("stateReadsHash", "bytes32"),
    ("counterpartyCheckHash", "bytes32"),
    ("simulationHash", "bytes32"),
    ("tier", "uint8"),
    ("approvalSigHash", "bytes32"),
    ("txHash", "bytes32"),
    ("outcome", "uint8"),
    ("explanationHash", "bytes32"),
    ("aigcHash", "bytes32"),
    ("source", "uint8"),
    ("prevReceiptHash", "bytes32"),
    ("timestamp", "uint64"),
]
RECEIPT_TYPE = "Receipt(" + ",".join(f"{t} {n}" for n, t in RECEIPT_FIELDS) + ")"
DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"
DOMAIN_NAME = "YINGLONG Accountability Ledger"
ZERO32_HASH = "0x" + "00" * 32
DOMAIN_VERSION = "1"


# Off-chain documents a receipt commits to (packages/sdk docHash), as apps/agent records them.
DOCUMENT_FIELDS = [
    ("intent", "intentHash"),
    ("plan", "planHash"),
    ("policy", "policyDecisionHash"),
    ("stateReads", "stateReadsHash"),
    ("counterparty", "counterpartyCheckHash"),
    ("simulation", "simulationHash"),
]


def receipt_domain(ledger_contract: str, chain_id: int, salt: str) -> dict:
    return {"name": DOMAIN_NAME, "version": DOMAIN_VERSION, "chainId": int(chain_id), "verifyingContract": ledger_contract, "salt": salt}


def domain_separator(domain: dict) -> bytes:
    return keccak(
        encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address", "bytes32"],
            [
                keccak(DOMAIN_TYPE.encode()),
                keccak(str(domain["name"]).encode("utf-8")),
                keccak(str(domain["version"]).encode("utf-8")),
                as_int(domain["chainId"]),
                require_address(domain["verifyingContract"], "verifyingContract"),
                hex_to_bytes(domain["salt"]),
            ],
        )
    )


def _enum(values: list[str], v: Any, what: str) -> int:
    if isinstance(v, int) and not isinstance(v, bool):
        if 0 <= v < len(values):
            return v
    elif isinstance(v, str) and v in values:
        return values.index(v)
    raise ValueError(f"receipt {what} must be one of {values}, got {v!r}")


def as_int(v: Any) -> int:
    """Integers may arrive as JSON numbers, decimal strings or the app's {"$n": "123"} bigint encoding."""
    if isinstance(v, dict) and isinstance(v.get("$n"), str):
        return int(v["$n"])
    if isinstance(v, bool):
        raise ValueError("expected an integer, got a boolean")
    if isinstance(v, str):
        return int(v, 0) if v.startswith(("0x", "0X")) else int(v)
    if isinstance(v, float) and not v.is_integer():
        raise ValueError(f"expected an integer, got {v}")
    return int(v)


def receipt_struct_hash(r: dict) -> bytes:
    vals: list[Any] = []
    for name, typ in RECEIPT_FIELDS:
        if name not in r:
            raise ValueError(f"receipt is missing {name}")
        v = r[name]
        if name == "tier":
            vals.append(_enum(TIERS, v, "tier"))
        elif name == "outcome":
            vals.append(_enum(OUTCOMES, v, "outcome"))
        elif name == "source":
            vals.append(_enum(SOURCES, v, "source"))
        elif typ == "bytes32":
            b = hex_to_bytes(v)
            if len(b) != 32:
                raise ValueError(f"receipt {name} must be 32 bytes")
            vals.append(b)
        else:
            vals.append(as_int(v))
    return keccak(encode(["bytes32"] + [t for _, t in RECEIPT_FIELDS], [keccak(RECEIPT_TYPE.encode())] + vals))


def receipt_hash(r: dict, domain: dict) -> str:
    """EIP-712 digest of a receipt: the Merkle leaf anchored in AccountabilityLedger batches."""
    return to_hex(keccak(b"\x19\x01" + domain_separator(domain) + receipt_struct_hash(r)))


# ---------------------------------------------------------------- Merkle (sorted pairs)


def hash_pair(a: str, b: str) -> str:
    a, b = a.lower(), b.lower()
    lo, hi = (a, b) if a < b else (b, a)
    return to_hex(keccak(hex_to_bytes(lo) + hex_to_bytes(hi)))


def build_merkle(leaves: list[str]) -> list[list[str]]:
    if not leaves:
        raise ValueError("empty tree")
    layers = [[x.lower() for x in leaves]]
    while len(layers[-1]) > 1:
        prev = layers[-1]
        layers.append([hash_pair(prev[i], prev[i + 1]) if i + 1 < len(prev) else prev[i] for i in range(0, len(prev), 2)])
    return layers


def merkle_root(leaves: list[str]) -> str:
    return build_merkle(leaves)[-1][0]


def merkle_proof(layers: list[list[str]], index: int) -> list[str]:
    proof = []
    i = index
    for layer in layers[:-1]:
        sib = i + 1 if i % 2 == 0 else i - 1
        if sib < len(layer):
            proof.append(layer[sib])
        i //= 2
    return proof


def process_proof(leaf: str, proof: list[str]) -> str:
    h = leaf.lower()
    for p in proof:
        h = hash_pair(h, p)
    return h


def verify_merkle(leaf: str, proof: list[str], root: str) -> bool:
    return process_proof(leaf, proof) == root.lower()
