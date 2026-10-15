"""The mandate compiler, re-implemented independently from the enforcers' term layouts.

Caveat order (allowlists always first), and each enforcer's terms (see contracts/src/enforcers/*.sol):
  AllowedTargetsEnforcer    packed 20-byte asset addresses
  AllowedMethodsEnforcer    packed 4-byte selectors
  ValueLteEnforcer          abi.encode(uint256 0)
  ForbiddenTargetsEnforcer  packed 20-byte addresses (protocol contracts + ledger extras)
  GlobalPauseEnforcer       abi.encode(address killSwitch, address passportRegistry)
  AgentLineageEnforcer      abi.encode(address passportRegistry, bytes32 keccak(ownerDid), address facilitator)
  MandateBindingEnforcer    abi.encode(address mandateRegistry, bytes32 mandateHash)
  JurisdictionEnforcer      abi.encode(uint8 profile, address[] assets)
  VerifiedPayeeEnforcer     abi.encode(address payeeBook, address passport, address[] issuers, address[] intermediaries)
  CoSignEnforcer (per tier) abi.encode(address payeeBook, address asset, uint256 defaultT1Cap, uint256 newPayeeT1Cap,
                            uint256 t2Ceiling, uint256 maxApprovalWindow, uint32[] categoryIds, uint256[] caps)
  CategoryBudgetEnforcer    abi.encode(address payeeBook, address asset, uint64 periodStart, uint64 periodLength,
     (per budget)           uint32 unlistedCategory, uint32[] categoryIds, uint256[] caps)
  ReserveFloorEnforcer      abi.encode(address asset, uint256 floor)                       (per floor)
  VelocityEnforcer          abi.encode(address asset, uint64 window, uint32 maxCount, uint256 maxOutflow)
  SuitabilityEnforcer       abi.encode(address productRegistry, uint8 maxRiskClass)
"""

from __future__ import annotations

from dataclasses import dataclass, field

from eth_abi import encode

from .canonical import canonical_hash
from .constants import CATEGORY_IDS, EXTRA_FORBIDDEN, PROFILE_IDS, SELECTORS
from .delegation import Caveat, delegation_hash
from .deployment import Deployment
from .hexutil import ZERO_ADDRESS, addr_bytes, hex_to_bytes, require_address, text_hash, to_hex
from .schema import parse_mandate

CAVEAT_ORDER = [
    "AllowedTargetsEnforcer",
    "AllowedMethodsEnforcer",
    "ValueLteEnforcer",
    "ForbiddenTargetsEnforcer",
    "GlobalPauseEnforcer",
    "AgentLineageEnforcer",
    "MandateBindingEnforcer",
    "JurisdictionEnforcer",
    "VerifiedPayeeEnforcer",
    "CoSignEnforcer",
    "CategoryBudgetEnforcer",
    "ReserveFloorEnforcer",
    "VelocityEnforcer",
    "SuitabilityEnforcer",
    "ReputationGateEnforcer",
]


class CompileError(ValueError):
    pass


@dataclass
class Compiled:
    mandate: dict
    mandate_hash: str
    lineage_id_hash: str
    caveats: list[Caveat]
    caveat_names: list[str]
    delegator: str
    delegate: str
    salt: int
    delegation_hash: str
    notes: list[str] = field(default_factory=list)


def forbidden_targets(d: Deployment) -> list[str]:
    own = [
        d.addr("DelegationManager"),
        d.addr("EntryPoint"),
        d.addr("PayeeBook"),
        d.addr("MandateRegistry"),
        d.addr("KillSwitchRegistry"),
        d.addr("YinglongPassportRegistry"),
        d.addr("AccountabilityLedger"),
        d.addr("ProductRegistry"),
    ]
    seen: dict[str, str] = {}
    for a in own + EXTRA_FORBIDDEN.get(d.ledger, []):
        seen.setdefault(a.lower(), a)
    return list(seen.values())


def _asset_address(m: dict, symbol: str) -> str:
    for a in m["assets"]:
        if a["symbol"] == symbol:
            return a["address"]
    raise CompileError(f"mandate references unknown asset {symbol}")


def _packed(addresses: list[str]) -> str:
    return to_hex(b"".join(addr_bytes(a) for a in addresses))


