"""Integration tests against live ledgers. Every test skips itself when its ledger is not reachable.

  shared anvil   http://127.0.0.1:8645 (ANVIL_RPC_URL); read-only: code hashes, and the e2e mandate if its
                 evidence file (apps/agent/data/e2e-anvil.json) matches the running chain.
  forked anvil   a private `anvil --fork-url <shared anvil>` on a free port (needs the anvil binary: ANVIL_BIN,
                 PATH or ~/.foundry/bin). Writes happen only in the fork: the golden Nadia mandate is published
                 through account impersonation, then verify, verify-tx, verify-receipt, disable and revoke run.
  FISCO BCOS     FISCO_RPC_URL (default http://127.0.0.1:8545); read-only, using apps/agent/data/e2e-fisco.json.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path

import pytest

from conftest import HERE, golden_path, load_json
from yinglong_verify import chain as ch
from yinglong_verify.cli import main
from yinglong_verify.constants import PROFILE_IDS, ROOT_AUTHORITY
from yinglong_verify.delegation import Caveat
from yinglong_verify.deployment import load_deployment
from yinglong_verify.hexutil import hex_to_bytes, to_hex
from yinglong_verify.receipt import build_merkle, merkle_proof
from yinglong_verify.rpc import Rpc, RpcError
from yinglong_verify.verify import caveats_abi_value

REPO = HERE.parent.parent.parent
SHARED_ANVIL = os.environ.get("YINGLONG_TEST_ANVIL", "http://127.0.0.1:8645")
FISCO = os.environ.get("FISCO_RPC_URL", "http://127.0.0.1:8545")


def reachable(url: str, chain_id: int | None = None) -> bool:
    try:
        cid = Rpc(url, timeout=3, retries=0).chain_id()
    except RpcError:
        return False
    return chain_id is None or cid == chain_id


def run(capsys, *argv) -> tuple[int, str]:
    code = main(list(argv))
    return code, capsys.readouterr().out


def evidence(name: str) -> dict[str, dict]:
    p = REPO / "apps" / "agent" / "data" / f"e2e-{name}.json"
    if not p.exists():
        pytest.skip(f"{p} not found")
    steps = load_json(p)
    return {s["step"]: s for s in steps}


# ---------------------------------------------------------------- shared anvil (read-only)

needs_anvil = pytest.mark.skipif(not reachable(SHARED_ANVIL, 31337), reason=f"anvil not reachable at {SHARED_ANVIL}")


@needs_anvil
def test_shared_anvil_runs_the_deployment():
    d = load_deployment("anvil")
    rpc = Rpc(SHARED_ANVIL)
    bad = [n for n, c in d.contracts.items() if c["codeHash"] and rpc.code_hash(c["address"]) != c["codeHash"].lower()]
    assert not bad, f"code hash mismatch on the shared anvil: {bad}"


@needs_anvil
def test_shared_anvil_every_published_mandate(capsys):
    """Verify, by hash, every mandate the running anvil holds (read-only)."""
    from yinglong_verify.hexutil import to_hex
    from yinglong_verify.verify import _event_topic

    d = load_deployment("anvil")
    rpc = Rpc(SHARED_ANVIL)
    logs = rpc.get_logs(d.addr("MandateRegistry"), [to_hex(_event_topic("MandatePublished", "MandateRegistry"))], 0, rpc.block_number())
    if not logs:
        pytest.skip("no mandate published on the shared anvil yet")
    for lg in logs[:5]:
        mh = lg["topics"][2]
        code, out = run(capsys, "verify", mh, "--chain", "anvil", "--rpc", SHARED_ANVIL, "--json")
        res = json.loads(out)
        failed = {c["name"] for c in res["checks"] if c["status"] == "FAIL"}
        # A superseded/revoked or disabled mandate fails only its status checks; everything else must hold.
        assert failed <= {"registry isLive(mandateHash)", "DelegationManager has not disabled the delegation (disabledDelegations)"}, failed
        assert len(res["sentences"]) >= 5


@needs_anvil
def test_shared_anvil_e2e_mandate(capsys):
    ev = evidence("anvil")
    seal = ev["seal"]
    if ch.mandate_of(Rpc(SHARED_ANVIL), load_deployment("anvil"), seal["mandateHash"])["status"] == "None":
        pytest.skip("e2e-anvil.json is from an earlier anvil session (mandate not on the running chain)")
    code, out = run(capsys, "verify", seal["mandateHash"], "--chain", "anvil", "--rpc", SHARED_ANVIL)
    assert code == 0, out
    assert seal["delegationHash"] in out
    t1 = next(s for k, s in ev.items() if k.startswith("T1"))
    code, out = run(capsys, "verify-tx", t1["tx"], "--chain", "anvil", "--rpc", SHARED_ANVIL, "--expect", "success")
    assert code == 0, out
    assert "MandateRedemption binds a redeemed delegation to its published mandate" in out
    attack = next(s for k, s in ev.items() if k.startswith("T4 raw attack"))
    code, out = run(capsys, "verify-tx", attack["tx"], "--chain", "anvil", "--rpc", SHARED_ANVIL, "--expect", "PayeeNotVerified")
    assert code == 0, out


# ---------------------------------------------------------------- forked anvil (writes stay in the fork)


def anvil_binary() -> str | None:
    for cand in (os.environ.get("ANVIL_BIN"), shutil.which("anvil"), str(Path.home() / ".foundry" / "bin" / "anvil")):
        if cand and Path(cand).exists():
            return cand
        if cand and Path(cand + ".exe").exists():
            return cand + ".exe"
    return None


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def fork():
    if not reachable(SHARED_ANVIL, 31337):
        pytest.skip(f"anvil not reachable at {SHARED_ANVIL}")
    binary = anvil_binary()
    if not binary:
        pytest.skip("anvil binary not found (set ANVIL_BIN)")
    port = free_port()
    proc = subprocess.Popen(
        [binary, "--fork-url", SHARED_ANVIL, "--port", str(port), "--silent"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            if reachable(url):
                break
            time.sleep(0.1)
        else:
            pytest.skip("forked anvil did not start")
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def send(rpc: Rpc, sender: str, to: str, data: bytes, gas: int = 3_000_000) -> dict:
    rpc.call("anvil_impersonateAccount", [sender])
    rpc.call("anvil_setBalance", [sender, hex(10**19)])
    h = rpc.call("eth_sendTransaction", [{"from": sender, "to": to, "data": to_hex(data), "gas": hex(gas)}])
    for _ in range(100):
        rc = rpc.call("eth_getTransactionReceipt", [h])
        if rc:
            return rc
        time.sleep(0.05)
    raise AssertionError("transaction not mined")


@pytest.fixture(scope="module")
def published(fork):
    """Publish the golden Nadia mandate (the TypeScript compiler's caveats) from its account, in the fork."""
    rpc = Rpc(fork)
    d = load_deployment("anvil")
    g = load_json(golden_path("nadia"))
    m = g["mandate"]
    caveats = [Caveat.from_json(c) for c in g["caveats"]]
    params = (
        hex_to_bytes(g["mandateHash"]),
        m["agent"]["wallet"],
        hex_to_bytes(g["lineageIdHash"]),
        PROFILE_IDS[m["jurisdiction"]],
        m["validity"]["from"],
        m["validity"]["until"],
        int(m["salt"]),
        caveats_abi_value(caveats),
    )
    data = ch.calldata("MandateRegistry", "publish", [params])
    rc = send(rpc, m["principal"]["account"], d.addr("MandateRegistry"), data)
    assert int(rc["status"], 16) == 1
    return {"rpc": rpc, "d": d, "g": g, "caveats": caveats, "publish_tx": rc["transactionHash"], "publish_data": data}


def test_fork_verify_passes_every_check(capsys, fork, published, tmp_path):
    snap = tmp_path / "snap.json"
    svg_path = tmp_path / "ring.svg"
    code, out = run(capsys, "verify", "nadia", "--chain", "anvil", "--rpc", fork, "-v", "--save-snapshot", str(snap), "--svg", str(svg_path))
    assert code == 0, out
    assert "RESULT: PASS (all" in out
    assert "| SKIP" not in out and "| FAIL" not in out
    for s in published["g"]["sentences"]:
        assert s in out
    # The saved snapshot verifies offline with the same result.
    code, out = run(capsys, "verify", str(snap), "--chain", "anvil")
    assert code == 0, out
    assert json.loads(snap.read_text(encoding="utf-8"))["published"]["delegationHash"] == published["g"]["delegationHash"]


def test_fork_verify_json(capsys, fork, published):
    code, out = run(capsys, "verify", "nadia", "--chain", "anvil", "--rpc", fork, "--json")
    res = json.loads(out)
    assert code == 0 and res["passed"] and not res["revoked"]
    assert res["delegationHash"] == published["g"]["delegationHash"]
    assert all(r["status"] == "PASS" for r in res["codeHashes"]) and len(res["codeHashes"]) >= 14
    assert all(r["status"] == "PASS" for r in res["termsInfo"]) and len(res["termsInfo"]) == 16


def test_fork_verify_tx_publish(capsys, fork, published):
    code, out = run(capsys, "verify-tx", published["publish_tx"], "--chain", "anvil", "--rpc", fork, "--expect", "success")
    assert code == 0, out
    assert "MandatePublished" in out


def test_fork_verify_tx_recovers_typed_revert(capsys, fork, published):
    d, m = published["d"], published["g"]["mandate"]
    rc = send(published["rpc"], m["principal"]["account"], d.addr("MandateRegistry"), published["publish_data"])
    assert int(rc["status"], 16) == 0
    code, out = run(capsys, "verify-tx", rc["transactionHash"], "--chain", "anvil", "--rpc", fork, "--expect", "MandateExists")
    assert code == 0, out
    assert f"MandateExists({published['g']['mandateHash']})" in out
    code, out = run(capsys, "verify-tx", rc["transactionHash"], "--chain", "anvil", "--rpc", fork, "--expect", "success")
    assert code == 1


def test_fork_verify_receipt(capsys, fork, published, vectors, tmp_path):
    rpc, d = published["rpc"], published["d"]
    s = next(x for x in vectors["receipts"] if x["ledger"] == "anvil")
    layers = build_merkle(s["hashes"])
    root = layers[-1][0]
    led = d.addr("AccountabilityLedger")
    (admin,) = ch.call(rpc, led, "AccountabilityLedger", "admin", [])
    anchorer = "0x00000000000000000000000000000000000a0c4e"
    assert int(send(rpc, admin, led, ch.calldata("AccountabilityLedger", "setAnchorer", [anchorer, True]))["status"], 16) == 1
    rc = send(rpc, anchorer, led, ch.calldata("AccountabilityLedger", "anchorBatch", [hex_to_bytes(root), len(s["hashes"]), "test://ts-vectors"]))
    assert int(rc["status"], 16) == 1
    i = 6
    rp, pp = tmp_path / "receipt.json", tmp_path / "proof.json"
    rp.write_text(json.dumps({"receipt": s["receipts"][i]}), encoding="utf-8")  # domain derived from the deployment
    pp.write_text(json.dumps({"proof": merkle_proof(layers, i), "root": root}), encoding="utf-8")
    code, out = run(capsys, "verify-receipt", str(rp), "--proof", str(pp), "--chain", "anvil", "--rpc", fork, "--json")
    assert code == 0, out
    res = json.loads(out)
    assert res["receiptHash"] == s["hashes"][i]
    assert {c["name"]: c["status"] for c in res["checks"]}["AccountabilityLedger.verifyReceipt(batchId, leaf, proof) returns true"] == "PASS"
    pp.write_text(json.dumps({"proof": merkle_proof(layers, i)[1:], "root": root}), encoding="utf-8")
    code, out = run(capsys, "verify-receipt", str(rp), "--proof", str(pp), "--chain", "anvil", "--rpc", fork)
    assert code == 1
    code, out = run(capsys, "verify-tx", rc["transactionHash"], "--chain", "anvil", "--rpc", fork)
    assert code == 0 and "ReceiptBatchAnchored" in out


def test_fork_disabled_then_revoked(capsys, fork, published):
    """Run last in this module: it disables the delegation and revokes the mandate inside the fork."""
    rpc, d, g = published["rpc"], published["d"], published["g"]
    m = g["mandate"]
    delegation = (m["agent"]["wallet"], m["principal"]["account"], hex_to_bytes(ROOT_AUTHORITY), caveats_abi_value(published["caveats"]), int(m["salt"]), b"")
    rc = send(rpc, m["principal"]["account"], d.addr("DelegationManager"), ch.calldata("DelegationManager", "disableDelegation", [delegation]))
    assert int(rc["status"], 16) == 1
    # Integrity still verifies; the status is reported, and --require-live turns it into a failure.
    code, out = run(capsys, "verify", "nadia", "--chain", "anvil", "--rpc", fork)
    assert code == 0
    assert "DISABLED" in out and "REVOKED" in out
    code, out = run(capsys, "verify", "nadia", "--chain", "anvil", "--rpc", fork, "--require-live")
    assert code == 1
    rc = send(rpc, m["principal"]["account"], d.addr("MandateRegistry"), ch.calldata("MandateRegistry", "revoke", [hex_to_bytes(g["mandateHash"])]))
    assert int(rc["status"], 16) == 1
    code, out = run(capsys, "verify", "nadia", "--chain", "anvil", "--rpc", fork, "--json")
    res = json.loads(out)
    assert code == 0 and res["revoked"] is True
    status = {c["name"]: c for c in res["checks"]}["registry isLive(mandateHash)"]
    assert status["status"] == "INFO" and "NOT LIVE" in status["detail"]
    code, out = run(capsys, "verify", "nadia", "--chain", "anvil", "--rpc", fork, "--json", "--require-live")
    res = json.loads(out)
    failed = {c["name"] for c in res["checks"] if c["status"] == "FAIL"}
    assert code == 1 and "registry isLive(mandateHash)" in failed


# ---------------------------------------------------------------- FISCO BCOS (read-only)

needs_fisco = pytest.mark.skipif(not reachable(FISCO, int(os.environ.get("FISCO_CHAIN_ID", "20200"))), reason=f"FISCO not reachable at {FISCO}")


@needs_fisco
def test_fisco_e2e_mandate_and_transactions(capsys):
    ev = evidence("fisco")
    seal = ev["seal"]
    if ch.mandate_of(Rpc(FISCO), load_deployment("fisco"), seal["mandateHash"])["status"] == "None":
        pytest.skip("e2e-fisco.json does not match the running FISCO ledger")
    code, out = run(capsys, "verify", seal["mandateHash"], "--chain", "fisco", "--rpc", FISCO)
    assert code == 0, out
    assert seal["delegationHash"] in out and seal["publishTx"] in out
    t1 = next(s for k, s in ev.items() if k.startswith("T1"))
    code, out = run(capsys, "verify-tx", t1["tx"], "--chain", "fisco", "--rpc", FISCO, "--expect", "success")
    assert code == 0, out
    attack = next(s for k, s in ev.items() if k.startswith("T4 raw attack"))
    code, out = run(capsys, "verify-tx", attack["tx"], "--chain", "fisco", "--rpc", FISCO, "--expect", "PayeeNotVerified")
    assert code == 0, out
    assert attack["revert"] in out
