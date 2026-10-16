import "./helpers/env";
import { describe, expect, it } from "vitest";
import { compileMandate, decompile, namesFor, normaliseVisitorRules, VISITOR_BOUNDS, type VisitorRules } from "@yinglong/mandate";
import { app } from "../src/server";
import { derivedAddress, draftMandate, groundToWords, mandateFromDraft, ruleParseDraft } from "../src/understand/draft";
import { deployment } from "./helpers/seed";

const M = 1_000_000n;
const empty: VisitorRules = { payees: [], budgets: [], t1Cap: null, t2Ceiling: null, reserveFloor: null, velocity: null, validityDays: null, unmapped: [] };

describe("rule parser (common phrasings)", () => {
  it("reads payees, a daily budget, approval threshold, ceiling, floor, velocity and validity", () => {
    const r = ruleParseDraft(
      "Pay Arena Cafe and Kowloon Food Mart. Food up to 150 a day. Ask me above 30. Never more than 300 in one payment. Keep at least 200 in my balance. At most 5 payments an hour. Valid for 7 days.",
    );
    expect(r).toEqual({
      payees: ["arena_cafe", "kowloon_food_mart"],
      budgets: [{ category: "food", amount: "150" }],
      t1Cap: "30",
      t2Ceiling: "300",
      reserveFloor: "200",
      velocity: { window: "hour", maxCount: 5, maxOutflow: null },
      validityDays: 7,
      unmapped: [],
    });
  });

  it("maps categories from shop names, honours a forbidden payee and flags what it cannot map", () => {
    expect(ruleParseDraft("Books 400 a day at HBU Bookshop, rent 900 a day to Harbour Homes")).toMatchObject({
      payees: ["hbu_bookshop", "harbour_homes"],
      budgets: [
        { category: "tuition", amount: "400" },
        { category: "rent", amount: "900" },
      ],
    });
    const r = ruleParseDraft("Food 80 a day, never pay Arena Cafe. Send my sister 50 USD every week. Groceries 500 a month.");
    expect(r.payees).toEqual(["kowloon_food_mart"]);
    expect(r.budgets).toEqual([{ category: "food", amount: "80" }]);
    expect(r.unmapped).toEqual(["Send my sister 50 USD every week (only tHKD test units are supported)", "Groceries 500 a month (only daily budgets are supported)"]);
    expect(ruleParseDraft("up to 20 at a time, 1.5k in total per day").velocity).toEqual({ window: "day", maxCount: null, maxOutflow: "1500" });
    expect(ruleParseDraft("up to 20 at a time").t1Cap).toBe("20");
    expect(ruleParseDraft("up to 200 with my passkey").t2Ceiling).toBe("200");
  });
});

describe("bounds", () => {
  it("clamps 1,000,000 tHKD to the visitor bound and says why", () => {
    const r = ruleParseDraft("Spend 1,000,000 HKD a day on food");
    expect(r.budgets).toEqual([{ category: "food", amount: "1000000" }]);
    const { rules, adjustments } = normaliseVisitorRules(r);
    expect(rules.budgets.find((b) => b.category === "food")!.amount).toBe(VISITOR_BOUNDS.dailyBudgetMax * M);
    expect(adjustments.find((a) => a.field === "budget.food")).toMatchObject({ kind: "clamped", said: "1000000", enforced: "1000" });
    expect(adjustments.find((a) => a.field === "budget.food")!.reason).toMatch(/visitor bound of 1000 tHKD/);
  });

  it("keeps the approval threshold under the ceiling, the floor inside the faucet and validity within 30 days", () => {
    const { rules, adjustments } = normaliseVisitorRules({ ...empty, t1Cap: "150", t2Ceiling: "100", reserveFloor: "5000", validityDays: 365, velocity: { window: "day", maxCount: 500, maxOutflow: "99999" } });
    expect(rules.t2Ceiling).toBe(100n * M);
    expect(rules.t1Cap).toBe(100n * M);
    expect(rules.reserveFloor).toBe(VISITOR_BOUNDS.floorMax * M);
    expect(rules.validityDays).toBe(30);
    expect(rules.velocity).toEqual({ window: "day", maxCount: 50, maxOutflow: 1_000n * M });
    expect(adjustments.map((a) => `${a.field}:${a.kind}`)).toEqual(
      expect.arrayContaining(["t1Cap:adjusted", "reserveFloor:clamped", "validityDays:clamped", "velocity.maxCount:clamped", "velocity.maxOutflow:clamped"]),
    );
    // Payees default to the standard visitor three, each category gets a budget, unlisted "services" stays tiny.
    expect(rules.payees).toEqual(["arena_cafe", "kowloon_food_mart", "hbu_bookshop"]);
    expect(rules.budgets.map((b) => [b.category, b.amount])).toEqual([
      ["food", 100n * M],
      ["tuition", 300n * M],
      ["services", 2n * M],
    ]);
  });

  it("refuses anything outside the closed schema", () => {
    expect(() => normaliseVisitorRules({ ...empty, payees: ["mirage"] })).toThrow();
    expect(() => normaliseVisitorRules({ ...empty, t1Cap: "-5" })).toThrow();
    expect(() => normaliseVisitorRules({ ...empty, extra: "x", budgets: [{ category: "casino", amount: "5" }] })).toThrow();
  });

  it("a model's number that is not in the user's words is dropped and flagged", () => {
    const g = groundToWords({ ...empty, t1Cap: "999", t2Ceiling: "300", budgets: [{ category: "food", amount: "1,5" as never }] }, "never above 300");
    expect(g.t1Cap).toBeNull();
    expect(g.t2Ceiling).toBe("300");
    expect(g.unmapped.join(" ")).toMatch(/approval threshold 999/);
  });
});

