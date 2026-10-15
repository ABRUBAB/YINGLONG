"""ERC-7710 delegation hash, exactly as MetaMask Delegation Framework v1.3.0 EncoderLib / DelegationManager.

  caveatHash  = keccak256(abi.encode(CAVEAT_TYPEHASH, enforcer, keccak256(terms)))      (args NOT hashed)
  arrayHash   = keccak256(caveatHash_0 || caveatHash_1 || ...)                           (keccak of "" if none)
  delegation  = keccak256(abi.encode(DELEGATION_TYPEHASH, delegate, delegator, authority, arrayHash, salt))
This 32-byte value is H: the hash DelegationManager.getDelegationHash returns, the key of
disabledDelegations, the value MandateRegistry.delegationOf records, and the input of the Hash Ring.
"""

from __future__ import annotations

from dataclasses import dataclass

from eth_abi import encode

from .constants import CAVEAT_TYPE, DELEGATION_TYPE, ROOT_AUTHORITY
from .hexutil import hex_to_bytes, keccak, require_address, to_hex

DELEGATION_TYPEHASH = keccak(DELEGATION_TYPE.encode("ascii"))
CAVEAT_TYPEHASH = keccak(CAVEAT_TYPE.encode("ascii"))


@dataclass
class Caveat:
    enforcer: str
    terms: str  # 0x hex
    args: str = "0x"

    def to_json(self) -> dict:
        return {"enforcer": self.enforcer, "terms": self.terms, "args": self.args}

    @staticmethod
    def from_json(o: dict) -> "Caveat":
        return Caveat(o["enforcer"], o["terms"].lower(), (o.get("args") or "0x").lower())


def caveat_hash(c: Caveat) -> bytes:
    return keccak(encode(["bytes32", "address", "bytes32"], [CAVEAT_TYPEHASH, require_address(c.enforcer, "enforcer"), keccak(hex_to_bytes(c.terms))]))


def caveat_array_hash(caveats: list[Caveat]) -> bytes:
    return keccak(b"".join(caveat_hash(c) for c in caveats))


def delegation_hash(delegate: str, delegator: str, caveats: list[Caveat], salt: int, authority: str = ROOT_AUTHORITY) -> str:
    return to_hex(
        keccak(
            encode(
                ["bytes32", "address", "address", "bytes32", "bytes32", "uint256"],
                [
                    DELEGATION_TYPEHASH,
                    require_address(delegate, "delegate"),
                    require_address(delegator, "delegator"),
                    hex_to_bytes(authority),
                    caveat_array_hash(caveats),
                    int(salt),
                ],
            )
        )
    )
