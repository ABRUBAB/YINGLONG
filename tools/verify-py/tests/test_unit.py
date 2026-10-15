"""Unit tests that do not need the TypeScript vectors or a ledger."""

from __future__ import annotations

import copy
import random
import xml.etree.ElementTree as ET

import pytest

from conftest import golden_path, load_json
from yinglong_verify.abi import registry
from yinglong_verify.canonical import canonical_json
from yinglong_verify.compile import compile_mandate
from yinglong_verify.constants import CATEGORY_IDS, SELECTORS
from yinglong_verify.decompile import DecodeError, decode_caveat, duration, format_units
from yinglong_verify.delegation import Caveat
from yinglong_verify.hashring import geometry, js_round, svg, tick_difference
from yinglong_verify.hexutil import is_address, keccak_hex, to_checksum
from yinglong_verify.schema import MandateError, parse_mandate


def test_keccak_known_value():
    assert keccak_hex(b"") == "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"


def test_checksum_and_viem_address_rules():
    a = "0xdD08Ffa06fDCCf17b3E3Be6bd3cEe55ce46b89F7"
    assert to_checksum(a.lower()) == a
    assert is_address(a) and is_address(a.lower())
    assert not is_address(a[:2] + a[2:].upper())  # viem refuses all-upper-case unless it is the checksum
    assert not is_address(a[:-1] + "f")  # bad checksum
    assert not is_address("0X" + a[2:].lower())


def test_canonical_refuses_floats_and_unsafe_ints():
    with pytest.raises(ValueError):
        canonical_json({"x": 1.5})
    with pytest.raises(ValueError):
        canonical_json({"x": 2**53})
    assert canonical_json({"x": 5.0}) == '{"x":5}'


def test_schema_rejects_and_strips():
    m = load_json(golden_path("nadia"))["mandate"]
    bad = copy.deepcopy(m)
    bad["salt"] = "1\n"  # JavaScript's $ does not match before a trailing newline
    with pytest.raises(MandateError):
        parse_mandate(bad)
    bad = copy.deepcopy(m)
    bad["tiers"][0]["defaultT1Cap"] = 2000.5
    with pytest.raises(MandateError):
        parse_mandate(bad)
    bad = copy.deepcopy(m)
    del bad["velocity"]
    with pytest.raises(MandateError, match="velocity: required"):
        parse_mandate(bad)
    extra = copy.deepcopy(m)
    extra["note"] = "x"
    extra["principal"]["nickname"] = "y"
    p = parse_mandate(extra)
    assert "note" not in p and "nickname" not in p["principal"]


def test_format_units_and_duration():
    assert format_units(9_500_000_000, 6) == "9,500"
    assert format_units(1_500_000, 6) == "1.5"
    assert format_units(-12345, 2) == "-123.45"
    assert format_units(7, 0) == "7"
    assert duration(86400) == "day" and duration(2592000) == "30 days"
    assert duration(3600) == "hour" and duration(7200) == "2 hours"
    assert duration(120) == "2 minutes" and duration(61) == "61 seconds"
    assert duration(86_400_000, "ms") == "day"


def test_js_round_is_half_up():
    assert js_round(0.0000005) == 0.000001
    assert js_round(-0.0000005) == 0.0
    assert js_round(-90.0) == -90.0


def test_decode_refuses_malformed_terms(anvil_deployment):
    d = anvil_deployment
    with pytest.raises(DecodeError):
        decode_caveat(Caveat(d.addr("AllowedTargetsEnforcer"), "0x" + "11" * 19), d)
    with pytest.raises(DecodeError):
        decode_caveat(Caveat(d.addr("ReserveFloorEnforcer"), "0x1234"), d)
    r = decode_caveat(Caveat("0x" + "12" * 20, "0x"), d)
    assert r["kind"] == "unknown"


def test_selectors_and_categories_match_the_bundled_abis():
    from yinglong_verify.abi import load_abi, signature
    from yinglong_verify.hexutil import keccak

    sels = {}
    for name in ("TestUnits", "ConditionalPaymentInstructions"):
        for it in load_abi(name):
            if it.get("type") == "function":
                sels[it["name"]] = "0x" + keccak(signature(it).encode())[:4].hex()
    for k, v in SELECTORS.items():
        assert sels[k] == v
    assert CATEGORY_IDS == {"rent": 1, "food": 2, "tuition": 3, "transport": 4, "utilities": 5, "supplier": 6, "payroll": 7, "services": 8, "treasury": 9, "other": 10}


def test_one_field_changes_at_least_16_ticks(anvil_deployment):
    """Property from plan section 14.6, sampled over random single-field edits of the Nadia mandate."""
    m = load_json(golden_path("nadia"))["mandate"]
    base = compile_mandate(m, anvil_deployment).delegation_hash
    rng = random.Random(14_6)
    for _ in range(40):
        e = copy.deepcopy(m)
        which = rng.randrange(4)
        if which == 0:
            e["salt"] = str(rng.randrange(2, 10**12))
        elif which == 1:
            cap = rng.choice(e["budgets"][0]["caps"])
            cap["amount"] = str(int(cap["amount"]) + rng.randrange(1, 10**9))
        elif which == 2:
            e["velocity"]["maxCount"] = rng.randrange(9, 99)
        else:
            e["reserveFloors"][0]["amount"] = str(rng.randrange(10**9))
        h = compile_mandate(e, anvil_deployment).delegation_hash
        assert h != base
        # Independent 256-bit hashes share a nibble with probability 1/16, so fewer than 16 differing
        # ticks has probability below 1e-40 per pair; the seed makes the sample reproducible.
        assert tick_difference(h, base) >= 16


def test_svg_is_well_formed():
    h = "0x" + "9a" * 32
    for revoked in (False, True):
        root = ET.fromstring(svg(h, revoked=revoked, title="t"))
        lines = [el for el in root.iter() if el.tag.endswith("line")]
        assert len(lines) == (60 if revoked else 64)
        assert len([el for el in root.iter() if el.tag.endswith("path")]) == 9
    assert len(geometry(h)["ticks"]) == 64


def test_revert_decoding():
    reg = registry()
    payee = "0x3705eee97764b06c20Ce15594214168cA462C977"
    data = "0x9c9e74ce000000000000000000000000" + payee[2:].lower()
    r = reg.decode_revert(data)
    assert r.name == "PayeeNotVerified" and r.message == f"PayeeNotVerified({payee})"
    s = reg.decode_revert("0x08c379a0" + "00" * 31 + "20" + "00" * 31 + "05" + "68656c6c6f" + "00" * 27)
    assert s.name == "Error" and s.message == "hello"
    p = reg.decode_revert("0x4e487b71" + "00" * 31 + "11")
    assert p.name == "Panic" and "overflow" in p.message
    assert reg.decode_revert("0x").message == "reverted without data"
    assert reg.decode_revert("0x12345678").name == "Unknown"


def test_js_number_formatting():
    from yinglong_verify.canonical import js_number, js_stringify

    cases = {1e-7: "1e-7", 1e21: "1e+21", 1e20: "100000000000000000000", 0.000001: "0.000001", 123.456: "123.456",
             -0.0: "0", 100.0: "100", 1.5e-10: "1.5e-10", 5e-324: "5e-324", 2.5: "2.5", 1.7976931348623157e308: "1.7976931348623157e+308"}
    for x, want in cases.items():
        assert js_number(x) == want, x
    assert js_number(2**53 + 2) == "9007199254740994"
    assert js_stringify({"b": 1, "a": {"$n": "12"}}) == '{"b":1,"a":"12"}'
