"""Round-trip mandate verification (the Python twin of packages/mandate/src/roundtrip.ts, plus the on-chain
reads the TypeScript caller performs).

What is checked, in order:
  document   the mandate document is valid; its canonical JSON and keccak256 mandate hash are recomputed
  compiler   the caveats are compiled again here, in Python, from the enforcers' term layouts
  published  the caveats published on-chain (MandatePublished event) equal the compiled caveats byte for byte
  hash       the delegation hash recomputed here from the published caveats equals the registry's record and
             DelegationManager.getDelegationHash (the hash it will accept)
  status     the registry says the mandate is live and the DelegationManager has not disabled the delegation
  code       every enforcer (and the DelegationManager and registry) has the code hash of the deployment table
  meaning    every caveat decodes into a rule and an English sentence; each enforcer's own getTermsInfo agrees
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from eth_abi import encode

from . import chain as ch
from .abi import load_abi, registry, signature
from .canonical import canonical_hash, canonical_json
from .compile import CompileError, Compiled, compile_mandate
from .constants import PROFILE_IDS, ROOT_AUTHORITY, SELECTORS
from .decompile import DecodeError, decode_caveat, names_for, rule_to_json, sentence
from .delegation import Caveat, delegation_hash
from .deployment import Deployment, Ledger, bundled_path, ledger, load_deployment
from .hashring import ascii_strip, geometry
from .hexutil import hex_to_bytes, keccak, same_address, short, text_hash, to_hex
from .report import FAIL, INFO, PASS, SKIP, Report
from .rpc import Rpc, RpcError, RpcUnavailable
from .schema import MandateError, is_mandate_document, parse_mandate

SNAPSHOT_KIND = "yinglong.verify.snapshot/v1"
HASH_RE = re.compile(r"0x[0-9a-fA-F]{64}")


class InputError(ValueError):
    pass


@dataclass
class Input:
    kind: str  # golden | mandate | snapshot | hash
    source: str
    raw: dict | None = None
    mandate: dict | None = None
    mandate_hash: str | None = None


def load_input(arg: str) -> Input:
    if HASH_RE.fullmatch(arg):
        return Input("hash", "mandate hash given on the command line", mandate_hash=arg.lower())
    p = Path(arg)
    if not p.exists():
        name = arg.removeprefix("golden:").removesuffix(".json")
        bp = bundled_path("golden", f"{name}.json")
        if not bp.exists():
            raise InputError(f"{arg}: no such file, and no bundled golden vector named {name!r} (try nadia or lotus)")
        p = bp
        src = f"bundled golden vector {name} ({p})"
    else:
        src = str(p)
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise InputError(f"{p}: not valid JSON ({e})") from e
    if not isinstance(raw, dict):
        raise InputError(f"{p}: expected a JSON object")
    if raw.get("kind") == SNAPSHOT_KIND:
        return Input("snapshot", src, raw, raw.get("mandate"), raw.get("mandateHash"))
    if isinstance(raw.get("mandate"), dict) and "caveats" in raw and "delegationHash" in raw:
        return Input("golden", src, raw, raw["mandate"])
    if is_mandate_document(raw):
        return Input("mandate", src, raw, raw)
    if isinstance(raw.get("mandate"), dict) and is_mandate_document(raw["mandate"]):
        return Input("mandate", src, raw, raw["mandate"])
    raise InputError(f"{p}: not a mandate document (schema yinglong.mandate/v1), golden vector or verify snapshot")


@dataclass
class Published:
    """What the ledger holds for one mandate (or a recorded snapshot of it)."""

    source: str
    caveats: list[Caveat]
    delegator: str
    delegate: str
    salt: int
    lineage_id: str
    jurisdiction: int
    valid_from: int
    valid_until: int
    version: int
    recorded_hash: str  # MandatePublished.delegationHash / registry delegationOf
    tx_hash: str | None = None
    block_number: int | None = None
    registry: dict[str, Any] = field(default_factory=dict)  # mandateOf + delegationOf + isLive
    dm_hash: str | None = None  # DelegationManager.getDelegationHash
    disabled: bool | None = None


@dataclass
class Result:
    report: Report
    ledger: Ledger
    deployment: Deployment
    mandate: dict | None
    mandate_hash: str | None
    compiled: Compiled | None
    published: Published | None
    sentences: list[str]
    rules: list[dict]
    ring_hash: str | None
    revoked: bool
    code_rows: list[list[str]] = field(default_factory=list)
    terms_rows: list[list[str]] = field(default_factory=list)
    snapshot: dict | None = None
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- helpers


def caveats_abi_value(caveats: list[Caveat]) -> list[tuple]:
    return [(c.enforcer, hex_to_bytes(c.terms), hex_to_bytes(c.args)) for c in caveats]


def caveats_encoded_hash(caveats: list[Caveat]) -> str:
    """keccak256(abi.encode(caveats)) as MandateRegistry stores it in caveatsHash (args included)."""
    return to_hex(keccak(encode(["(address,bytes,bytes)[]"], [caveats_abi_value(caveats)])))


def first_caveat_difference(a: list[Caveat], b: list[Caveat], names: dict[str, str]) -> str | None:
    if len(a) != len(b):
        return f"{len(a)} vs {len(b)} caveats"
    for i, (x, y) in enumerate(zip(a, b)):
        if not same_address(x.enforcer, y.enforcer):
            return f"caveat {i}: enforcer {names.get(x.enforcer.lower(), x.enforcer)} vs {names.get(y.enforcer.lower(), y.enforcer)}"
        if x.terms.lower() != y.terms.lower():
            return f"caveat {i} ({names.get(x.enforcer.lower(), x.enforcer)}): terms differ ({short(x.terms, 18, 8)} vs {short(y.terms, 18, 8)})"
    return None


def _event_topic(name: str, abi_name: str) -> bytes:
    for item in load_abi(abi_name):
        if item.get("type") == "event" and item["name"] == name:
            return keccak(signature(item).encode())
    raise KeyError(name)


def _first_block_at_or_after(rpc: Rpc, ts: int, lo: int, hi: int) -> int:
    while lo < hi:
        mid = (lo + hi) // 2
        if int(rpc.get_block(mid)["timestamp"], 16) < ts:
            lo = mid + 1
        else:
            hi = mid
    return lo


def find_published_log(rpc: Rpc, d: Deployment, mandate_hash: str, from_block: int, published_at: int | None, chunk: int = 2000) -> tuple[dict | None, str]:
    """Locate the MandatePublished log for a mandate hash, coping with RPC range limits and with ledgers
    (FISCO BCOS) that need every filter field present and lower-case topics."""
    reg = d.addr("MandateRegistry")
    t0 = to_hex(_event_topic("MandatePublished", "MandateRegistry"))
    mh = mandate_hash.lower()
    latest = rpc.block_number()

    def match(logs: list[dict]) -> dict | None:
        for lg in logs:
            ts = [t.lower() for t in lg.get("topics", [])]
            if len(ts) >= 3 and ts[0] == t0 and ts[2] == mh:
                return lg
        return None

    errors: list[str] = []
    try:
        hit = match(rpc.get_logs(reg, [t0, None, mh], from_block, latest))
        if hit:
            return hit, "eth_getLogs over the deployment range"
    except RpcError as e:
        errors.append(str(e))
    try:
        hit = match(rpc.get_logs(reg, [t0], from_block, latest))
        if hit:
            return hit, "eth_getLogs (topic0 only) over the deployment range"
    except RpcError as e:
        errors.append(str(e))
    if published_at:
        try:
            start = _first_block_at_or_after(rpc, published_at, from_block, latest)
            end = start
            while end < latest and end - start < 64 and int(rpc.get_block(end + 1)["timestamp"], 16) <= published_at:
                end += 1
            hit = match(rpc.get_logs(reg, [t0], start, end))
            if hit:
                return hit, f"eth_getLogs at blocks {start}-{end} (found by the registry's publishedAt timestamp)"
        except RpcError as e:
            errors.append(str(e))
    step = chunk
    hi = latest
    for _ in range(200):
        lo = max(from_block, hi - step + 1)
        try:
            hit = match(rpc.get_logs(reg, [t0], lo, hi))
        except RpcError as e:
            errors.append(str(e))
            break
        if hit:
            return hit, f"eth_getLogs scan (blocks {lo}-{hi})"
        if lo <= from_block:
            break
        hi = lo - 1
    return None, "; ".join(errors[-2:]) if errors else "no MandatePublished log found"


def read_published(rpc: Rpc, d: Deployment, mandate_hash: str, from_block: int | None, chunk: int = 2000) -> tuple[Published | None, str]:
    info = ch.mandate_of(rpc, d, mandate_hash)
    if info["status"] == "None":
        return None, "MandateRegistry.mandateOf returns status None (never published on this ledger)"
    log, how = find_published_log(rpc, d, mandate_hash, d.deployed_at_block if from_block is None else from_block, info["publishedAt"], chunk)
    if log is None:
        return None, f"mandate is recorded but its MandatePublished event was not found ({how})"
    ev = registry().decode_log(log, {d.addr("MandateRegistry").lower(): "MandateRegistry"})
    if ev is None or ev.name != "MandatePublished":
        return None, "MandatePublished log does not decode"
    a = ev.args
    caveats = [Caveat(c["enforcer"], c["terms"].lower(), c["args"].lower()) for c in a["caveats"]]
    (delegation_of,) = ch.call(rpc, d.addr("MandateRegistry"), "MandateRegistry", "delegationOf", [hex_to_bytes(mandate_hash)])
    (live,) = ch.call(rpc, d.addr("MandateRegistry"), "MandateRegistry", "isLive", [hex_to_bytes(mandate_hash)])
    info["delegationOf"] = to_hex(delegation_of)
    info["isLive"] = bool(live)
    p = Published(
        source=f"MandatePublished event, tx {log.get('transactionHash')} block {int(log['blockNumber'], 16)} ({how})",
        caveats=caveats,
        delegator=a["account"],
        delegate=a["agent"],
        salt=int(a["salt"]),
        lineage_id=a["lineageId"],
        jurisdiction=int(a["jurisdiction"]),
        valid_from=int(a["validFrom"]),
        valid_until=int(a["validUntil"]),
        version=int(a["version"]),
        recorded_hash=a["delegationHash"],
        tx_hash=log.get("transactionHash"),
        block_number=int(log["blockNumber"], 16),
        registry=info,
    )
    delegation = (p.delegate, p.delegator, hex_to_bytes(ROOT_AUTHORITY), caveats_abi_value(caveats), p.salt, b"")
    (dm_hash,) = ch.call(rpc, d.addr("DelegationManager"), "DelegationManager", "getDelegationHash", [delegation])
    p.dm_hash = to_hex(dm_hash)
    (disabled,) = ch.call(rpc, d.addr("DelegationManager"), "DelegationManager", "disabledDelegations", [hex_to_bytes(info["delegationOf"])])
    p.disabled = bool(disabled)
    return p, how


def published_from_snapshot(s: dict) -> Published:
    pub = s["published"]
    return Published(
        source=f"snapshot read at block {s.get('readAt', {}).get('blockNumber')} (not re-read from the ledger)",
        caveats=[Caveat.from_json(c) for c in pub["caveats"]],
        delegator=pub["account"],
        delegate=pub["agent"],
        salt=int(pub["salt"]),
        lineage_id=pub["lineageId"],
        jurisdiction=int(pub["jurisdiction"]),
        valid_from=int(pub["validFrom"]),
        valid_until=int(pub["validUntil"]),
        version=int(pub["version"]),
        recorded_hash=pub["delegationHash"],
        tx_hash=pub.get("txHash"),
        block_number=pub.get("blockNumber"),
        registry=s.get("registry", {}),
        dm_hash=s.get("delegationManager", {}).get("getDelegationHash"),
        disabled=s.get("delegationManager", {}).get("disabled"),
    )


def _norm(v: Any) -> Any:
    if isinstance(v, bool):
        return v
    if isinstance(v, bytes):
        return "0x" + v.hex()
    if isinstance(v, str):
        return v.lower()
    if isinstance(v, (list, tuple)):
        return [_norm(x) for x in v]
    return int(v)


def expected_terms_info(r: dict) -> Any:
    """The value an enforcer's getTermsInfo(terms) must return, built from the Python decoding."""
    from .constants import CATEGORY_IDS

    k = r["kind"]
    cats = lambda xs: [CATEGORY_IDS[x["category"]] for x in xs]  # noqa: E731
    amts = lambda xs: [x["amount"] for x in xs]  # noqa: E731
    table = {
        "allowedTargets": lambda: [r["targets"]],
        "allowedMethods": lambda: [[SELECTORS.get(m, m) for m in r["methods"]]],
        "valueLte": lambda: [r["max"]],
        "forbiddenTargets": lambda: [r["targets"]],
        "globalPause": lambda: [r["killSwitch"], r["passport"]],
        "agentLineage": lambda: [r["passport"], r["ownerDidHash"], r["facilitator"]],
        "mandateBinding": lambda: [r["registry"], r["mandateHash"]],
        "jurisdiction": lambda: [PROFILE_IDS[r["profile"]], r["assets"]],
        "verifiedPayee": lambda: [r["payeeBook"], r["passport"], r["issuers"], r["intermediaries"]],
        "coSign": lambda: [[r["payeeBook"], r["asset"], r["defaultT1Cap"], r["newPayeeT1Cap"], r["t2Ceiling"], r["maxApprovalWindow"], cats(r["categoryT1Caps"]), amts(r["categoryT1Caps"])]],
        "categoryBudget": lambda: [[r["payeeBook"], r["asset"], r["periodStart"], r["periodLength"], CATEGORY_IDS[r["unlistedCategory"]], cats(r["caps"]), amts(r["caps"])]],
        "reserveFloor": lambda: [r["asset"], r["amount"]],
        "velocity": lambda: [r["asset"], r["window"], r["maxCount"], r["maxOutflow"]],
        "suitability": lambda: [r["registry"], r["maxRiskClass"]],
    }
    return _norm(table[k]()) if k in table else None


