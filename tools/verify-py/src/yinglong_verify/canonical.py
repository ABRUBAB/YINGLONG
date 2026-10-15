"""Canonical JSON and the mandate hash (twin of packages/mandate/src/canonical.ts).

For ordinary documents this is exactly json.dumps(obj, sort_keys=True, separators=(",", ":"),
ensure_ascii=False). Two corner cases are handled explicitly so the output is byte-identical to the
TypeScript JSON.stringify-based serializer in every case:
  - object keys are sorted by UTF-16 code units (JavaScript string order), not by code points;
  - lone surrogates are escaped as \\udxxx (well-formed JSON.stringify) instead of being emitted raw.
Numbers must be safe integers (amounts are decimal strings); floats are refused, as in TypeScript.
"""

from __future__ import annotations

import json
from typing import Any

from .hexutil import keccak_hex

MAX_SAFE_INTEGER = 2**53 - 1


def _utf16_key(s: str) -> bytes:
    return s.encode("utf-16-be", "surrogatepass")


def _quote(s: str) -> str:
    if not any(0xD800 <= ord(c) <= 0xDFFF for c in s):
        return json.dumps(s, ensure_ascii=False)
    parts = []
    for c in s:
        if 0xD800 <= ord(c) <= 0xDFFF:
            parts.append(f"\\u{ord(c):04x}")
        else:
            parts.append(json.dumps(c, ensure_ascii=False)[1:-1])
    return '"' + "".join(parts) + '"'


def canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _quote(value)
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise ValueError(f"canonical JSON allows safe integers only, got {value}")
        return str(value)
    if isinstance(value, float):
        # JSON.parse turns 5.0 into the integer 5; anything else is refused (no floats for money).
        if value.is_integer() and abs(value) <= MAX_SAFE_INTEGER:
            return str(int(value))
        raise ValueError(f"canonical JSON allows safe integers only, got {value!r}")
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda kv: _utf16_key(kv[0]))
        return "{" + ",".join(f"{_quote(k)}:{canonical_json(v)}" for k, v in items) + "}"
    raise ValueError(f"unsupported value in canonical JSON: {type(value).__name__}")


def canonical_hash(value: Any) -> str:
    return keccak_hex(canonical_json(value).encode("utf-8"))


# ---------------------------------------------------------------- JSON.stringify twin (insertion order)


def js_number(x: int | float) -> str:
    """ECMAScript Number::toString(10) for a value parsed from JSON (shortest round-trip digits)."""
    import math
    from decimal import Decimal

    if isinstance(x, int) and abs(x) <= MAX_SAFE_INTEGER:
        return str(x)
    f = float(x)
    if math.isnan(f) or math.isinf(f):
        return "null"
    if f == 0:
        return "0"
    sign = "-" if f < 0 else ""
    t = Decimal(repr(abs(f))).as_tuple()
    digits = "".join(map(str, t.digits)).rstrip("0") or "0"
    stripped = len("".join(map(str, t.digits))) - len(digits)
    k = len(digits)
    n = t.exponent + stripped + k  # value = 0.digits * 10^n
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    es = f"e{'+' if e >= 0 else '-'}{abs(e)}"
    return sign + (digits if k == 1 else digits[0] + "." + digits[1:]) + es


def js_stringify(value: Any) -> str:
    """JSON.stringify(value) for JSON-shaped data: keys in insertion order, JavaScript number formatting.
    Values written as {"$n": "123"} (the app's bigint encoding) are emitted as the string "123", as the
    TypeScript docHash replacer does for bigints."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _quote(value)
    if isinstance(value, (int, float)):
        return js_number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(js_stringify(v) for v in value) + "]"
    if isinstance(value, dict):
        if len(value) == 1 and isinstance(value.get("$n"), str):
            return _quote(value["$n"])
        return "{" + ",".join(f"{_quote(k)}:{js_stringify(v)}" for k, v in value.items()) + "}"
    raise ValueError(f"unsupported value for JSON.stringify: {type(value).__name__}")


def doc_hash(value: Any) -> str:
    """Twin of packages/sdk docHash: keccak256 of JSON.stringify(doc) with bigints as decimal strings."""
    return keccak_hex(js_stringify(value).encode("utf-8"))
