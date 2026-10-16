import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { loadDeployment } from "@yinglong/sdk/server";
import { compileMandate, normaliseVisitorRules, VISITOR_PAYEES, visitorMandate, visitorMandateFromRules } from "../src/index";

const d = loadDeployment("anvil");
const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const empty = { payees: [], budgets: [], t1Cap: null, t2Ceiling: null, reserveFloor: null, velocity: null, validityDays: null, unmapped: [] };

describe("visitor rules", () => {
  it("unstated rules compile to exactly the standard visitor mandate's caveats (binding aside)", () => {
    const addrOf = { arena_cafe: A(0x11), kowloon_food_mart: A(0x12), hbu_bookshop: A(0x13), harbour_homes: A(0x14), victoria_fx: A(0x15) } as const;
    const std = visitorMandate(d, { account: A(0xa), agent: A(0xb), cafe: addrOf.arena_cafe, foodMart: addrOf.kowloon_food_mart, bookshop: addrOf.hbu_bookshop, issuerBank: A(0xc) }, { now: 1_800_000_000, name: "V" });
    const { rules } = normaliseVisitorRules(empty);
    const own = visitorMandateFromRules(d, { account: A(0xa), agent: A(0xb), issuerBank: A(0xc), payeeAddress: (id) => addrOf[id] }, rules, { now: 1_800_000_000, name: "V", sentences: [] });
    const a = compileMandate(std, d).caveats;
    const b = compileMandate(own, d).caveats;
    const binding = d.contracts.MandateBindingEnforcer.address.toLowerCase();
    const strip = (cs: typeof a) => cs.filter((c) => c.enforcer.toLowerCase() !== binding).map((c) => `${c.enforcer}:${c.terms}`);
    expect(strip(b)).toEqual(strip(a));
    expect(own.payees.map((p) => p.id)).toEqual(["arena_cafe", "kowloon_food_mart", "hbu_bookshop"]);
  });

  it("the catalogue is fixed and every bound is applied", () => {
    expect(VISITOR_PAYEES.map((p) => p.label)).toEqual(["Arena Cafe", "Kowloon Food Mart", "HBU Bookshop", "Harbour Homes", "Victoria FX"]);
    const { rules, adjustments } = normaliseVisitorRules({ ...empty, budgets: [{ category: "food", amount: "1000000" }], t2Ceiling: "1000000", t1Cap: "1000000" });
    expect(rules.budgets[0]!.amount).toBe(1_000n * 1_000_000n);
    expect(rules.t2Ceiling).toBe(1_000n * 1_000_000n);
    expect(rules.t1Cap).toBe(200n * 1_000_000n);
    expect(adjustments.filter((x) => x.kind === "clamped").map((x) => x.field)).toEqual(["budget.food", "t2Ceiling", "t1Cap"]);
  });
});