# ---------------------------------------------------------------- the verifier


def run_verify(
    inp: Input,
    chain_name: str,
    rpc_url: str | None = None,
    deployment_path: str | None = None,
    offline: bool = False,
    from_block: int | None = None,
    require_live: bool = False,
) -> Result:
    lg = ledger(chain_name, rpc_url)
    d = load_deployment(chain_name, deployment_path)
    offline = offline or inp.kind == "snapshot"
    rep = Report(f"yinglong verify ({inp.kind}) on {lg.label}", offline=offline)
    names_by_addr = d.name_by_address()
    rep.add("deployment table", INFO, f"{d.source}, sha256 {d.sha256[:16]}..., chainId {d.chain_id}")
    if inp.kind == "hash" and offline:
        raise InputError("a bare mandate hash can only be verified online (drop --offline)")

    # ---- document and compiler
    m: dict | None = None
    compiled: Compiled | None = None
    mandate_hash = inp.mandate_hash
    if inp.mandate is not None:
        try:
            m = parse_mandate(inp.mandate)
            rep.add("mandate document is valid (schema yinglong.mandate/v1)", PASS, inp.source)
        except MandateError as e:
            rep.add("mandate document is valid (schema yinglong.mandate/v1)", FAIL, str(e))
    elif inp.kind == "hash":
        rep.add("mandate document", SKIP, "no document given: document checks are skipped, the on-chain record is decoded as is")
    if m is not None:
        mh = canonical_hash(m)
        if inp.kind == "snapshot" and mandate_hash and mandate_hash.lower() != mh:
            rep.add("mandate hash equals the snapshot's mandate hash", FAIL, f"{mh} vs {mandate_hash}")
        mandate_hash = mh
        rep.add("mandate hash = keccak256(canonical JSON), recomputed", PASS, mh)
        if inp.raw and "canonicalJson" in inp.raw:
            rep.ok("canonical JSON equals the TypeScript canonical JSON", canonical_json(m) == inp.raw["canonicalJson"], "byte-identical", "differs")
        if inp.raw and "mandateHash" in inp.raw and inp.kind == "golden":
            rep.ok("mandate hash equals the TypeScript mandate hash", inp.raw["mandateHash"].lower() == mh, mh, f"{mh} vs {inp.raw['mandateHash']}")
        if rep.ok("mandate is for this ledger", m["ledger"] == chain_name, m["ledger"], f"document says {m['ledger']}, --chain is {chain_name}"):
            try:
                compiled = compile_mandate(m, d)
                rep.add("Python compiler re-emits the caveats", PASS, f"{len(compiled.caveats)} caveats: " + ", ".join(n.removesuffix("Enforcer") for n in compiled.caveat_names))
            except (CompileError, ValueError) as e:
                rep.add("Python compiler re-emits the caveats", FAIL, str(e))
    if inp.kind == "golden" and compiled is not None:
        gold = [Caveat.from_json(c) for c in inp.raw["caveats"]]
        diff = first_caveat_difference(compiled.caveats, gold, names_by_addr)
        rep.ok("Python caveats equal the TypeScript compiler's caveats (golden)", diff is None, f"{len(gold)} caveats byte-identical", diff or "")
        rep.ok(
            "Python delegation hash equals the TypeScript delegation hash (golden)",
            compiled.delegation_hash == inp.raw["delegationHash"].lower(),
            compiled.delegation_hash,
            f"{compiled.delegation_hash} vs {inp.raw['delegationHash']}",
        )

    # ---- what the ledger holds
    pub: Published | None = None
    rpc: Rpc | None = None
    if inp.kind == "snapshot":
        pub = published_from_snapshot(inp.raw)
        rep.add("published record source", INFO, pub.source)
    elif offline:
        rep.add("published record source", SKIP, "offline: the ledger is not read; on-chain checks are not run")
    else:
        rpc = Rpc(lg.rpc_url)
        try:
            cid = rpc.chain_id()
            rep.ok("ledger reachable and on the expected chain", cid == lg.chain_id, f"{lg.rpc_url} chainId {cid}", f"{lg.rpc_url} returned chainId {cid}, expected {lg.chain_id}")
            if mandate_hash is None:
                rep.add("mandate is published in MandateRegistry", FAIL, "no mandate hash (the document did not parse)")
            else:
                # FISCO BCOS silently returns no logs for wide ranges, so scan it in small chunks.
                chunk = int(os.environ.get("YINGLONG_LOG_CHUNK") or (10 if lg.name == "fisco" else 2000))
                pub, how = read_published(rpc, d, mandate_hash, from_block, chunk)
                if pub is None:
                    rep.add("mandate is published in MandateRegistry", FAIL, how)
                else:
                    rep.add("mandate is published in MandateRegistry", PASS, f"version {pub.version}, status {pub.registry['status']}; {pub.source}")
        except RpcUnavailable as e:
            rep.add("ledger reachable and on the expected chain", FAIL, f"{e} (use --rpc URL, or --offline)")
            rpc = None
        except RpcError as e:
            rep.add("ledger reads succeed", FAIL, f"{e}")
            rpc = None

    # ---- published caveats against the document
    caveats_for_meaning: list[Caveat] | None = None
    if pub is not None:
        caveats_for_meaning = pub.caveats
        if compiled is not None:
            diff = first_caveat_difference(pub.caveats, compiled.caveats, names_by_addr)
            rep.ok("published caveats equal the Python-compiled caveats (byte for byte)", diff is None, f"{len(pub.caveats)} caveats identical", diff or "")
        else:
            rep.add("published caveats equal the compiled mandate", SKIP, "no mandate document")
        non_empty_args = sum(1 for c in pub.caveats if c.args not in ("0x", ""))
        if non_empty_args:
            rep.add("published caveat args", INFO, f"{non_empty_args} caveat(s) carry args (args are not part of the delegation hash)")
        if pub.registry.get("caveatsHash"):
            ch_ok = caveats_encoded_hash(pub.caveats) == pub.registry["caveatsHash"].lower()
            rep.ok("registry caveatsHash equals keccak256(abi.encode(published caveats))", ch_ok, pub.registry["caveatsHash"], "event caveats do not match the registry record")
        h = delegation_hash(pub.delegate, pub.delegator, pub.caveats, pub.salt)
        rec = (pub.registry.get("delegationOf") or pub.recorded_hash).lower()
        rep.ok("delegation hash recomputed in Python equals registry delegationOf(mandateHash)", h == rec and h == pub.recorded_hash.lower(), h, f"python {h}, registry {rec}, event {pub.recorded_hash}")
        if pub.dm_hash is not None:
            rep.ok("DelegationManager.getDelegationHash returns the same hash (the hash it accepts)", pub.dm_hash.lower() == h, pub.dm_hash, f"{pub.dm_hash} vs {h}")
        if compiled is not None:
            rep.ok("delegation hash equals the hash of the compiled mandate", h == compiled.delegation_hash, h, f"{h} vs compiled {compiled.delegation_hash}")
        if m is not None:
            mism = []
            if not same_address(pub.delegator, m["principal"]["account"]):
                mism.append(f"account {pub.delegator} vs {m['principal']['account']}")
            if not same_address(pub.delegate, m["agent"]["wallet"]):
                mism.append(f"agent {pub.delegate} vs {m['agent']['wallet']}")
            if pub.salt != int(m["salt"]):
                mism.append(f"salt {pub.salt} vs {m['salt']}")
            if pub.lineage_id.lower() != text_hash(m["lineageId"]):
                mism.append("lineageId hash differs")
            if pub.jurisdiction != PROFILE_IDS[m["jurisdiction"]]:
                mism.append(f"jurisdiction {pub.jurisdiction} vs {m['jurisdiction']}")
            if (pub.valid_from, pub.valid_until) != (m["validity"]["from"], m["validity"]["until"]):
                mism.append(f"validity {pub.valid_from}-{pub.valid_until} vs {m['validity']['from']}-{m['validity']['until']}")
            rep.ok("published account, agent, salt, lineage, jurisdiction and validity equal the document", not mism, "all equal", "; ".join(mism))
    elif compiled is not None:
        caveats_for_meaning = compiled.caveats

    # ---- meaning: decode every caveat into a rule and a sentence
    rules: list[dict] = []
    sentences: list[str] = []
    names = names_for(d, m)
    if caveats_for_meaning is not None:
        bad = []
        for i, c in enumerate(caveats_for_meaning):
            try:
                r = decode_caveat(c, d)
            except DecodeError as e:
                bad.append(f"caveat {i} ({names_by_addr.get(c.enforcer.lower(), c.enforcer)}): {e}")
                r = {"kind": "unknown", "enforcer": c.enforcer, "terms": c.terms}
            rules.append(r)
            sentences.append(sentence(r, names, lg.time_unit))
        unknown = [i for i, r in enumerate(rules) if r["kind"] == "unknown"]
        rep.ok(
            "every caveat decodes into a known rule and an English sentence",
            not unknown and not bad,
            f"{len(rules)} rules",
            "; ".join(bad) or f"unknown enforcer at caveat(s) {unknown}",
        )
        first_two = [names_by_addr.get(c.enforcer.lower()) for c in caveats_for_meaning[:2]]
        rep.ok("target and method allowlists come first", first_two == ["AllowedTargetsEnforcer", "AllowedMethodsEnforcer"], "caveats 0 and 1", f"first caveats are {first_two}")
        binding = [r for r in rules if r["kind"] == "mandateBinding"]
        if mandate_hash:
            ok = len(binding) == 1 and binding[0]["mandateHash"].lower() == mandate_hash.lower() and same_address(binding[0]["registry"], d.addr("MandateRegistry"))
            rep.ok(
                "MandateBindingEnforcer binds this mandate hash in this registry",
                ok,
                f"{mandate_hash[:18]}... in {d.addr('MandateRegistry')}",
                f"{len(binding)} binding caveat(s): " + ", ".join(f"{b['mandateHash']} in {b['registry']}" for b in binding),
            )

    # ---- on-chain: enforcers' own decoding, liveness, disabled, code hashes
    terms_rows: list[list[str]] = []
    code_rows: list[list[str]] = []
    if pub is not None and rpc is not None:
        mism = []
        checked = 0
        for i, (c, r) in enumerate(zip(pub.caveats, rules)):
            name = names_by_addr.get(c.enforcer.lower(), "?")
            exp = expected_terms_info(r)
            if exp is None:
                terms_rows.append([str(i), name, SKIP, "no Python decoding to compare"])
                continue
            out, err = ch.call_or_revert(rpc, c.enforcer, name, "getTermsInfo", [hex_to_bytes(c.terms)])
            checked += 1
            if err is not None:
                mism.append(f"caveat {i} {name} rejects its terms: {err}")
                terms_rows.append([str(i), name, FAIL, f"reverted: {err}"])
            elif _norm(list(out)) != exp:
                mism.append(f"caveat {i} {name} decodes differently on-chain")
                terms_rows.append([str(i), name, FAIL, f"on-chain {_norm(list(out))} vs python {exp}"])
            else:
                terms_rows.append([str(i), name, PASS, "same values"])
        rep.ok("each enforcer accepts its terms and getTermsInfo returns the Python-decoded values", not mism, f"{checked} enforcers agree", "; ".join(mism))

    if pub is not None:
        reg = pub.registry
        # Integrity (what was sealed is what is enforced) and current status are separate questions: a revoked or
        # superseded mandate still verifies, and its status is reported. --require-live makes "not live" a failure.
        if "isLive" in reg:
            if reg["isLive"] or require_live:
                rep.ok(
                    "registry isLive(mandateHash)",
                    bool(reg["isLive"]),
                    f"status {reg.get('status')}, valid {reg.get('validFrom')} to {reg.get('validUntil')}",
                    f"not live: status {reg.get('status')}, valid {reg.get('validFrom')} to {reg.get('validUntil')}",
                )
            else:
                rep.add("registry isLive(mandateHash)", INFO, f"NOT LIVE: status {reg.get('status')}; the agent has no authority under this mandate (use --require-live to fail on this)")
        if pub.disabled is not None:
            if not pub.disabled or require_live:
                rep.ok("DelegationManager has not disabled the delegation (disabledDelegations)", not pub.disabled, "enabled", "DISABLED: the DelegationManager refuses every redemption")
            else:
                rep.add("DelegationManager has not disabled the delegation (disabledDelegations)", INFO, "DISABLED: the DelegationManager refuses every redemption")

    if pub is not None and rpc is not None:
        targets: dict[str, str] = {}
        all_names = d.all_names_by_address()
        all_entries = d.all_contracts()
        for c in pub.caveats:
            targets.setdefault(c.enforcer.lower(), all_names.get(c.enforcer.lower(), "?"))
        for n in ("DelegationManager", "MandateRegistry"):
            targets.setdefault(d.addr(n).lower(), n)
        bad = []
        for a, n in targets.items():
            exp = all_entries.get(n, {}).get("codeHash", "") if n != "?" else ""
            try:
                got = rpc.code_hash(a)
            except RpcError as e:
                code_rows.append([n, a, exp, f"error: {e}", FAIL])
                bad.append(n)
                continue
            empty = got == to_hex(keccak(b""))
            ok = bool(exp) and got.lower() == exp.lower() and not empty
            code_rows.append([n, a, exp or "(no entry)", got + (" (no code)" if empty else ""), PASS if ok else FAIL])
            if not ok:
                bad.append(n)
        rep.ok(
            "on-chain code hash of every enforcer, the DelegationManager and the registry equals the deployment table",
            not bad,
            f"{len(targets)} contracts match",
            "mismatch or missing code: " + ", ".join(bad),
        )
    elif pub is not None and inp.kind == "snapshot":
        rows = inp.raw.get("codeHashes", [])
        bad = []
        for r in rows:
            table_hash = d.all_contracts().get(r["name"], {}).get("codeHash", "").lower()
            ok = bool(table_hash) and r["actual"].lower() == table_hash
            code_rows.append([r["name"], r["address"], table_hash or "(no entry)", r["actual"], PASS if ok else FAIL])
            if not ok:
                bad.append(r["name"])
        if rows:
            rep.ok("code hashes recorded in the snapshot equal the deployment table", not bad, f"{len(rows)} contracts", "mismatch: " + ", ".join(bad))

    # ---- parity with the TypeScript decompiler and Hash Ring (golden vectors)
    ring_hash = (pub.registry.get("delegationOf") or pub.recorded_hash).lower() if pub else (compiled.delegation_hash if compiled else None)
    if inp.kind == "golden" and compiled is not None:
        gnames = names_for(d, m)
        gs = [sentence(decode_caveat(c, d), gnames, "s") for c in compiled.caveats]
        rep.ok("English sentences equal the TypeScript decompiler's (golden)", gs == inp.raw.get("sentences"), f"{len(gs)} sentences identical", "differ")
        grules = [rule_to_json(decode_caveat(c, d)) for c in compiled.caveats]
        rep.ok("decoded rules equal the TypeScript rules (golden)", grules == inp.raw.get("rules"), "identical", "differ")
        gh = compiled.delegation_hash
        ring_ok = (
            geometry(gh) == inp.raw.get("hashRing")
            and geometry(gh, revoked=True) == inp.raw.get("hashRingRevoked")
            and ascii_strip(gh) == inp.raw.get("hashRingAscii")
        )
        rep.ok("Hash Ring geometry (live and revoked) equals the TypeScript geometry (golden)", ring_ok, "64 ticks, 9 arcs identical", "differs")

    revoked = False
    if pub is not None:
        revoked = pub.registry.get("status") in ("Superseded", "Revoked") or bool(pub.disabled)

    res = Result(
        report=rep,
        ledger=lg,
        deployment=d,
        mandate=m,
        mandate_hash=mandate_hash,
        compiled=compiled,
        published=pub,
        sentences=sentences,
        rules=rules,
        ring_hash=ring_hash,
        revoked=revoked,
        code_rows=code_rows,
        terms_rows=terms_rows,
    )
    if pub is not None and rpc is not None:
        res.snapshot = make_snapshot(res, rpc)
    return res


