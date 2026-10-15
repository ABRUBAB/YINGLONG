"""Hashing and hex helpers (keccak256 via pycryptodome; EIP-55 checksums computed here, not imported)."""

from __future__ import annotations

import re

from Crypto.Hash import keccak as _keccak

_ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{40}")
_HEX_RE = re.compile(r"0x(?:[0-9a-fA-F]{2})*")

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
ZERO32 = "0x" + "00" * 32


def keccak(data: bytes) -> bytes:
    h = _keccak.new(digest_bits=256)
    h.update(data)
    return h.digest()


def keccak_hex(data: bytes) -> str:
    return "0x" + keccak(data).hex()


def text_hash(s: str) -> str:
    """keccak256 of the UTF-8 bytes of a string (viem keccak256(stringToBytes(s)))."""
    return keccak_hex(s.encode("utf-8"))


def hex_to_bytes(h: str) -> bytes:
    if not isinstance(h, str) or not h.startswith(("0x", "0X")):
        raise ValueError(f"not a 0x hex string: {h!r}")
    body = h[2:]
    if len(body) % 2:
        raise ValueError(f"odd-length hex string: {h!r}")
    return bytes.fromhex(body)


def to_hex(b: bytes) -> str:
    return "0x" + b.hex()


def is_hex_bytes(h: str) -> bool:
    return isinstance(h, str) and _HEX_RE.fullmatch(h) is not None


def to_checksum(address: str) -> str:
    """EIP-55 mixed-case checksum address."""
    if not isinstance(address, str) or _ADDRESS_RE.fullmatch(address) is None:
        raise ValueError(f"not an address: {address!r}")
    lower = address[2:].lower()
    digest = keccak(lower.encode("ascii")).hex()
    return "0x" + "".join(c.upper() if c.isalpha() and int(digest[i], 16) >= 8 else c for i, c in enumerate(lower))


def is_address(address: object, strict: bool = True) -> bool:
    """viem isAddress semantics: 0x + 40 hex; unless all lower case (and when strict), the EIP-55 checksum
    must hold (so an all-upper-case address is refused, exactly as viem refuses it)."""
    if not isinstance(address, str) or _ADDRESS_RE.fullmatch(address) is None:
        return False
    if not strict or address == address.lower():
        return True
    return to_checksum(address) == address


def require_address(address: object, what: str = "address") -> str:
    if not is_address(address):
        raise ValueError(f"invalid {what} (bad format or EIP-55 checksum): {address!r}")
    return address  # type: ignore[return-value]


def addr_bytes(address: str) -> bytes:
    return bytes.fromhex(require_address(address)[2:])


def same_address(a: str, b: str) -> bool:
    return a.lower() == b.lower()


def short(h: str, head: int = 10, tail: int = 4) -> str:
    return h if len(h) <= head + tail + 3 else f"{h[:head]}...{h[-tail:]}"
