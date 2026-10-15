"""Parity with vectors computed by the TypeScript reference (scripts/ts-vectors.ts)."""

from __future__ import annotations

import pytest

from conftest import deployment_for
from yinglong_verify.canonical import canonical_hash, canonical_json
from yinglong_verify.compile import CompileError, compile_mandate
from yinglong_verify.decompile import Names, decompile, format_units, names_for, rule_to_json, sentence
from yinglong_verify.delegation import Caveat, caveat_hash, delegation_hash
from yinglong_verify.hashring import ascii_strip, geometry, tick_difference
from yinglong_verify.hexutil import to_hex
from yinglong_verify.receipt import build_merkle, merkle_proof, merkle_root, receipt_hash, verify_merkle

INT_FIELDS = {"max", "amount", "periodStart", "periodLength", "window", "maxOutflow", "defaultT1Cap", "newPayeeT1Cap", "t2Ceiling", "maxApprovalWindow"}


def _ints(v, key=None):
    """Golden JSON carries bigints as decimal strings; turn them back into ints for sentence()."""
    if isinstance(v, dict):
        return {k: _ints(x, k) for k, x in v.items()}
    if isinstance(v, list):
        return [_ints(x, key) for x in v]
    if key in INT_FIELDS and isinstance(v, str):
        return int(v)
    return v


def test_canonical_json(vectors):
    for case in vectors["canonical"]:
        assert canonical_json(case["value"]) == case["canonicalJson"]
        assert canonical_hash(case["value"]) == case["hash"]


def test_canonical_sorts_by_utf16_not_code_point(vectors):
    case = vectors["canonical"][2]
    keys = list(case["value"].keys())
    # The astral key sorts before U+E000 in UTF-16 order (surrogate D83D < E000), unlike code-point order.
    assert case["canonicalJson"].index(chr(0x1F600)) < case["canonicalJson"].index(chr(0xE000))
    assert len(keys) == 4


def test_delegation_hashes(vectors):
    for dl in vectors["delegations"]:
        caveats = [Caveat(c["enforcer"], c["terms"], c["args"]) for c in dl["caveats"]]
        assert [to_hex(caveat_hash(c)) for c in caveats] == dl["caveatHashes"]
        assert delegation_hash(dl["delegate"], dl["delegator"], caveats, int(dl["salt"]), dl["authority"]) == dl["delegationHash"]


def _mandate_ids(vectors_json=None):
    import json
    from conftest import VECTORS

    if not VECTORS.exists():
        return []
    return [m["name"] for m in json.loads(VECTORS.read_text(encoding="utf-8"))["mandates"]]


@pytest.mark.parametrize("name", _mandate_ids())
def test_mandate_variants(vectors, name):
    case = next(m for m in vectors["mandates"] if m["name"] == name)
    d = deployment_for(case["deployment"])
    c = compile_mandate(case["mandate"], d)
    assert c.mandate_hash == case["mandateHash"]
    assert [x.to_json() for x in c.caveats] == case["caveats"]
    assert c.delegation_hash == case["delegationHash"]
    rules, sentences = decompile(c.caveats, d, names_for(d, c.mandate))
    assert [rule_to_json(r) for r in rules] == case["rules"]
    assert sentences == case["sentences"]
    _, ms = decompile(c.caveats, d, names_for(d, c.mandate), "ms")
    assert ms == case["sentencesMs"]


def test_extra_keys_are_stripped_before_hashing(vectors):
    for dep in vectors["deployments"]:
        base = next(m for m in vectors["mandates"] if m["name"] == f"{dep}:nadia")
        extra = next(m for m in vectors["mandates"] if m["name"] == f"{dep}:nadia-extra-key")
        assert "extraField" in extra["mandate"]
        assert extra["mandateHash"] == base["mandateHash"]


def test_compile_errors(vectors, anvil_deployment):
    for case in vectors["compileErrors"]:
        with pytest.raises(CompileError):
            compile_mandate(case["mandate"], anvil_deployment)


def test_synthetic_sentences(vectors):
    names = Names(
        label={"0x00000000000000000000000000000000000000a1": "tTEST", "0x00000000000000000000000000000000000000f1": "Facilitator One"},
        decimals={"0x00000000000000000000000000000000000000a1": 3},
    )
    for case in vectors["sentences"]:
        rule = _ints(case["rule"])
        assert sentence(rule, names, "s") == case["s"]
        assert sentence(rule, names, "ms") == case["ms"]


def test_format_units(vectors):
    for case in vectors["units"]:
        assert format_units(int(case["amount"]), case["decimals"]) == case["text"]


def test_hash_rings(vectors):
    for case in vectors["rings"]:
        assert geometry(case["hash"]) == case["geometry"]
        assert geometry(case["hash"], revoked=True) == case["revoked"]
        assert geometry(case["hash"], radius=2.5) == case["radius2"]
        assert ascii_strip(case["hash"]) == case["ascii"]
    for case in vectors["tickDiffs"]:
        assert tick_difference(case["a"], case["b"]) == case["diff"]


def test_receipt_hashes(vectors):
    for s in vectors["receipts"]:
        for r, h in zip(s["receipts"], s["hashes"]):
            assert receipt_hash(r, s["domain"]) == h


def test_receipt_hash_chain(vectors):
    for s in vectors["receipts"]:
        prev = "0x" + "00" * 32
        for r, h in zip(s["receipts"], s["hashes"]):
            assert r["prevReceiptHash"] == prev
            prev = h


def test_merkle(vectors):
    for t in vectors["merkle"]:
        layers = build_merkle(t["leaves"])
        assert layers == t["layers"]
        assert merkle_root(t["leaves"]) == t["root"]
        for i, leaf in enumerate(t["leaves"]):
            assert merkle_proof(layers, i) == t["proofs"][i]
            assert verify_merkle(leaf, t["proofs"][i], t["root"])
        if len(t["leaves"]) > 1:
            assert not verify_merkle(t["leaves"][0], t["proofs"][1], t["root"])


def test_doc_hash_matches_json_stringify(vectors):
    from yinglong_verify.canonical import doc_hash

    for case in vectors["docs"]:
        assert doc_hash(case["value"]) == case["hash"]
