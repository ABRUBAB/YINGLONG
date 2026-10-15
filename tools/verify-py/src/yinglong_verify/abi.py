"""Bundled ABIs (exported from contracts/out by scripts/sync-data.py), event-log and revert decoding."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Any

from eth_abi import decode

from .hexutil import hex_to_bytes, keccak, to_checksum, to_hex

PANIC_CODES = {
    0x00: "generic compiler panic",
    0x01: "assert failed",
    0x11: "arithmetic overflow or underflow",
    0x12: "division or modulo by zero",
    0x21: "invalid enum value",
    0x22: "bad storage byte array encoding",
    0x31: "pop on empty array",
    0x32: "array index out of bounds",
    0x41: "out of memory",
    0x51: "call to zero-initialised function",
}


def canonical_type(p: dict) -> str:
    t = p["type"]
    if t.startswith("tuple"):
        return "(" + ",".join(canonical_type(c) for c in p.get("components", [])) + ")" + t[len("tuple") :]
    return t


def signature(item: dict) -> str:
    return f"{item['name']}({','.join(canonical_type(i) for i in item.get('inputs', []))})"


@lru_cache(maxsize=None)
def load_abi(name: str) -> list[dict]:
    p = resources.files("yinglong_verify").joinpath("abi", f"{name}.json")
    return json.loads(p.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def abi_names() -> list[str]:
    d = resources.files("yinglong_verify").joinpath("abi")
    return sorted(p.name[:-5] for p in d.iterdir() if p.name.endswith(".json"))


def fmt_value(v: Any, p: dict | None = None) -> Any:
    """ABI value to a JSON-friendly value (bytes as hex, addresses checksummed, tuples as dicts)."""
    t = p["type"] if p else ""
    if isinstance(v, bytes):
        return to_hex(v)
    if isinstance(v, str) and t == "address":
        return to_checksum(v)
    if isinstance(v, (list, tuple)):
        if p and t.endswith("]"):
            inner = dict(p)
            inner["type"] = t[: t.rindex("[")]
            return [fmt_value(x, inner) for x in v]
        if p and t.startswith("tuple"):
            comps = p.get("components", [])
            return {(c.get("name") or str(i)): fmt_value(x, c) for i, (x, c) in enumerate(zip(v, comps))}
        return [fmt_value(x) for x in v]
    return v


@dataclass
class DecodedEvent:
    contract: str
    name: str
    signature: str
    args: dict[str, Any]
    address: str
    log_index: int


@dataclass
class DecodedRevert:
    name: str
    args: dict[str, Any]
    message: str
    raw: str


class Registry:
    def __init__(self) -> None:
        self.events: dict[bytes, list[tuple[str, dict]]] = {}
        self.errors: dict[bytes, dict] = {}
        for n in abi_names():
            for item in load_abi(n):
                if item.get("type") == "event" and not item.get("anonymous"):
                    topic = keccak(signature(item).encode())
                    self.events.setdefault(topic, []).append((n, item))
                elif item.get("type") == "error":
                    self.errors.setdefault(keccak(signature(item).encode())[:4], item)
        self.errors[keccak(b"Error(string)")[:4]] = {"type": "error", "name": "Error", "inputs": [{"name": "reason", "type": "string"}]}
        self.errors[keccak(b"Panic(uint256)")[:4]] = {"type": "error", "name": "Panic", "inputs": [{"name": "code", "type": "uint256"}]}

    def decode_log(self, log: dict, abi_by_address: dict[str, str] | None = None) -> DecodedEvent | None:
        topics = [hex_to_bytes(t) for t in log.get("topics", [])]
        if not topics or topics[0] not in self.events:
            return None
        cands = self.events[topics[0]]
        addr = log["address"].lower()
        preferred = (abi_by_address or {}).get(addr)
        cands = sorted(cands, key=lambda c: 0 if c[0] == preferred else 1)
        for contract, item in cands:
            ev = self._try_decode(item, topics, hex_to_bytes(log.get("data", "0x")))
            if ev is not None:
                return DecodedEvent(contract, item["name"], signature(item), ev, to_checksum(log["address"]), int(log.get("logIndex", "0x0"), 16))
        return None

    @staticmethod
    def _try_decode(item: dict, topics: list[bytes], data: bytes) -> dict | None:
        inputs = item.get("inputs", [])
        indexed = [i for i in inputs if i.get("indexed")]
        plain = [i for i in inputs if not i.get("indexed")]
        if len(indexed) != len(topics) - 1:
            return None
        out: dict[str, Any] = {}
        try:
            for p, topic in zip(indexed, topics[1:]):
                t = canonical_type(p)
                if t in ("string", "bytes") or t.endswith("]") or t.startswith("("):
                    out[p["name"]] = {"topicHash": to_hex(topic)}
                else:
                    out[p["name"]] = fmt_value(decode([t], topic)[0], p)
            vals = decode([canonical_type(p) for p in plain], data) if plain else ()
            for p, v in zip(plain, vals):
                out[p["name"] or f"arg{len(out)}"] = fmt_value(v, p)
        except Exception:  # noqa: BLE001 - try the next candidate ABI
            return None
        return out

    def decode_revert(self, data: str | bytes | None, depth: int = 0) -> DecodedRevert:
        raw = data if isinstance(data, str) else to_hex(data or b"")
        b = hex_to_bytes(raw) if raw else b""
        if len(b) == 0:
            return DecodedRevert("Unknown", {}, "reverted without data", "0x")
        if len(b) < 4:
            return DecodedRevert("Unknown", {}, f"unknown revert {raw}", raw)
        item = self.errors.get(b[:4])
        if item is None:
            return DecodedRevert("Unknown", {}, f"unknown revert {raw[:10]}", raw)
        try:
            vals = decode([canonical_type(p) for p in item["inputs"]], b[4:])
        except Exception:  # noqa: BLE001
            return DecodedRevert(item["name"], {}, f"{item['name']}(<undecodable arguments>)", raw)
        args = {(p.get("name") or f"arg{i}"): fmt_value(v, p) for i, (p, v) in enumerate(zip(item["inputs"], vals))}
        if item["name"] == "Error":
            return DecodedRevert("Error", args, str(args.get("reason", "")), raw)
        if item["name"] == "Panic":
            code = int(args["code"])
            return DecodedRevert("Panic", args, f"Panic(0x{code:02x}: {PANIC_CODES.get(code, 'unknown panic')})", raw)
        parts = []
        for p, v in zip(item["inputs"], vals):
            if p["type"] == "bytes" and isinstance(v, bytes) and len(v) >= 4 and depth < 3:
                inner = self.decode_revert(v, depth + 1)
                parts.append(f"{inner.message}" if inner.name != "Unknown" else to_hex(v))
            else:
                parts.append(str(fmt_value(v, p)))
        return DecodedRevert(item["name"], args, f"{item['name']}({', '.join(parts)})", raw)


@lru_cache(maxsize=1)
def registry() -> Registry:
    return Registry()
