"""Golden-file parity with the TypeScript reference (packages/mandate/golden/*.json)."""

from __future__ import annotations

import pytest

from conftest import GOLDEN_NAMES, golden_path, load_json
from yinglong_verify.canonical import canonical_hash, canonical_json
from yinglong_verify.compile import compile_mandate
from yinglong_verify.decompile import decompile, names_for, rule_to_json
from yinglong_verify.delegation import Caveat, delegation_hash
from yinglong_verify.hashring import ascii_strip, geometry, tick_difference
from yinglong_verify.hexutil import text_hash
from yinglong_verify.schema import parse_mandate


@pytest.fixture(scope="module", params=GOLDEN_NAMES)
def golden(request):
    return request.param, load_json(golden_path(request.param))


@pytest.fixture(scope="module")
def compiled(golden, anvil_deployment):
    return compile_mandate(golden[1]["mandate"], anvil_deployment)


def test_golden_is_for_the_bundled_deployment(golden):
    assert golden[1]["deployment"] == "contracts/deployments/anvil.json"


def test_canonical_json_is_byte_identical(golden):
    m = parse_mandate(golden[1]["mandate"])
    assert canonical_json(m) == golden[1]["canonicalJson"]


def test_python_twin_of_canonical_json_is_json_dumps(golden):
    import json

    m = parse_mandate(golden[1]["mandate"])
    assert canonical_json(m) == json.dumps(m, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def test_mandate_hash(golden, compiled):
    assert compiled.mandate_hash == golden[1]["mandateHash"]
    assert canonical_hash(parse_mandate(golden[1]["mandate"])) == golden[1]["mandateHash"]


def test_lineage_hash(golden, compiled):
    assert compiled.lineage_id_hash == golden[1]["lineageIdHash"] == text_hash(golden[1]["mandate"]["lineageId"])


def test_caveat_count_and_order(golden, compiled, anvil_deployment):
    gold = golden[1]["caveats"]
    assert len(compiled.caveats) == len(gold)
    names = anvil_deployment.name_by_address()
    assert [names[c["enforcer"].lower()] for c in gold] == compiled.caveat_names
    assert compiled.caveat_names[:2] == ["AllowedTargetsEnforcer", "AllowedMethodsEnforcer"]


def _caveat_params():
    out = []
    for name in GOLDEN_NAMES:
        g = load_json(golden_path(name))
        out += [pytest.param(name, i, id=f"{name}-{i}") for i in range(len(g["caveats"]))]
    return out


@pytest.mark.parametrize("name,i", _caveat_params())
def test_every_caveat_byte_for_byte(name, i, anvil_deployment):
    g = load_json(golden_path(name))
    c = compile_mandate(g["mandate"], anvil_deployment).caveats[i]
    assert c.enforcer == g["caveats"][i]["enforcer"]
    assert c.terms == g["caveats"][i]["terms"]
    assert c.args == g["caveats"][i]["args"] == "0x"


def test_delegation_fields(golden, compiled):
    dl = golden[1]["delegation"]
    assert compiled.delegate == dl["delegate"]
    assert compiled.delegator == dl["delegator"]
    assert str(compiled.salt) == dl["salt"]
    assert dl["authority"] == "0x" + "ff" * 32


def test_delegation_hash(golden, compiled):
    assert compiled.delegation_hash == golden[1]["delegationHash"]
    caveats = [Caveat.from_json(c) for c in golden[1]["caveats"]]
    dl = golden[1]["delegation"]
    assert delegation_hash(dl["delegate"], dl["delegator"], caveats, int(dl["salt"]), dl["authority"]) == golden[1]["delegationHash"]


def test_delegation_hash_ignores_args(golden):
    dl = golden[1]["delegation"]
    caveats = [Caveat(c["enforcer"], c["terms"], "0xdeadbeef") for c in golden[1]["caveats"]]
    assert delegation_hash(dl["delegate"], dl["delegator"], caveats, int(dl["salt"])) == golden[1]["delegationHash"]


def test_rules(golden, compiled, anvil_deployment):
    rules, _ = decompile(compiled.caveats, anvil_deployment, names_for(anvil_deployment, compiled.mandate))
    assert [rule_to_json(r) for r in rules] == golden[1]["rules"]


def test_sentences_byte_for_byte(golden, compiled, anvil_deployment):
    _, sentences = decompile(compiled.caveats, anvil_deployment, names_for(anvil_deployment, compiled.mandate))
    assert sentences == golden[1]["sentences"]


def test_hash_ring_geometry(golden):
    h = golden[1]["delegationHash"]
    g = geometry(h)
    assert len(g["ticks"]) == 64 and len(g["arcs"]) == 9
    assert g == golden[1]["hashRing"]


def test_hash_ring_revoked(golden):
    h = golden[1]["delegationHash"]
    g = geometry(h, revoked=True)
    assert len(g["ticks"]) == 60
    assert {t["i"] for t in g["ticks"]}.isdisjoint({62, 63, 0, 1})
    assert g == golden[1]["hashRingRevoked"]


def test_hash_ring_ascii(golden):
    assert ascii_strip(golden[1]["delegationHash"]) == golden[1]["hashRingAscii"]


def test_one_word_changes_the_ring(golden, anvil_deployment):
    """Plan section 14.6: mandates differing in one field differ in at least 16 ticks (checked on this edit)."""
    import copy

    m = copy.deepcopy(golden[1]["mandate"])
    m["budgets"][0]["caps"][0]["amount"] = str(int(m["budgets"][0]["caps"][0]["amount"]) * 10)
    edited = compile_mandate(m, anvil_deployment)
    assert edited.delegation_hash != golden[1]["delegationHash"]
    assert tick_difference(edited.delegation_hash, golden[1]["delegationHash"]) >= 16
