"""Command-line behaviour offline: exit codes, tampering detection, snapshots, receipts."""

from __future__ import annotations

import copy
import json

import pytest

from conftest import golden_path, load_json
from yinglong_verify.cli import main
from yinglong_verify.delegation import Caveat
from yinglong_verify.verify import SNAPSHOT_KIND, caveats_encoded_hash


def run(capsys, *argv) -> tuple[int, str]:
    code = main(list(argv))
    return code, capsys.readouterr().out


def test_offline_golden_passes(capsys, tmp_path):
    svg_path = tmp_path / "ring.svg"
    code, out = run(capsys, "verify", "nadia", "--chain", "anvil", "--offline", "--svg", str(svg_path))
    assert code == 0
    assert "RESULT: PASS OFFLINE" in out
    assert "The agent can only touch these assets: tHKD and tUSD." in out
    assert load_json(golden_path("nadia"))["hashRingAscii"] in out
    assert svg_path.read_text(encoding="utf-8").startswith("<svg")


@pytest.mark.parametrize("name", ["nadia", "lotus"])
def test_offline_golden_from_file_path(capsys, name):
    code, out = run(capsys, "verify", str(golden_path(name)), "--chain", "anvil", "--offline")
    assert code == 0, out


def test_tampered_caveat_fails(capsys, tmp_path):
    g = load_json(golden_path("nadia"))
    t = g["caveats"][11]["terms"]
    g["caveats"][11]["terms"] = t[:-1] + ("1" if t[-1] != "1" else "2")  # one nibble of a budget cap
    p = tmp_path / "tampered.json"
    p.write_text(json.dumps(g), encoding="utf-8")
    code, out = run(capsys, "verify", str(p), "--chain", "anvil", "--offline")
    assert code == 1
    assert "caveat 11 (CategoryBudgetEnforcer): terms differ" in out


def test_tampered_document_fails(capsys, tmp_path):
    g = load_json(golden_path("nadia"))
    g["mandate"]["reserveFloors"][0]["amount"] = "1"
    p = tmp_path / "doc.json"
    p.write_text(json.dumps(g), encoding="utf-8")
    code, out = run(capsys, "verify", str(p), "--chain", "anvil", "--offline")
    assert code == 1
    assert "mandate hash equals the TypeScript mandate hash" in out


def test_wrong_chain_fails(capsys):
    code, out = run(capsys, "verify", "nadia", "--chain", "fisco", "--offline")
    assert code == 1
    assert "document says anvil, --chain is fisco" in out


def test_plain_mandate_document(capsys, tmp_path):
    p = tmp_path / "mandate.json"
    p.write_text(json.dumps(load_json(golden_path("lotus"))["mandate"]), encoding="utf-8")
    code, out = run(capsys, "verify", str(p), "--chain", "anvil", "--offline", "--json")
    assert code == 0
    res = json.loads(out)
    assert res["passed"] and res["offline"]
    assert res["delegationHash"] == load_json(golden_path("lotus"))["delegationHash"]
    assert res["sentences"] == load_json(golden_path("lotus"))["sentences"]


def test_bad_input_is_exit_2(capsys, tmp_path):
    assert main(["verify", str(tmp_path / "missing.json"), "--chain", "anvil", "--offline"]) == 2
    p = tmp_path / "x.json"
    p.write_text('{"hello": 1}', encoding="utf-8")
    assert main(["verify", str(p), "--chain", "anvil", "--offline"]) == 2
    assert main(["verify", "0x" + "11" * 32, "--chain", "anvil", "--offline"]) == 2


def _snapshot_from_golden(name: str, d) -> dict:
    g = load_json(golden_path(name))
    caveats = [Caveat.from_json(c) for c in g["caveats"]]
    m = g["mandate"]
    names = d.name_by_address()
    rows = []
    for c in caveats:
        n = names[c.enforcer.lower()]
        rows.append({"name": n, "address": c.enforcer, "expected": d.code_hash(n), "actual": d.code_hash(n), "status": "PASS"})
    return {
        "kind": SNAPSHOT_KIND,
        "chain": "anvil",
        "readAt": {"blockNumber": 1},
        "mandate": m,
        "mandateHash": g["mandateHash"],
        "published": {
            "account": m["principal"]["account"],
            "agent": m["agent"]["wallet"],
            "salt": m["salt"],
            "lineageId": g["lineageIdHash"],
            "jurisdiction": {"hk": 1, "international": 2, "mainland": 3}[m["jurisdiction"]],
            "validFrom": m["validity"]["from"],
            "validUntil": m["validity"]["until"],
            "version": 1,
            "delegationHash": g["delegationHash"],
            "caveats": g["caveats"],
        },
        "registry": {"status": "Live", "isLive": True, "delegationOf": g["delegationHash"], "caveatsHash": caveats_encoded_hash(caveats)},
        "delegationManager": {"getDelegationHash": g["delegationHash"], "disabled": False},
        "codeHashes": rows,
    }


