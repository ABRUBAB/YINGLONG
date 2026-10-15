"""verify-receipt: an accountability receipt's EIP-712 hash, its document commitments, and its Merkle
inclusion in a batch root anchored in AccountabilityLedger."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import chain as ch
from .abi import registry
from .canonical import doc_hash
from .deployment import Ledger, ledger, load_deployment
from .hexutil import hex_to_bytes, to_hex
from .receipt import DOCUMENT_FIELDS, ZERO32_HASH, process_proof, receipt_domain, receipt_hash
from .report import FAIL, INFO, PASS, SKIP, Report
from .rpc import Rpc, RpcError, RpcUnavailable


def load_receipt_file(path: str, index: int | None = None) -> tuple[dict, list[dict] | None]:
    """Return (record, every record when the file is a .jsonl receipt log).

    Accepted shapes: a bare receipt; {"receipt", "domain"?, "receiptHash"?}; an apps/agent ReceiptRecord
    (with documents, explanation and aigc); an apps/indexer proof (receipt, proof, root, anchors); or one
    line (--index) of apps/agent/data/receipts.jsonl.
    """
    text = Path(path).read_text(encoding="utf-8")
    if path.endswith(".jsonl"):
        lines = [json.loads(x) for x in text.splitlines() if x.strip()]
        if not lines:
            raise ValueError(f"{path}: empty receipt log")
        if index is None:
            if len(lines) != 1:
                raise ValueError(f"{path} holds {len(lines)} receipts: choose one with --index 0..{len(lines) - 1}")
            index = 0
        if not -len(lines) <= index < len(lines):
            raise ValueError(f"{path}: --index {index} out of range (0..{len(lines) - 1})")
        return lines[index], lines
    raw = json.loads(text)
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return raw, None


@dataclass
class ReceiptResult:
    report: Report
    ledger: Ledger
    receipt_hash: str | None = None
    domain: dict | None = None
    batch: dict | None = None


def _check_documents(rep: Report, raw: dict, receipt: dict) -> None:
    docs = raw["documents"]
    bad = []
    for key, field_name in DOCUMENT_FIELDS:
        expect = doc_hash(docs[key]) if key in docs else ZERO32_HASH
        if str(receipt.get(field_name, "")).lower() != expect:
            bad.append(field_name)
    if isinstance(raw.get("explanation"), dict) and str(receipt.get("explanationHash", "")).lower() != doc_hash(raw["explanation"]):
        bad.append("explanationHash")
    aigc = raw.get("aigc")
    if isinstance(aigc, dict):
        block = {"label": aigc.get("label"), "model": aigc.get("model"), "provider": aigc.get("provider")}
        if str(receipt.get("aigcHash", "")).lower() != doc_hash(block) or str(aigc.get("contentId", "")).lower() != doc_hash(block):
            bad.append("aigcHash")
        if aigc.get("label") != "AI-generated":
            bad.append("aigc.label")
    rep.ok(
        "receipt commits to the recorded documents (intent, plan, policy, state reads, counterparty, simulation, explanation, AIGC block)",
        not bad,
        "every document hash matches",
        "mismatch: " + ", ".join(bad),
    )


def run_verify_receipt(
    receipt_path: str,
    proof_path: str | None,
    chain_name: str,
    rpc_url: str | None = None,
    deployment_path: str | None = None,
    offline: bool = False,
    domain_chain_id: int | None = None,
    index: int | None = None,
) -> ReceiptResult:
    lg = ledger(chain_name, rpc_url)
    rep = Report(f"yinglong verify-receipt on {lg.label}", offline=offline)
    res = ReceiptResult(rep, lg)
    raw, log = load_receipt_file(receipt_path, index)
    receipt = raw.get("receipt", raw)
    if not isinstance(receipt, dict) or "receiptId" not in receipt:
        raise ValueError(f"{receipt_path}: no receipt found (expected the fields of plan section 9.8)")
    prf: Any = json.loads(Path(proof_path).read_text(encoding="utf-8")) if proof_path else (raw if "proof" in raw else None)
    d = load_deployment(chain_name, deployment_path)

    dom = raw.get("domain")
    if dom:
        src = "the receipt file"
    else:
        cid = domain_chain_id if domain_chain_id is not None else (lg.domain_chain_id if lg.domain_chain_id is not None else lg.chain_id)
        dom = receipt_domain(d.addr("AccountabilityLedger"), cid, d.domain_salt)
        src = "the deployment (AccountabilityLedger, domainSalt) and the ledger chain id"
    res.domain = dom
    rep.add("EIP-712 domain", INFO, f"from {src}: chainId {dom['chainId']}, verifyingContract {dom['verifyingContract']}, salt {dom['salt'][:18]}...")
    if dom["verifyingContract"].lower() != d.addr("AccountabilityLedger").lower():
        rep.add("domain verifyingContract is this ledger's AccountabilityLedger", FAIL, f"{dom['verifyingContract']} vs {d.addr('AccountabilityLedger')}")
    if raw.get("ledger") and raw["ledger"] != chain_name:
        rep.add("receipt was written for this ledger", FAIL, f"record says {raw['ledger']}, --chain is {chain_name}")

    try:
        h = receipt_hash(receipt, dom)
        res.receipt_hash = h
        rep.add("receipt EIP-712 hash recomputed", PASS, h)
    except (ValueError, KeyError) as e:
        rep.add("receipt EIP-712 hash recomputed", FAIL, str(e))
        return res
    if raw.get("receiptHash"):
        rep.ok("receipt hash equals the hash recorded with the receipt", raw["receiptHash"].lower() == h, h, f"recorded {raw['receiptHash']}")
    if isinstance(raw.get("documents"), dict):
        _check_documents(rep, raw, receipt)
    if log is not None:
        broken = [i for i in range(1, len(log)) if str(log[i]["receipt"].get("prevReceiptHash", "")).lower() != str(log[i - 1].get("receiptHash", "")).lower()]
        rep.ok(f"receipt log hash chain (prevReceiptHash) is intact across {len(log)} receipts", not broken, "every link matches", f"broken at line(s) {broken}")

    if prf is None:
        rep.add("Merkle proof", SKIP, "no proof given (--proof), so batch inclusion is not checked")
        return res
    leaf = str(prf.get("leaf") or prf.get("receiptHash") or h).lower()
    rep.ok("proof leaf equals the recomputed receipt hash", leaf == h, leaf, f"proof leaf {leaf} is not this receipt ({h})")
    proof = [p.lower() for p in prf.get("proof", [])]
    computed_root = process_proof(h, proof)
    root = str(prf.get("root") or "").lower()
    if root:
        rep.ok("Merkle path (sorted pairs) leads to the proof's root", computed_root == root, f"{len(proof)} steps to {root}", f"computed {computed_root}, proof says {root}")
    else:
        root = computed_root
        rep.add("Merkle root computed from the path", INFO, root)

    if offline:
        rep.add("batch root anchored in AccountabilityLedger", SKIP, "offline")
        return res
    rpc = Rpc(lg.rpc_url)
    led = d.addr("AccountabilityLedger")
    anchors = [a for a in prf.get("anchors", []) if a.get("ledger") == chain_name] if isinstance(prf.get("anchors"), list) else []
    try:
        cid = rpc.chain_id()
        rep.ok("ledger reachable and on the expected chain", cid == lg.chain_id, f"chainId {cid}", f"chainId {cid}, expected {lg.chain_id}")
        (plus_one,) = ch.call(rpc, led, "AccountabilityLedger", "batchIdOfRoot", [hex_to_bytes(root)])
        if plus_one == 0:
            rep.add("batch root anchored in AccountabilityLedger", FAIL, f"root {root} is not anchored on {lg.name}")
            return res
        batch_id = plus_one - 1
        # apps/indexer proofs carry a local batchId plus per-ledger anchors; plain proofs may carry the on-chain id.
        if anchors:
            hint = anchors[0].get("onchainBatchId")
        elif "anchors" in prf:
            hint = None
        else:
            hint = prf.get("onchainBatchId", prf.get("batchId"))
        if hint is not None and int(hint) != batch_id:
            rep.add("batch id in the proof equals the on-chain batch id", FAIL, f"proof says {hint}, the ledger says {batch_id}")
        (b,) = ch.call(rpc, led, "AccountabilityLedger", "batchOf", [batch_id])
        broot, prev, n, at, bn = b
        res.batch = {"batchId": batch_id, "root": to_hex(broot), "prevRoot": to_hex(prev), "count": n, "anchoredAt": at, "blockNumber": bn}
        rep.ok(
            "batch root anchored in AccountabilityLedger equals the proof's root",
            to_hex(broot) == root,
            f"batch {batch_id}: {n} receipts, anchored at block {bn} (timestamp {at})",
            f"batch {batch_id} root {to_hex(broot)} differs from {root}",
        )
        (ok,) = ch.call(rpc, led, "AccountabilityLedger", "verifyReceipt", [batch_id, hex_to_bytes(h), [hex_to_bytes(p) for p in proof]])
        rep.ok("AccountabilityLedger.verifyReceipt(batchId, leaf, proof) returns true", bool(ok), "the contract's own MerkleProof agrees", "the contract rejects the proof")
        for a in anchors:
            if not a.get("txHash"):
                continue
            rc = rpc.call("eth_getTransactionReceipt", [a["txHash"]])
            evs = [registry().decode_log(x, {led.lower(): "AccountabilityLedger"}) for x in (rc or {}).get("logs", [])]
            hit = any(e is not None and e.name == "ReceiptBatchAnchored" and str(e.args.get("root", "")).lower() == root for e in evs)
            rep.ok("anchoring transaction emitted ReceiptBatchAnchored for this root", hit, a["txHash"], f"{a['txHash']} has no matching ReceiptBatchAnchored")
        code = rpc.code_hash(led)
        rep.ok("AccountabilityLedger code hash equals the deployment table", code.lower() == d.code_hash("AccountabilityLedger").lower(), code, f"{code} vs {d.code_hash('AccountabilityLedger')}")
    except RpcUnavailable as e:
        rep.add("ledger reachable and on the expected chain", FAIL, f"{e} (use --rpc URL or --offline)")
    except RpcError as e:
        rep.add("ledger reads succeed", FAIL, str(e))
    return res