describe("draft -> compile -> decompile", () => {
  const text = "Pay Arena Cafe and HBU Bookshop. Food up to 150 a day, books 250 a day. Ask me above 30. Never more than 300 in one payment. Keep at least 200. Spend 1,000,000 a day on rent. Tip my barber 5.";

  it("shows only what the compiled caveats enforce, with the user's words and every gap flagged", async () => {
    const d = await draftMandate({ text, ledger: "anvil" });
    expect(d.aigc).toMatchObject({ via: "rules", model: "deterministic rule parser", provider: "local" });
    expect(d.roundTrip.ok).toBe(true);
    expect(d.compiled.caveatCount).toBeGreaterThan(10);
    expect(d.decodedSentences).toContain("Every day: food at most 150 tHKD, tuition at most 250 tHKD, rent at most 1,000 tHKD and services at most 2 tHKD.");
    expect(d.decodedSentences).toContain("Your tHKD balance never goes below 200 tHKD.");
    expect(d.decodedSentences.find((s) => s.startsWith("Payments above"))).toBe(
      "Payments above 30 tHKD need your approval on your phone; anyone new above 1 tHKD also needs you; nothing above 300 tHKD is possible at all.",
    );
    const by = Object.fromEntries(d.diff.map((r) => [r.rule, r]));
    expect(by["daily budget: food"]).toMatchObject({ status: "as you said", flagged: false });
    expect(by["daily budget: rent"]).toMatchObject({ status: "clamped", flagged: true, said: "1000000 tHKD" });
    expect(by["ask me above (T1 cap)"]).toMatchObject({ status: "as you said", enforced: "30 tHKD" });
    expect(by["payments per hour"]).toMatchObject({ status: "default" });
    expect(d.diff.find((r) => r.status === "not enforced")).toMatchObject({ said: "Tip my barber 5", flagged: true });
    // Rent was budgeted, so its catalogue payee is not silently added: the payee book is what the user named.
    expect(d.payeeBook.map((p) => p.id)).toEqual(["arena_cafe", "hbu_bookshop"]);
    expect(d.userSentences[0]).toBe("Pay Arena Cafe and HBU Bookshop.");
    expect(d.hashRing.hash).toBe(d.compiled.delegationHash);
  });

  it("server-side re-validation of the returned draft is a fixed point; another account changes only the binding", async () => {
    const d = await draftMandate({ text, ledger: "anvil" });
    const names = (m: Parameters<typeof namesFor>[1]) => namesFor(deployment, m);
    const preview = { account: derivedAddress("yinglong:visitor-draft:account"), agent: derivedAddress("yinglong:visitor-draft:agent") };
    // Same parties: identical sentences (the binding line carries the mandate hash, which depends on validity time).
    const again = mandateFromDraft("anvil", d.draft, { ...preview, name: "Visitor", now: 1_800_000_000, salt: "1" });
    const c1 = compileMandate(again.mandate, deployment);
    const s1 = decompile(c1.caveats, deployment, names(again.mandate)).sentences;
    const strip = (xs: string[]) => xs.filter((s) => !s.startsWith("It works only while mandate"));
    expect(strip(s1)).toEqual(strip(d.decodedSentences));
    expect(again.adjustments.filter((a) => a.kind === "clamped")).toEqual([]); // already inside the bounds
    // A real visitor account: same rules, same English; only the mandate hash in the binding line differs.
    const other = mandateFromDraft("anvil", d.draft, { account: derivedAddress("someone"), agent: derivedAddress("their-agent"), name: "Visitor X", now: 1_800_000_000, salt: "9" });
    const c2 = compileMandate(other.mandate, deployment);
    const s2 = decompile(c2.caveats, deployment, names(other.mandate)).sentences;
    expect(strip(s2)).toEqual(strip(s1));
    expect(c2.mandateHash).not.toBe(c1.mandateHash);
  });
});

describe("routes", () => {
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  it("POST /v1/mandates/draft returns the decoded draft; bad input is a 400", async () => {
    const r = await post("/v1/mandates/draft", { text: "Food up to 60 a day at Kowloon Food Mart. Ask me above 10.", ledger: "anvil" });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { draft: { rules: VisitorRules }; compiled: { caveatCount: number }; decodedSentences: string[] };
    expect(j.draft.rules).toMatchObject({ payees: ["kowloon_food_mart"], t1Cap: "10" });
    expect(j.decodedSentences.some((s) => s.includes("food at most 60 tHKD"))).toBe(true);
    expect((await post("/v1/mandates/draft", { text: "" })).status).toBe(400);
    expect((await post("/v1/mandates/draft", { text: "x", principal: "nadia" })).status).toBe(400);
  });
  it("sign-up refuses a draft outside the closed schema before touching any ledger", async () => {
    const r = await post("/v1/visitors", {
      credentialId: "AAAAAAAAAAAAAAAAAAAAAA",
      publicKey: { x: `0x${"11".repeat(32)}`, y: `0x${"22".repeat(32)}` },
      mandate: { template: "visitor", rules: { ...empty, payees: ["mirage"] }, userSentences: [] },
    });
    expect(r.status).toBe(400);
    expect((await post("/v1/visitors/v-0123456789/reseal", {})).status).toBe(400);
  });
});