def test_snapshot_offline(capsys, tmp_path, anvil_deployment):
    s = _snapshot_from_golden("nadia", anvil_deployment)
    p = tmp_path / "snap.json"
    p.write_text(json.dumps(s), encoding="utf-8")
    code, out = run(capsys, "verify", str(p), "--chain", "anvil")
    assert code == 0, out
    assert "snapshot read at block 1" in out

    bad = copy.deepcopy(s)
    bad["delegationManager"]["disabled"] = True
    p.write_text(json.dumps(bad), encoding="utf-8")
    # A disabled delegation is reported (integrity still verifies); --require-live makes it a failure.
    code, out = run(capsys, "verify", str(p), "--chain", "anvil")
    assert code == 0 and "DISABLED" in out and "REVOKED" in out
    code, out = run(capsys, "verify", str(p), "--chain", "anvil", "--require-live")
    assert code == 1 and "DISABLED" in out

    bad = copy.deepcopy(s)
    bad["published"]["caveats"] = bad["published"]["caveats"][:-1]
    p.write_text(json.dumps(bad), encoding="utf-8")
    code, out = run(capsys, "verify", str(p), "--chain", "anvil")
    assert code == 1 and "15 vs 16 caveats" in out


def test_verify_receipt_offline(capsys, tmp_path, vectors):
    s = vectors["receipts"][0]
    t = next(x for x in vectors["merkle"] if len(x["leaves"]) == 5)
    i = 3
    rp = tmp_path / "receipt.json"
    pp = tmp_path / "proof.json"
    rp.write_text(json.dumps({"receipt": s["receipts"][i], "domain": s["domain"], "receiptHash": s["hashes"][i]}), encoding="utf-8")
    pp.write_text(json.dumps({"leaf": t["leaves"][i], "proof": t["proofs"][i], "root": t["root"]}), encoding="utf-8")
    code, out = run(capsys, "verify-receipt", str(rp), "--proof", str(pp), "--chain", s["ledger"], "--offline")
    assert code == 0, out
    assert s["hashes"][i] in out

    r = dict(s["receipts"][i])
    r["outcome"] = "reverted" if r["outcome"] != "reverted" else "confirmed"
    rp.write_text(json.dumps({"receipt": r, "domain": s["domain"]}), encoding="utf-8")
    code, out = run(capsys, "verify-receipt", str(rp), "--proof", str(pp), "--chain", s["ledger"], "--offline")
    assert code == 1
    assert "is not this receipt" in out


def test_ledgers(capsys):
    code, out = run(capsys, "ledgers", "--no-probe")
    assert code == 0
    for name in ("anvil", "base-sepolia", "fisco", "31337", "84532", "127.0.0.1:8645", "sepolia.base.org"):
        assert name in out


def test_agent_receipt_log_offline(capsys):
    """Receipts written by apps/agent (if present): hash, document commitments and the hash chain."""
    from conftest import HERE

    log = HERE.parent.parent.parent / "apps" / "agent" / "data" / "receipts.jsonl"
    if not log.exists():
        pytest.skip("apps/agent/data/receipts.jsonl not present")
    lines = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines() if x.strip()]
    for i, rec in enumerate(lines):
        if rec.get("ledger") not in ("anvil", "fisco", "base-sepolia"):
            continue
        try:
            from yinglong_verify.deployment import load_deployment

            load_deployment(rec["ledger"])
        except FileNotFoundError:
            continue
        code, out = run(capsys, "verify-receipt", str(log), "--index", str(i), "--chain", rec["ledger"], "--offline")
        assert code == 0, out
        assert "every document hash matches" in out