def compile_mandate(doc: dict, d: Deployment) -> Compiled:
    m = parse_mandate(doc)
    if m["ledger"] != d.ledger:
        raise CompileError(f"mandate is for {m['ledger']}, deployment is {d.ledger}")
    mandate_hash = canonical_hash(m)
    account = require_address(m["principal"]["account"], "principal.account")
    agent = require_address(m["agent"]["wallet"], "agent.wallet")
    caveats: list[Caveat] = []
    names: list[str] = []

    def push(name: str, terms: bytes | str) -> None:
        caveats.append(Caveat(d.addr(name), terms if isinstance(terms, str) else to_hex(terms), "0x"))
        names.append(name)

    # 1. Allowlists first.
    targets = [a["address"] for a in m["assets"]]
    forbidden = forbidden_targets(d)
    fset = {a.lower() for a in forbidden}
    for t in targets:
        if t.lower() in fset or t.lower() == account.lower():
            raise CompileError(f"allowlist overlaps the forbidden set: {t}")
    push("AllowedTargetsEnforcer", _packed(targets))
    push("AllowedMethodsEnforcer", to_hex(b"".join(hex_to_bytes(SELECTORS[x]) for x in m["methods"])))
    push("ValueLteEnforcer", encode(["uint256"], [0]))
    push("ForbiddenTargetsEnforcer", _packed(forbidden))

    # 2. Identity, pause and binding.
    push("GlobalPauseEnforcer", encode(["address", "address"], [d.addr("KillSwitchRegistry"), d.addr("YinglongPassportRegistry")]))
    facilitator = m["facilitator"] if m["facilitator"] is not None else ZERO_ADDRESS
    push(
        "AgentLineageEnforcer",
        encode(
            ["address", "bytes32", "address"],
            [d.addr("YinglongPassportRegistry"), hex_to_bytes(text_hash(m["principal"]["did"])), require_address(facilitator, "facilitator")],
        ),
    )
    push("MandateBindingEnforcer", encode(["address", "bytes32"], [d.addr("MandateRegistry"), hex_to_bytes(mandate_hash)]))

    # 3. Rails and payees.
    push("JurisdictionEnforcer", encode(["uint8", "address[]"], [PROFILE_IDS[m["jurisdiction"]], [require_address(t) for t in targets]]))
    push(
        "VerifiedPayeeEnforcer",
        encode(
            ["address", "address", "address[]", "address[]"],
            [
                d.addr("PayeeBook"),
                d.addr("YinglongPassportRegistry"),
                [require_address(x["address"]) for x in m["trustedIssuers"]],
                [require_address(x["address"]) for x in m["intermediaries"]],
            ],
        ),
    )

    # 4. Tiers, per asset.
    for t in m["tiers"]:
        push(
            "CoSignEnforcer",
            encode(
                ["address", "address", "uint256", "uint256", "uint256", "uint256", "uint32[]", "uint256[]"],
                [
                    d.addr("PayeeBook"),
                    require_address(_asset_address(m, t["asset"])),
                    int(t["defaultT1Cap"]),
                    int(t["newPayeeT1Cap"]),
                    int(t["t2Ceiling"]),
                    int(t["maxApprovalWindow"]),
                    [CATEGORY_IDS[c["category"]] for c in t["categoryT1Caps"]],
                    [int(c["amount"]) for c in t["categoryT1Caps"]],
                ],
            ),
        )

    # 5. Budgets, reserve floor, velocity, suitability, reputation.
    for b in m["budgets"]:
        push(
            "CategoryBudgetEnforcer",
            encode(
                ["address", "address", "uint64", "uint64", "uint32", "uint32[]", "uint256[]"],
                [
                    d.addr("PayeeBook"),
                    require_address(_asset_address(m, b["asset"])),
                    int(b["periodStart"]),
                    int(b["periodLength"]),
                    CATEGORY_IDS[b["unlistedCategory"]],
                    [CATEGORY_IDS[c["category"]] for c in b["caps"]],
                    [int(c["amount"]) for c in b["caps"]],
                ],
            ),
        )
    for f in m["reserveFloors"]:
        push("ReserveFloorEnforcer", encode(["address", "uint256"], [require_address(_asset_address(m, f["asset"])), int(f["amount"])]))
    v = m["velocity"]
    if v:
        push(
            "VelocityEnforcer",
            encode(
                ["address", "uint64", "uint32", "uint256"],
                [require_address(_asset_address(m, v["asset"])), int(v["window"]), int(v["maxCount"]), int(v["maxOutflow"])],
            ),
        )
    if m["suitability"]:
        push("SuitabilityEnforcer", encode(["address", "uint8"], [d.addr("ProductRegistry"), int(m["suitability"]["maxRiskClass"])]))
    if m["reputation"]:
        raise CompileError(
            "reputation gate requires an ERC-8004 reputation registry address in the deployment (not configured yet)"
        )

    salt = int(m["salt"])
    return Compiled(
        mandate=m,
        mandate_hash=mandate_hash,
        lineage_id_hash=text_hash(m["lineageId"]),
        caveats=caveats,
        caveat_names=names,
        delegator=account,
        delegate=agent,
        salt=salt,
        delegation_hash=delegation_hash(agent, account, caveats, salt),
    )
