"""yinglong: command-line entry point.

  yinglong verify <mandate.json | golden.json | snapshot.json | nadia | lotus | 0xMANDATEHASH> --chain anvil|base-sepolia|fisco
  yinglong verify-tx <txhash> --chain ...
  yinglong verify-receipt <receipt.json> --proof <proof.json> --chain ...
  yinglong ledgers
Exit codes: 0 every check passed, 1 at least one check failed, 2 bad input or usage.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .deployment import LEDGER_NAMES, known_deployment_files, ledger
from .hashring import CAPTION, ascii_strip, svg
from .report import FAIL, checks_table, heading, table
from .rpc import Rpc, RpcError


def _out(s: str = "") -> None:
    print(s)


def _setup_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass


def _common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--chain", required=True, choices=LEDGER_NAMES, help="ledger to verify against")
    p.add_argument("--rpc", help="JSON-RPC URL (default: the ledger profile, or ANVIL_RPC_URL / BASE_SEPOLIA_RPC_URL / FISCO_RPC_URL)")
    p.add_argument("--deployment", help="deployment JSON (default: repository checkout, else the bundled copy)")
    p.add_argument("--json", action="store_true", help="print a machine-readable JSON result instead of tables")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="yinglong",
        description="Independent Python verifier for YINGLONG mandates, transactions and accountability receipts.",
    )
    ap.add_argument("--version", action="version", version=f"yinglong-verify {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("verify", help="round-trip verification of a sealed mandate")
    v.add_argument("input", help="mandate document, golden vector, snapshot, bundled name (nadia, lotus) or a 0x mandate hash")
    _common(v)
    v.add_argument("--offline", action="store_true", help="do not read the ledger (golden vectors and snapshots only)")
    v.add_argument("--svg", metavar="PATH", help="write the Hash Ring as SVG")
    v.add_argument("--from-block", type=int, help="first block to search for MandatePublished (default: deployment block)")
    v.add_argument("--save-snapshot", metavar="PATH", help="write what was read on-chain, for later --offline verification")
    v.add_argument("--verbose", "-v", action="store_true", help="also print per-enforcer and per-contract tables")
    v.add_argument("--require-live", action="store_true", help="fail if the mandate is no longer live (revoked or superseded) or its delegation is disabled")

    t = sub.add_parser("verify-tx", help="decode a transaction's YINGLONG events and recover its revert reason")
    t.add_argument("txhash")
    _common(t)
    t.add_argument("--expect", metavar="success|ErrorName", help="exit 1 unless the tx succeeded / reverted with this error")

    r = sub.add_parser("verify-receipt", help="check an accountability receipt against an anchored batch root")
    r.add_argument("receipt", help="receipt JSON (bare, {receipt, domain?}, an agent ReceiptRecord, an indexer proof) or a receipts .jsonl log")
    r.add_argument("--proof", help="proof JSON {leaf?, proof: [...], root, anchors?} (optional when the receipt file embeds it)")
    r.add_argument("--index", type=int, help="which receipt of a .jsonl log (0-based)")
    _common(r)
    r.add_argument("--offline", action="store_true", help="only recompute the hash and the Merkle path")
    r.add_argument("--domain-chain-id", type=int, help="chainId of the receipt EIP-712 domain (default: the ledger's)")

    lg = sub.add_parser("ledgers", help="list known ledgers and deployment files")
    lg.add_argument("--no-probe", action="store_true", help="do not query the RPC endpoints")
    lg.add_argument("--json", action="store_true")
    return ap


# ---------------------------------------------------------------- verify


def cmd_verify(a: argparse.Namespace) -> int:
    from .verify import InputError, load_input, run_verify

    try:
        inp = load_input(a.input)
        res = run_verify(inp, a.chain, a.rpc, a.deployment, a.offline, a.from_block, require_live=a.require_live)
    except (InputError, FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    rep = res.report
    if a.svg and res.ring_hash:
        Path(a.svg).write_text(svg(res.ring_hash, revoked=res.revoked, title=(res.mandate or {}).get("title")), encoding="utf-8")
    if a.save_snapshot:
        if res.snapshot is None:
            print("error: --save-snapshot needs a successful on-chain read", file=sys.stderr)
        else:
            Path(a.save_snapshot).write_text(json.dumps(res.snapshot, indent=2) + "\n", encoding="utf-8")
    if a.json:
        out = rep.to_json()
        out.update(
            {
                "chain": a.chain,
                "mandateHash": res.mandate_hash,
                "delegationHash": res.ring_hash,
                "revoked": res.revoked,
                "sentences": res.sentences,
                "userSentences": (res.mandate or {}).get("sentences", []),
                "hashRingAscii": ascii_strip(res.ring_hash) if res.ring_hash else None,
                "codeHashes": [dict(zip(["name", "address", "expected", "actual", "status"], r)) for r in res.code_rows],
                "termsInfo": [dict(zip(["caveat", "enforcer", "status", "detail"], r)) for r in res.terms_rows],
            }
        )
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0 if rep.passed else 1

    lg = res.ledger
    _out(f"YINGLONG verify {__version__} (independent Python implementation)")
    _out(f"Ledger:   {lg.label} [{lg.badge}], chainId {lg.chain_id}" + ("" if rep.offline else f", rpc {lg.rpc_url} ({lg.rpc_source})"))
    _out(f"Input:    {inp.source}")
    if res.mandate:
        p = res.mandate["principal"]
        _out(f"Mandate:  \"{res.mandate['title']}\" for {p['name']} ({p['kind']}), agent {res.mandate['agent']['label']}")
    if res.mandate_hash:
        _out(f"Mandate hash:         {res.mandate_hash}")
    if res.ring_hash:
        _out(f"Delegation hash (H):  {res.ring_hash}")
    if res.published and res.published.tx_hash:
        link = lg.explorer_tx.format(res.published.tx_hash) if lg.explorer_tx else res.published.tx_hash
        _out(f"Published in:         {link}")
    if res.published is not None:
        status = res.published.registry.get("status")
        _out(f"Status:               {status}" + ("" if not res.revoked else " (no longer in force: the agent has no authority under this mandate)"))

    said = (res.mandate or {}).get("sentences") or []
    if said:
        _out(heading("What the user said (their own words; model input, never enforced)"))
        for s in said:
            _out(f"  - {s}")
    if res.sentences:
        src = "the published caveats" if res.published else "the compiled caveats"
        _out(heading(f"What the code enforces (decoded from the bytes of {src})"))
        for i, s in enumerate(res.sentences, 1):
            _out(f"  {i:2d}. {s}")
    if res.ring_hash:
        state = "REVOKED (gap at 12 o'clock, ticks ash)" if res.revoked else ("live" if res.published else "not read from a ledger")
        _out(heading("Hash Ring of H (spec v1: 64 ticks, one nibble each)"))
        _out(f"  [{ascii_strip(res.ring_hash)}]")
        _out(f"  state: {state}. {CAPTION}")
        if a.svg:
            _out(f"  SVG written to {a.svg}")

    _out(heading("Checks"))
    _out(checks_table(rep))
    if a.verbose and res.terms_rows:
        _out(heading("Enforcers decoding their own terms (getTermsInfo)"))
        _out(table(res.terms_rows, ["#", "ENFORCER", "STATUS", "DETAIL"]))
    if res.code_rows and (a.verbose or any(r[4] == FAIL for r in res.code_rows)):
        _out(heading("Code hashes (eth_getCode -> keccak256) against the deployment table"))
        _out(table([[r[4], r[0], r[1], f"expected {r[2]} got {r[3]}"] for r in res.code_rows], ["STATUS", "CONTRACT", "ADDRESS", "DETAIL"]))
    _out("")
    _out(rep.verdict())
    if rep.offline:
        _out("Offline: nothing was read from a ledger; run without --offline to check what is on-chain.")
    return 0 if rep.passed else 1


# ---------------------------------------------------------------- verify-tx


def _fmt_args(args: dict, labels: dict[str, str]) -> str:
    """Compact, human-readable event arguments (full values are in --json)."""
    from .delegation import Caveat, delegation_hash

    def f(v: object) -> str:
        if isinstance(v, dict) and {"delegate", "delegator", "caveats", "salt"} <= set(v):
            try:
                h = delegation_hash(v["delegate"], v["delegator"], [Caveat(c["enforcer"], c["terms"]) for c in v["caveats"]], int(v["salt"]), v["authority"])
            except (KeyError, ValueError):
                h = "?"
            return f"Delegation(delegator {v['delegator']}, delegate {v['delegate']}, {len(v['caveats'])} caveats, hash {h})"
        if isinstance(v, str) and v.startswith("0x") and len(v) == 42 and v.lower() in labels:
            return f"{v} ({labels[v.lower()]})"
        if isinstance(v, str) and len(v) > 90:
            return f"{v[:42]}...{v[-8:]} ({(len(v) - 2) // 2} bytes)"
        if isinstance(v, dict):
            return "{" + ", ".join(f"{k}: {f(x)}" for k, x in v.items()) + "}"
        if isinstance(v, list):
            if len(v) > 6:
                return "[" + ", ".join(f(x) for x in v[:3]) + f", ... {len(v)} items]"
            return "[" + ", ".join(f(x) for x in v) + "]"
        return str(v)

    return ", ".join(f"{k}={f(v)}" for k, v in args.items())


def cmd_verify_tx(a: argparse.Namespace) -> int:
    from .txverify import run_verify_tx

    try:
        res = run_verify_tx(a.txhash, a.chain, a.rpc, a.deployment, a.expect)
    except (FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    rep = res.report
    found = res.tx is not None
    if a.json:
        out = rep.to_json()
        out["events"] = [{"contract": e.contract, "event": e.name, "address": e.address, "logIndex": e.log_index, "args": e.args} for e in res.events]
        out["unknownLogs"] = res.unknown_logs
        out["revert"] = None if res.revert is None else {"name": res.revert.name, "args": res.revert.args, "message": res.revert.message, "raw": res.revert.raw}
        print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
        return 2 if not found else (0 if rep.passed else 1)
    lg = res.ledger
    _out(f"YINGLONG verify-tx {__version__} on {lg.label} [{lg.badge}]")
    if found and lg.explorer_tx:
        _out(f"Explorer: {lg.explorer_tx.format(a.txhash)}")
    if res.events:
        _out(heading("Events"))
        rows = [[str(e.log_index), res.labels.get(e.address.lower(), e.contract), e.name, _fmt_args(e.args, res.labels)] for e in res.events]
        _out(table(rows, ["LOG", "CONTRACT", "EVENT", "ARGS"]))
    if res.unknown_logs:
        _out(f"\n{len(res.unknown_logs)} log(s) from contracts outside the bundled ABIs were not decoded.")
    if res.revert:
        _out(heading("Revert"))
        _out(f"  {res.revert.message}")
        _out(f"  raw: {res.revert.raw[:202]}{'...' if len(res.revert.raw) > 202 else ''}")
    _out(heading("Checks"))
    _out(checks_table(rep))
    _out("")
    _out(rep.verdict())
    return 2 if not found else (0 if rep.passed else 1)


# ---------------------------------------------------------------- verify-receipt


def cmd_verify_receipt(a: argparse.Namespace) -> int:
    from .receiptverify import run_verify_receipt

    try:
        res = run_verify_receipt(a.receipt, a.proof, a.chain, a.rpc, a.deployment, a.offline, a.domain_chain_id, a.index)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    rep = res.report
    if a.json:
        out = rep.to_json()
        out.update({"receiptHash": res.receipt_hash, "domain": res.domain, "batch": res.batch})
        print(json.dumps(out, indent=2, default=str))
        return 0 if rep.passed else 1
    _out(f"YINGLONG verify-receipt {__version__} on {res.ledger.label} [{res.ledger.badge}]")
    if res.receipt_hash:
        _out(f"Receipt hash (EIP-712 leaf): {res.receipt_hash}")
    _out(heading("Checks"))
    _out(checks_table(rep))
    _out("")
    _out(rep.verdict())
    return 0 if rep.passed else 1


# ---------------------------------------------------------------- ledgers


def cmd_ledgers(a: argparse.Namespace) -> int:
    files = known_deployment_files()
    rows = []
    out = []
    for name in LEDGER_NAMES:
        lg = ledger(name)
        status = "not probed"
        if not a.no_probe:
            try:
                rpc = Rpc(lg.rpc_url, timeout=4, retries=0)
                cid = rpc.chain_id()
                status = f"reachable, chainId {cid}, block {rpc.block_number()}"
            except RpcError as e:
                status = f"unreachable ({str(e)[:60]})"
        deps = [(where, p) for where, p in files if p.stem == name]
        rows.append([name, str(lg.chain_id), lg.time_unit, f"{lg.rpc_url} ({lg.rpc_source})", f"{status}; {len(deps)} deployment file(s)"])
        out.append({"name": name, "label": lg.label, "chainId": lg.chain_id, "rpcUrl": lg.rpc_url, "rpcSource": lg.rpc_source, "timeUnit": lg.time_unit, "badge": lg.badge, "status": status, "deployments": [str(p) for _, p in deps]})
    if a.json:
        print(json.dumps(out, indent=2))
        return 0
    _out(f"YINGLONG ledgers (yinglong-verify {__version__})")
    _out(table(rows, ["LEDGER", "CHAIN ID", "TIME", "RPC", "STATUS"]))
    _out(heading("Labels"))
    for name in LEDGER_NAMES:
        lg = ledger(name)
        _out(f"  {name}: {lg.label} [{lg.badge}]")
    _out(heading("Deployment files (used in this order: --deployment, YINGLONG_DEPLOYMENTS, repository checkout, bundled)"))
    if not files:
        _out("  none found")
    for where, p in files:
        _out(f"  {p.stem:<13} {where:<10} {p}")
    missing = [n for n in LEDGER_NAMES if not any(p.stem == n for _, p in files)]
    if missing:
        _out(f"  no deployment yet for: {', '.join(missing)}")
    _out()
    _out("Override an RPC with --rpc, or ANVIL_RPC_URL, BASE_SEPOLIA_RPC_URL, FISCO_RPC_URL (FISCO_CHAIN_ID, FISCO_TIME_UNIT).")
    return 0


def main(argv: list[str] | None = None) -> int:
    _setup_stdout()
    a = build_parser().parse_args(argv)
    handlers = {"verify": cmd_verify, "verify-tx": cmd_verify_tx, "verify-receipt": cmd_verify_receipt, "ledgers": cmd_ledgers}
    try:
        return handlers[a.cmd](a)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
