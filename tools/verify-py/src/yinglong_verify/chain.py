"""Typed reads of YINGLONG contracts through the bundled ABIs."""

from __future__ import annotations

from typing import Any

from eth_abi import decode, encode

from .abi import canonical_type, load_abi, registry, signature
from .deployment import Deployment
from .hexutil import hex_to_bytes, keccak, to_hex
from .rpc import Rpc, RpcError

MANDATE_STATUS = ["None", "Live", "Superseded", "Revoked"]


def function_abi(abi_name: str, fn: str, n_inputs: int | None = None) -> dict:
    for item in load_abi(abi_name):
        if item.get("type") == "function" and item["name"] == fn and (n_inputs is None or len(item["inputs"]) == n_inputs):
            return item
    raise KeyError(f"{abi_name} has no function {fn}")


def calldata(abi_name: str, fn: str, args: list) -> bytes:
    item = function_abi(abi_name, fn, len(args))
    return keccak(signature(item).encode())[:4] + encode([canonical_type(i) for i in item["inputs"]], args)


def call(rpc: Rpc, address: str, abi_name: str, fn: str, args: list, block: str | int = "latest") -> tuple:
    item = function_abi(abi_name, fn, len(args))
    ret = rpc.eth_call(address, calldata(abi_name, fn, args), block)
    return decode([canonical_type(o) for o in item["outputs"]], ret)


def call_or_revert(rpc: Rpc, address: str, abi_name: str, fn: str, args: list) -> tuple[tuple | None, str | None]:
    """Return (outputs, None) or (None, decoded revert message)."""
    try:
        return call(rpc, address, abi_name, fn, args), None
    except RpcError as e:
        from .rpc import extract_revert_data

        data = extract_revert_data(e)
        if data:
            return None, registry().decode_revert(data).message
        return None, str(e)


def mandate_of(rpc: Rpc, d: Deployment, mandate_hash: str) -> dict[str, Any]:
    (m,) = call(rpc, d.addr("MandateRegistry"), "MandateRegistry", "mandateOf", [hex_to_bytes(mandate_hash)])
    account, agent, dh, lineage, caveats_hash, version, jurisdiction, status, vf, vu, published_at = m
    return {
        "account": account,
        "agent": agent,
        "delegationHash": to_hex(dh),
        "lineageId": to_hex(lineage),
        "caveatsHash": to_hex(caveats_hash),
        "version": version,
        "jurisdiction": jurisdiction,
        "status": MANDATE_STATUS[status] if status < len(MANDATE_STATUS) else str(status),
        "validFrom": vf,
        "validUntil": vu,
        "publishedAt": published_at,
    }


def abi_by_address(d: Deployment) -> dict[str, str]:
    from .constants import ABI_OF_CONTRACT, CONTRACT_NAMES

    from .abi import abi_names

    known = set(abi_names())
    out = {}
    for n, v in d.extra.items():
        if isinstance(v, dict) and "address" in v and ABI_OF_CONTRACT.get(n, n) in known:
            out[v["address"].lower()] = ABI_OF_CONTRACT.get(n, n)
    for n in CONTRACT_NAMES:
        out[d.addr(n).lower()] = ABI_OF_CONTRACT.get(n, n)
    return out
