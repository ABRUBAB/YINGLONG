"""Mandate document validation (twin of the zod MandateSchema in packages/mandate/src/schema.ts).

Like zod's default object parsing, unknown keys are STRIPPED: the compiler hashes the parsed document, so
an extra key in a file does not change the mandate hash. `parse_mandate` returns the stripped document.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from .constants import CATEGORY_IDS

MAX_SAFE_INTEGER = 2**53 - 1


class MandateError(ValueError):
    pass


Validator = Callable[[Any, str], Any]


def _fail(path: str, msg: str) -> MandateError:
    return MandateError(f"{path or '<root>'}: {msg}")


def string(min_len: int = 0, pattern: str | None = None) -> Validator:
    rx = re.compile(pattern) if pattern else None

    def v(x: Any, path: str) -> Any:
        if not isinstance(x, str):
            raise _fail(path, "expected string")
        if len(x.encode("utf-16-le", "surrogatepass")) // 2 < min_len:
            raise _fail(path, f"expected at least {min_len} character(s)")
        if rx is not None and rx.fullmatch(x) is None:
            raise _fail(path, f"does not match {pattern}")
        return x

    return v


def literal(value: str) -> Validator:
    def v(x: Any, path: str) -> Any:
        if x != value or not isinstance(x, str):
            raise _fail(path, f"expected {value!r}")
        return x

    return v


def enum(values: list[str]) -> Validator:
    def v(x: Any, path: str) -> Any:
        if not isinstance(x, str) or x not in values:
            raise _fail(path, f"expected one of {values}")
        return x

    return v


def integer(minimum: int | None = None, maximum: int | None = None) -> Validator:
    def v(x: Any, path: str) -> Any:
        if isinstance(x, bool) or not isinstance(x, (int, float)):
            raise _fail(path, "expected integer")
        if isinstance(x, float):
            if not x.is_integer():
                raise _fail(path, "expected integer")
            x = int(x)
        if abs(x) > MAX_SAFE_INTEGER:
            raise _fail(path, "expected a safe integer")
        if minimum is not None and x < minimum:
            raise _fail(path, f"expected >= {minimum}")
        if maximum is not None and x > maximum:
            raise _fail(path, f"expected <= {maximum}")
        return x

    return v


def array(item: Validator, min_len: int = 0, max_len: int | None = None) -> Validator:
    def v(x: Any, path: str) -> Any:
        if not isinstance(x, list):
            raise _fail(path, "expected array")
        if len(x) < min_len:
            raise _fail(path, f"expected at least {min_len} item(s)")
        if max_len is not None and len(x) > max_len:
            raise _fail(path, f"expected at most {max_len} item(s)")
        return [item(e, f"{path}[{i}]") for i, e in enumerate(x)]

    return v


def obj(shape: dict[str, Validator]) -> Validator:
    def v(x: Any, path: str) -> Any:
        if not isinstance(x, dict):
            raise _fail(path, "expected object")
        out = {}
        for k, val in shape.items():
            sub = f"{path}.{k}" if path else k
            if k not in x:
                raise _fail(sub, "required")
            out[k] = val(x[k], sub)
        return out  # unknown keys stripped, as zod does

    return v


def nullable(inner: Validator) -> Validator:
    def v(x: Any, path: str) -> Any:
        return None if x is None else inner(x, path)

    return v


address = string(pattern=r"^0x[0-9a-fA-F]{40}$")
units = string(pattern=r"^[0-9]+$")
category = enum(list(CATEGORY_IDS.keys()))
labelled_address = obj({"label": string(1), "address": address})

MANDATE = obj(
    {
        "schema": literal("yinglong.mandate/v1"),
        "title": string(1),
        "ledger": enum(["anvil", "base-sepolia", "fisco"]),
        "jurisdiction": enum(["hk", "international", "mainland"]),
        "principal": obj(
            {
                "kind": enum(["person", "company"]),
                "name": string(1),
                "did": string(1),
                "account": address,
            }
        ),
        "agent": obj({"wallet": address, "label": string(1)}),
        "lineageId": string(1),
        "salt": units,
        "validity": obj({"from": integer(0), "until": integer(1)}),
        "assets": array(obj({"symbol": string(1), "address": address, "decimals": integer(0, 36)}), 1),
        "methods": array(enum(["transfer", "transferAndCall", "instruct"]), 1),
        "payees": array(
            obj(
                {
                    "id": string(pattern=r"^[a-z0-9_]+$"),
                    "label": string(1),
                    "address": address,
                    "category": category,
                }
            )
        ),
        "trustedIssuers": array(labelled_address),
        "intermediaries": array(labelled_address),
        "tiers": array(
            obj(
                {
                    "asset": string(),
                    "defaultT1Cap": units,
                    "newPayeeT1Cap": units,
                    "t2Ceiling": units,
                    "maxApprovalWindow": integer(1),
                    "categoryT1Caps": array(obj({"category": category, "amount": units})),
                }
            )
        ),
        "budgets": array(
            obj(
                {
                    "asset": string(),
                    "periodStart": integer(0),
                    "periodLength": integer(1),
                    "unlistedCategory": category,
                    "caps": array(obj({"category": category, "amount": units}), 1),
                }
            )
        ),
        "reserveFloors": array(obj({"asset": string(), "amount": units})),
        "velocity": nullable(
            obj({"asset": string(), "window": integer(1), "maxCount": integer(1), "maxOutflow": units})
        ),
        "suitability": nullable(obj({"maxRiskClass": integer(1, 5)})),
        "reputation": nullable(
            obj(
                {
                    "clients": array(address, 1, 10),
                    "minScore": string(pattern=r"^-?[0-9]+$"),
                    "minScoreDecimals": integer(0, 18),
                    "tag1": string(),
                }
            )
        ),
        "facilitator": nullable(address),
        "sentences": array(string()),
    }
)


def parse_mandate(doc: Any) -> dict:
    """Validate a mandate document and return it with unknown keys stripped (zod semantics)."""
    return MANDATE(doc, "")


def is_mandate_document(doc: Any) -> bool:
    return isinstance(doc, dict) and doc.get("schema") == "yinglong.mandate/v1"