def make_snapshot(res: Result, rpc: Rpc) -> dict:
    blk = rpc.get_block("latest")
    pub = res.published
    assert pub is not None
    return {
        "kind": SNAPSHOT_KIND,
        "description": "Recorded by yinglong verify --save-snapshot; on-chain values as read at readAt.",
        "chain": res.ledger.name,
        "chainId": res.ledger.chain_id,
        "rpcUrl": res.ledger.rpc_url,
        "readAt": {"blockNumber": int(blk["number"], 16), "blockHash": blk["hash"], "timestamp": int(blk["timestamp"], 16)},
        "deployment": {"source": res.deployment.source, "sha256": res.deployment.sha256},
        "mandate": res.mandate,
        "mandateHash": res.mandate_hash,
        "published": {
            "txHash": pub.tx_hash,
            "blockNumber": pub.block_number,
            "account": pub.delegator,
            "agent": pub.delegate,
            "salt": str(pub.salt),
            "lineageId": pub.lineage_id,
            "jurisdiction": pub.jurisdiction,
            "validFrom": pub.valid_from,
            "validUntil": pub.valid_until,
            "version": pub.version,
            "delegationHash": pub.recorded_hash,
            "caveats": [c.to_json() for c in pub.caveats],
        },
        "registry": {k: (str(v) if isinstance(v, int) and not isinstance(v, bool) and v > 2**53 else v) for k, v in pub.registry.items()},
        "delegationManager": {"getDelegationHash": pub.dm_hash, "disabled": pub.disabled},
        "codeHashes": [{"name": r[0], "address": r[1], "expected": r[2], "actual": r[3], "status": r[4]} for r in res.code_rows],
        "sentences": res.sentences,
    }
