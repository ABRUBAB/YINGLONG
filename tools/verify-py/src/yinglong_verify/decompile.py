"""Decode each caveat's terms by its enforcer and render the same English sentences as the TypeScript
decompiler (packages/mandate/src/decompile.ts). Bytes are the source of truth; labels are display only."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from eth_abi import decode

from .constants import CATEGORY_NAMES, CONTRACT_NAMES, PRETTY, PROFILE_LABELS, PROFILE_NAMES, SELECTOR_NAMES
from .delegation import Caveat
from .deployment import Deployment
from .hexutil import ZERO_ADDRESS, hex_to_bytes, to_checksum, to_hex


class DecodeError(ValueError):
    pass


@dataclass
class Names:
    label: dict[str, str] = field(default_factory=dict)  # lower-case address -> label
    decimals: dict[str, int] = field(default_factory=dict)  # lower-case asset address -> decimals


def names_for(d: Deployment, m: dict | None = None) -> Names:
    n = Names()
    for name in CONTRACT_NAMES:
        n.label[d.addr(name).lower()] = PRETTY.get(name, name)
    n.decimals[d.addr("TestHKD").lower()] = 6
    n.decimals[d.addr("TestUSD").lower()] = 6
    n.decimals[d.addr("ConditionalPaymentInstructions").lower()] = 2
    if m:
        for a in m.get("assets", []):
            n.label[a["address"].lower()] = a["symbol"]
            n.decimals[a["address"].lower()] = a["decimals"]
        for p in m.get("payees", []):
            n.label[p["address"].lower()] = p["label"]
        for i in m.get("trustedIssuers", []):
            n.label[i["address"].lower()] = i["label"]
        for i in m.get("intermediaries", []):
            n.label[i["address"].lower()] = i["label"]
    return n


def _cs(a: str) -> str:
    return to_checksum(a)


def _packed_addresses(terms: bytes) -> list[str]:
    if len(terms) % 20:
        raise DecodeError("packed address list has a bad length")
    return [_cs(to_hex(terms[i : i + 20])) for i in range(0, len(terms), 20)]


def _category(i: int) -> str:
    if i not in CATEGORY_NAMES:
        raise DecodeError(f"unknown category id {i}")
    return CATEGORY_NAMES[i]


def _profile(i: int) -> str:
    if i not in PROFILE_NAMES:
        raise DecodeError(f"unknown profile id {i}")
    return PROFILE_NAMES[i]


def _dec(types: list[str], t: bytes) -> tuple:
    try:
        return decode(types, t, strict=True)
    except Exception as e:  # noqa: BLE001 - surface any ABI decoding problem uniformly
        raise DecodeError(f"terms do not decode as ({','.join(types)}): {e}") from e


def decode_caveat(c: Caveat, d: Deployment) -> dict[str, Any]:
    """Return a rule dict with the same shape as the TypeScript DecodedRule (bigints as Python ints)."""
    # Extra contracts (e.g. the ZK private-mandate stack) are looked up too, as the TypeScript nameByAddress does.
    name = d.all_names_by_address().get(c.enforcer.lower())
    t = hex_to_bytes(c.terms)
    if name == "AllowedTargetsEnforcer":
        return {"kind": "allowedTargets", "targets": _packed_addresses(t)}
    if name == "AllowedMethodsEnforcer":
        methods = []
        for i in range(0, len(t), 4):
            sel = to_hex(t[i : i + 4])
            methods.append(SELECTOR_NAMES.get(sel, sel))
        return {"kind": "allowedMethods", "methods": methods}
    if name == "ValueLteEnforcer":
        return {"kind": "valueLte", "max": _dec(["uint256"], t)[0]}
    if name == "ForbiddenTargetsEnforcer":
        return {"kind": "forbiddenTargets", "targets": _packed_addresses(t)}
    if name == "GlobalPauseEnforcer":
        k, p = _dec(["address", "address"], t)
        return {"kind": "globalPause", "killSwitch": _cs(k), "passport": _cs(p)}
    if name == "AgentLineageEnforcer":
        p, h, f = _dec(["address", "bytes32", "address"], t)
        return {"kind": "agentLineage", "passport": _cs(p), "ownerDidHash": to_hex(h), "facilitator": _cs(f)}
    if name == "MandateBindingEnforcer":
        r, h = _dec(["address", "bytes32"], t)
        return {"kind": "mandateBinding", "registry": _cs(r), "mandateHash": to_hex(h)}
    if name == "JurisdictionEnforcer":
        prof, assets = _dec(["uint8", "address[]"], t)
        return {"kind": "jurisdiction", "profile": _profile(prof), "assets": [_cs(a) for a in assets]}
    if name == "VerifiedPayeeEnforcer":
        pb, pp, iss, inter = _dec(["address", "address", "address[]", "address[]"], t)
        return {
            "kind": "verifiedPayee",
            "payeeBook": _cs(pb),
            "passport": _cs(pp),
            "issuers": [_cs(a) for a in iss],
            "intermediaries": [_cs(a) for a in inter],
        }
    if name == "CoSignEnforcer":
        pb, asset, dflt, newp, t2, win, cats, caps = _dec(
            ["address", "address", "uint256", "uint256", "uint256", "uint256", "uint32[]", "uint256[]"], t
        )
        if len(cats) != len(caps):
            raise DecodeError("CoSignEnforcer category and cap arrays differ in length")
        return {
            "kind": "coSign",
            "payeeBook": _cs(pb),
            "asset": _cs(asset),
            "defaultT1Cap": dflt,
            "newPayeeT1Cap": newp,
            "t2Ceiling": t2,
            "maxApprovalWindow": win,
            "categoryT1Caps": [{"category": _category(cc), "amount": caps[i]} for i, cc in enumerate(cats)],
        }
    if name == "CategoryBudgetEnforcer":
        pb, asset, start, length, unlisted, cats, caps = _dec(
            ["address", "address", "uint64", "uint64", "uint32", "uint32[]", "uint256[]"], t
        )
        if len(cats) != len(caps):
            raise DecodeError("CategoryBudgetEnforcer category and cap arrays differ in length")
        return {
            "kind": "categoryBudget",
            "payeeBook": _cs(pb),
            "asset": _cs(asset),
            "periodStart": start,
            "periodLength": length,
            "unlistedCategory": _category(unlisted),
            "caps": [{"category": _category(cc), "amount": caps[i]} for i, cc in enumerate(cats)],
        }
    if name == "ReserveFloorEnforcer":
        asset, amount = _dec(["address", "uint256"], t)
        return {"kind": "reserveFloor", "asset": _cs(asset), "amount": amount}
    if name == "VelocityEnforcer":
        asset, window, count, outflow = _dec(["address", "uint64", "uint32", "uint256"], t)
        return {"kind": "velocity", "asset": _cs(asset), "window": window, "maxCount": count, "maxOutflow": outflow}
    if name == "SuitabilityEnforcer":
        reg, rc = _dec(["address", "uint8"], t)
        return {"kind": "suitability", "registry": _cs(reg), "maxRiskClass": rc}
    if name == "ZKMandateEnforcer":
        router, commitment = _dec(["address", "bytes32"], t)
        return {"kind": "zkMandate", "router": _cs(router), "commitment": "0x" + commitment.hex()}
    return {"kind": "unknown", "enforcer": c.enforcer, "terms": c.terms}


# ---------------------------------------------------------------- English sentences


def format_units(amount: int, decimals: int) -> str:
    neg = amount < 0
    a = -amount if neg else amount
    base = 10**decimals
    whole = f"{a // base:,}"
    frac = str(a % base).rjust(decimals, "0").rstrip("0") if decimals > 0 else ""
    return f"{'-' if neg else ''}{whole}{'.' + frac if frac else ''}"


def duration(seconds: int, unit: str = "s") -> str:
    s = seconds // 1000 if unit == "ms" else seconds
    if s % 86400 == 0:
        return "day" if s == 86400 else f"{s // 86400} days"
    if s % 3600 == 0:
        return "hour" if s == 3600 else f"{s // 3600} hours"
    if s % 60 == 0:
        return f"{s // 60} minutes"
    return f"{s} seconds"


def _list(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


def sentence(r: dict[str, Any], names: Names, time_unit: str = "s") -> str:
    def L(a: str) -> str:  # noqa: N802 - mirrors the TypeScript helper name
        return names.label.get(a.lower(), f"{a[:6]}...{a[-4:]}")

    def amt(asset: str, v: int) -> str:
        return f"{format_units(v, names.decimals.get(asset.lower(), 0))} {L(asset)}"

    k = r["kind"]
    if k == "allowedTargets":
        return f"The agent can only touch these assets: {_list([L(a) for a in r['targets']])}."
    if k == "allowedMethods":
        return f"It can only call: {_list(r['methods'])}. Approvals and any other function are refused."
    if k == "valueLte":
        return "It can never send the native coin." if r["max"] == 0 else f"It can send at most {r['max']} wei of the native coin."
    if k == "forbiddenTargets":
        return f"It can never call your own account or {len(r['targets'])} protocol contracts ({_list([L(a) for a in r['targets']])})."
    if k == "globalPause":
        return "Everything stops the moment you press Pause, your guardian pauses, or the supervisor halts this agent."
    if k == "agentLineage":
        if r["facilitator"] == ZERO_ADDRESS:
            return "Only agents whose passport is bound to your identity can use this mandate."
        return (
            "Only agents whose passport is bound to your identity, or the pinned payment facilitator "
            f"{L(r['facilitator'])} for single-use payments, can use this mandate."
        )
    if k == "mandateBinding":
        return f"It works only while mandate {r['mandateHash'][:10]}... is live in the public mandate registry."
    if k == "jurisdiction":
        return f"Jurisdiction: {PROFILE_LABELS[r['profile']]}. Rails allowed: {_list([L(a) for a in r['assets']])}."
    if k == "verifiedPayee":
        who = f" or to agents attested by {_list([L(a) for a in r['issuers']])}" if r["issuers"] else ""
        via = f", through {_list([L(a) for a in r['intermediaries']])} only" if r["intermediaries"] else ""
        return f"Money goes only to payees in your payee book{who}{via}."
    if k == "coSign":
        special = [f"{c['category']} up to {amt(r['asset'], c['amount'])}" for c in r["categoryT1Caps"]]
        s1 = f"Payments above {amt(r['asset'], r['defaultT1Cap'])} need your approval on your phone"
        s2 = f" (except {_list(special)})" if special else ""
        return (
            f"{s1}{s2}; anyone new above {amt(r['asset'], r['newPayeeT1Cap'])} also needs you; "
            f"nothing above {amt(r['asset'], r['t2Ceiling'])} is possible at all."
        )
    if k == "categoryBudget":
        caps = _list([f"{c['category']} at most {amt(r['asset'], c['amount'])}" for c in r["caps"]])
        return f"Every {duration(r['periodLength'], time_unit)}: {caps}."
    if k == "reserveFloor":
        return f"Your {L(r['asset'])} balance never goes below {amt(r['asset'], r['amount'])}."
    if k == "velocity":
        return f"At most {r['maxCount']} payments and {amt(r['asset'], r['maxOutflow'])} per {duration(r['window'], time_unit)}."
    if k == "suitability":
        return f"Idle cash goes only into products of risk class {r['maxRiskClass']} or lower."
    if k == "zkMandate":
        return (
            "Private mandate: every payment must carry a zero-knowledge proof that it stays within the hidden cap, "
            f"payee list and expiry committed as {r['commitment'][:10]}..."
        )
    return f"Unknown rule at {r['enforcer']}; refuse to seal."


def decompile(caveats: list[Caveat], d: Deployment, names: Names, time_unit: str = "s") -> tuple[list[dict], list[str]]:
    rules = [decode_caveat(c, d) for c in caveats]
    return rules, [sentence(r, names, time_unit) for r in rules]


def rule_to_json(r: Any) -> Any:
    """Rules in the golden-file JSON shape (integers as decimal strings, like the TypeScript bigint replacer).
    Small uint8/uint32 fields stay numbers, as viem decodes them to JavaScript numbers."""
    small = {"maxCount", "maxRiskClass"}

    def conv(k: str | None, v: Any) -> Any:
        if isinstance(v, bool):
            return v
        if isinstance(v, int):
            return v if k in small else str(v)
        if isinstance(v, dict):
            return {kk: conv(kk, vv) for kk, vv in v.items()}
        if isinstance(v, list):
            return [conv(None, x) for x in v]
        return v

    return conv(None, r)
