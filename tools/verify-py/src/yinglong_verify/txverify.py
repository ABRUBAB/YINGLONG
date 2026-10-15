"""verify-tx: decode YINGLONG events, tie redemptions to published mandates, recover revert reasons."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from . import chain as ch
from .abi import DecodedEvent, DecodedRevert, abi_names, load_abi, registry, signature
from .delegation import Caveat, delegation_hash
from .deployment import Deployment, Ledger, ledger, load_deployment
from .hexutil import hex_to_bytes, keccak, to_hex
from .report import FAIL, INFO, PASS, Report
from .rpc import Rpc, RpcError, RpcUnavailable, extract_revert_data


@lru_cache(maxsize=1)
def function_names() -> dict[bytes, str]:
    out: dict[bytes, str] = {}
    for n in abi_names():
        for item in load_abi(n):
            if item.get("type") == "function":
                out.setdefault(keccak(signature(item).encode())[:4], f"{n}.{signature(item)}")
    return out


@dataclass
class TxResult:
    report: Report
    ledger: Ledger
    tx: dict | None = None
    receipt: dict | None = None
    events: list[DecodedEvent] = field(default_factory=list)
    unknown_logs: list[dict] = field(default_factory=list)
    revert: DecodedRevert | None = None
    inner_reverts: list[tuple[str, DecodedRevert]] = field(default_factory=list)
    labels: dict[str, str] = field(default_factory=dict)


def _replay(rpc: Rpc, tx: dict, block: int | str) -> tuple[str | None, str]:
    """eth_call the transaction again; return (revert data or None, how)."""
    call: dict[str, Any] = {"from": tx["from"], "to": tx.get("to"), "data": tx.get("input") or tx.get("data") or "0x"}
    if tx.get("value") and int(tx["value"], 16):
        call["value"] = tx["value"]
    if tx.get("gas"):
        call["gas"] = tx["gas"]
    tag = hex(block) if isinstance(block, int) else block
    try:
        rpc.call("eth_call", [call, tag])
        return None, "replay did not revert"
    except RpcError as e:
        data = extract_revert_data(e)
        if data is not None:
            return data, "eth_call replay"
        # Some ledgers (FISCO BCOS) report the revert only through gas estimation.
        try:
            rpc.call("eth_estimateGas", [call])
        except RpcError as e2:
            d2 = extract_revert_data(e2)
            if d2 is not None:
                return d2, "eth_estimateGas replay"
            return "0x", f"replay reverted without data ({e}; {e2})"
        return "0x", f"replay reverted without data ({e})"


def run_verify_tx(tx_hash: str, chain_name: str, rpc_url: str | None = None, deployment_path: str | None = None, expect: str | None = None) -> TxResult:
    lg = ledger(chain_name, rpc_url)
    rep = Report(f"yinglong verify-tx {tx_hash} on {lg.label}")
    res = TxResult(rep, lg)
    d: Deployment | None = None
    try:
        d = load_deployment(chain_name, deployment_path)
        res.labels = d.all_names_by_address()
    except (FileNotFoundError, ValueError) as e:
        rep.add("deployment table", INFO, f"{e}; events are decoded by signature only")
    rpc = Rpc(lg.rpc_url)
    try:
        tx = rpc.call("eth_getTransactionByHash", [tx_hash])
        rc = rpc.call("eth_getTransactionReceipt", [tx_hash])
    except RpcUnavailable as e:
        rep.add("ledger reachable", FAIL, str(e))
        return res
    if not tx or not rc:
        rep.add("transaction found", FAIL, f"{tx_hash} not found on {lg.name} ({lg.rpc_url})")
        return res
    res.tx, res.receipt = tx, rc
    block = int(rc["blockNumber"], 16)
    to = (tx.get("to") or "").lower()
    sel = hex_to_bytes(tx.get("input") or tx.get("data") or "0x")[:4]
    fn = function_names().get(sel, to_hex(sel) if sel else "(no calldata)")
    rep.add("transaction found", PASS, f"block {block}, from {tx['from']}, to {res.labels.get(to, tx.get('to'))}, calls {fn}")
    status = int(rc.get("status", "0x1"), 16)
    rep.add("receipt status", INFO, "success (1)" if status == 1 else "reverted (0)")

    by_addr = ch.abi_by_address(d) if d else {}
    for lgx in rc.get("logs", []):
        ev = registry().decode_log(lgx, by_addr)
        if ev is None:
            res.unknown_logs.append(lgx)
        else:
            res.events.append(ev)
    n_logs = len(rc.get("logs", []))
    rep.add("events decoded with the bundled ABIs", PASS if not res.unknown_logs else INFO, f"{len(res.events)} of {n_logs} logs decoded")

    # Redemptions: recompute each redeemed delegation's hash and tie it to its published mandate.
    redeemed: dict[str, dict] = {}
    for ev in res.events:
        if ev.name == "RedeemedDelegation" and isinstance(ev.args.get("delegation"), dict):
            dl = ev.args["delegation"]
            try:
                h = delegation_hash(dl["delegate"], dl["delegator"], [Caveat(c["enforcer"], c["terms"]) for c in dl["caveats"]], int(dl["salt"]), dl["authority"])
                redeemed[h] = dl
            except (KeyError, ValueError) as e:
                rep.add("redeemed delegation hash recomputed", FAIL, str(e))
    for h in redeemed:
        mh = None
        if d is not None:
            try:
                (mh_b,) = ch.call(rpc, d.addr("MandateRegistry"), "MandateRegistry", "mandateOfDelegation", [hex_to_bytes(h)])
                mh = to_hex(mh_b)
            except RpcError:
                mh = None
        where = "not a published root mandate" if not mh or int(mh, 16) == 0 else f"published mandate {mh}"
        rep.add("redeemed delegation hash recomputed in Python", PASS, f"{h} -> {where}")
    for ev in res.events:
        if ev.name != "MandateRedemption":
            continue
        dh = str(ev.args.get("delegationHash", "")).lower()
        mh = str(ev.args.get("mandateHash", "")).lower()
        ok = dh in redeemed if redeemed else True
        detail = f"mandate {mh} via delegation {dh}"
        if d is not None:
            try:
                (rec,) = ch.call(rpc, d.addr("MandateRegistry"), "MandateRegistry", "delegationOf", [hex_to_bytes(mh)])
                ok = ok and to_hex(rec) == dh
                if to_hex(rec) != dh:
                    detail += f"; registry records {to_hex(rec)}"
            except RpcError as e:
                detail += f"; registry read failed ({e})"
        rep.ok("MandateRedemption binds a redeemed delegation to its published mandate", ok, detail, detail)

    for ev in res.events:
        if ev.name == "UserOperationRevertReason":
            res.inner_reverts.append((f"user operation {ev.args.get('userOpHash')}", registry().decode_revert(ev.args.get("revertReason"))))
        if ev.name == "UserOperationEvent" and ev.args.get("success") is False:
            rep.add("user operation", INFO, f"user operation {ev.args.get('userOpHash')} failed inside a successful bundle")

    if status == 0:
        parent = max(block - 1, 0)
        data, how = _replay(rpc, tx, parent)
        if lg.name == "fisco":
            how += " (FISCO BCOS eth_call ignores block tags: replayed against the latest state)"
        else:
            how += f" at the parent block {parent}"
        if data is None:
            rep.add("revert reason recovered", FAIL, f"{how}: state changed since; the reason cannot be reproduced")
        else:
            res.revert = registry().decode_revert(data)
            ok = res.revert.name != "Unknown"
            rep.add("revert reason recovered", PASS if ok else FAIL, f"{res.revert.message} ({how})")
    for where, rv in res.inner_reverts:
        rep.add("inner revert reason", PASS if rv.name != "Unknown" else INFO, f"{where}: {rv.message}")

    if expect:
        if expect.lower() in ("success", "ok"):
            rep.ok("expectation: success", status == 1, "succeeded", "the transaction reverted")
        else:
            got = res.revert.name if res.revert else (res.inner_reverts[0][1].name if res.inner_reverts else None)
            rep.ok(f"expectation: revert with {expect}", got == expect, f"reverted with {got}", f"got {got or 'no revert'}")
    return res
