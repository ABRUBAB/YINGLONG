import { dir } from "./helpers/env";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { _resetProviderState, parseDashscopeKeyFile, providerStatus, structured, textModels, visionModels } from "../src/llm/provider";
import { fillFromWords, ruleParse, understand } from "../src/understand/intent";

// Fake keys (not real credentials): the tests only check routing and that keys never leave the process.
const FAKE_DS = "sk-ws-TESTONLY.fake_key-000000";
const FAKE_OR = "sk-or-TESTONLY-fake";
const dsFile = join(dir, "dashscope.txt");
const orFile = join(dir, "openrouter.txt");
writeFileSync(dsFile, `${FAKE_DS}\n`);
writeFileSync(orFile, FAKE_OR);

const Out = z.object({ answer: z.string() });
const SCHEMA = { type: "object", required: ["answer"], properties: { answer: { type: "string" } } };
const msgs = [{ role: "system" as const, content: "Answer in JSON." }, { role: "user" as const, content: "hello" }];

type Call = { url: string; body: Record<string, unknown>; auth: string };
function mockFetch(handler: (c: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const c = { url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).Authorization) };
      calls.push(c);
      const r = handler(c);
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}
const ok = (content: string) => ({ status: 200, json: { choices: [{ message: { content } }] } });

beforeEach(() => {
  process.env.LLM_DISABLED = "0";
  process.env.DASHSCOPE_DISABLED = "0";
  process.env.DASHSCOPE_KEY_FILE = dsFile;
  process.env.OPENROUTER_KEY_FILE = orFile;
  delete process.env.OPENROUTER_MODELS;
  delete process.env.DASHSCOPE_MODELS;
  delete process.env.OPENROUTER_ALLOW_PAID;
  _resetProviderState();
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.LLM_DISABLED = "1";
});

describe("DashScope key file", () => {
  it("reads the bare key, the field,value export and a header-row CSV", () => {
    expect(parseDashscopeKeyFile(`${FAKE_DS}\n`)).toBe(FAKE_DS);
    expect(parseDashscopeKeyFile(`\uFEFFid,123\napiKey,${FAKE_DS}\napiHost,x\n`)).toBe(FAKE_DS);
    expect(parseDashscopeKeyFile(`id,apiKey,workspace\n1,"${FAKE_DS}",w\n`)).toBe(FAKE_DS);
    expect(parseDashscopeKeyFile("id,1\nname,nothing here\n")).toBeUndefined();
  });
});

describe("provider order", () => {
  it("Cerebras first, then DashScope, then OpenRouter free models only", () => {
    const t = textModels();
    expect(t[0]!.provider).toBe("cerebras");
    expect(t[0]!.model).toBe("qwen-3.8-27b");
    expect(t.find((m) => m.provider !== "cerebras")!.provider).toBe("dashscope");
    const or = t.filter((m) => m.provider === "openrouter");
    expect(or.length).toBeGreaterThan(1);
    expect(or.every((m) => m.model.endsWith(":free"))).toBe(true);
    process.env.OPENROUTER_MODELS = "qwen/qwen3.8-flash,nvidia/nemotron-3-super-120b-a12b:free";
    expect(textModels().filter((m) => m.provider === "openrouter").map((m) => m.model)).toEqual(["nvidia/nemotron-3-super-120b-a12b:free"]);
  });

  it("offers vision readers from at least two model families", () => {
    const fams = new Set(visionModels().map((m) => m.family));
    expect(fams.size).toBeGreaterThanOrEqual(2);
  });

  it("falls through DashScope (access denied) to an OpenRouter free model, then skips the tripped model", async () => {
    const calls = mockFetch((c) =>
      c.url.includes("dashscope") ? { status: 403, json: { code: "AccessDenied.Unpurchased", message: "Access to model denied." } } : ok('{"answer":"hi"}'),
    );
    const r = await structured({ schema: Out, jsonSchema: SCHEMA, schemaName: "a", messages: msgs });
    expect(r?.provider).toBe("openrouter");
    expect(r?.model.endsWith(":free")).toBe(true);
    expect(r?.value.answer).toBe("hi");
    const dsCalls = calls.filter((c) => c.url.includes("dashscope"));
    expect(dsCalls.length).toBe(2); // both DashScope models tried once
    expect(dsCalls[0]!.url).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(dsCalls[0]!.body.enable_thinking).toBe(false);
    expect((dsCalls[0]!.body.response_format as { type: string }).type).toBe("json_object");
    expect(dsCalls[0]!.auth).toBe(`Bearer ${FAKE_DS}`);
    const orCall = calls.find((c) => c.url.includes("openrouter"))!;
    expect(orCall.auth).toBe(`Bearer ${FAKE_OR}`);
    expect((orCall.body.provider as { require_parameters: boolean }).require_parameters).toBe(true);

    calls.length = 0;
    await structured({ schema: Out, jsonSchema: SCHEMA, schemaName: "a", messages: msgs });
    expect(calls.some((c) => c.url.includes("dashscope"))).toBe(false);

    const st = JSON.stringify(providerStatus());
    expect(st).not.toContain(FAKE_DS);
    expect(st).not.toContain(FAKE_OR);
    expect(st).not.toContain(dir);
    const ds = providerStatus().providers.find((p) => p.name === "dashscope")!;
    expect(ds.configured).toBe(true);
    expect(ds.status).toBe("cooling down");
    expect(providerStatus().provider).toBe("openrouter");
  });

  it("uses DashScope when it answers, and names the model", async () => {
    mockFetch((c) => (c.url.includes("dashscope") ? ok('Here: {"answer":"qwen says hi"}') : { status: 500, json: {} }));
    const r = await structured({ schema: Out, jsonSchema: SCHEMA, schemaName: "a", messages: msgs });
    expect(r).toMatchObject({ provider: "dashscope", model: "qwen3.8-flash", family: "qwen", value: { answer: "qwen says hi" } });
  });

  it("a second reader can exclude the first reader's family", async () => {
    const calls = mockFetch(() => ok('{"answer":"x"}'));
    const r = await structured({ schema: Out, jsonSchema: SCHEMA, schemaName: "a", messages: msgs, models: visionModels(), excludeFamilies: ["qwen"] });
    expect(r?.family).not.toBe("qwen");
    expect(calls.every((c) => !c.url.includes("dashscope"))).toBe(true);
  });

  it("returns null when every provider fails, and intent understanding falls back to the rule parser", async () => {
    mockFetch(() => ({ status: 429, json: { error: { code: 429, message: "rate limited" } } }));
    expect(await structured({ schema: Out, jsonSchema: SCHEMA, schemaName: "a", messages: msgs })).toBeNull();
    const u = await understand("Pay Kowloon Food Mart 1,200 HKD for groceries", [{ id: "kowloon_food_mart", label: "Kowloon Food Mart", category: "food" }], "tHKD");
    expect(u.via).toBe("rules");
    expect(u.provider).toBe("local");
    expect(u.intent).toMatchObject({ kind: "pay", payee: "kowloon_food_mart", amount: { value: "1200", unit: "tHKD" } });
  });

  it("without keys nothing is called", async () => {
    process.env.DASHSCOPE_KEY_FILE = join(dir, "missing.txt");
    process.env.OPENROUTER_KEY_FILE = join(dir, "missing.txt");
    _resetProviderState();
    const calls = mockFetch(() => ok('{"answer":"x"}'));
    expect(await structured({ schema: Out, jsonSchema: SCHEMA, schemaName: "a", messages: msgs })).toBeNull();
    expect(calls.filter((c) => !c.url.includes("/v1/chat/completions") || c.url.includes("openrouter") || c.url.includes("dashscope")).length).toBe(0);
    expect(providerStatus()).toMatchObject({ provider: "local", model: "deterministic rule parser", dashscope: false, openrouter: false });
  });
});

describe("rule parser payee matching", () => {
  const payees = [
    { id: "kowloon_forwarders", label: "Kowloon Forwarders", category: "supplier" },
    { id: "test_mmf", label: "Test Money Market Fund", category: "treasury" },
    { id: "test_growth", label: "Test Growth Fund", category: "treasury" },
    { id: "staff_payroll", label: "Staff payroll account", category: "payroll" },
  ];
  it("prefers the full label and never guesses between payees sharing a first word", () => {
    expect(ruleParse("Sweep 10,000 HKD into the Test Growth Fund", payees, "tHKD").payee).toBe("test_growth");
    expect(ruleParse("Sweep 10,000 HKD into the Test Money Market Fund", payees, "tHKD").payee).toBe("test_mmf");
    expect(ruleParse("Pay Kowloon 1,000 HKD", payees, "tHKD").payee).toBe("kowloon_forwarders");
    const payroll = ruleParse("Pay the Staff payroll account 80000 CNY for payroll", payees, "CNY");
    expect(payroll).toMatchObject({ kind: "pay", payee: "staff_payroll", category: "payroll", amount: { value: "80000", unit: "CNY" } });
  });
  it("reads everyday purchase words as a payment, but not a deferred order", () => {
    const cafe = [{ id: "arena_cafe", label: "Arena Cafe", category: "food" }];
    expect(ruleParse("Buy a coffee at Arena Cafe for 5 HKD", cafe, "tHKD")).toMatchObject({ kind: "pay", payee: "arena_cafe", amount: { value: "5", unit: "tHKD" } });
    expect(ruleParse("Order a coffee from Arena Cafe, 5 HKD", cafe, "tHKD").kind).toBe("pay");
    expect(ruleParse("Tip Arena Cafe 2 HKD", cafe, "tHKD").kind).toBe("pay");
    expect(ruleParse("Should we defer the optional order?", payees, "CNY").kind).toBe("unknown");
  });
});

describe("deterministic fill of an amount the model left empty", () => {
  const payees = [{ id: "kowloon_forwarders", label: "Kowloon Forwarders", category: "supplier" }];
  const base = { kind: "pay" as const, payee: "kowloon_forwarders", amount: null, category: null, when: { date: null, recurrence: "none" as const }, conditions: [], ambiguities: ["missing_amount" as const], language: "en" as const };
  it("fills exactly one stated amount from the user's words, and nothing otherwise", () => {
    const one = fillFromWords(base, "Pay Kowloon Forwarders 12,000 HKD for the freight invoice", payees, "tHKD");
    expect(one.fields).toEqual(["amount"]);
    expect(one.intent).toMatchObject({ amount: { value: "12000", unit: "tHKD" }, ambiguities: [] });
    expect(fillFromWords(base, "Pay Kowloon Forwarders 9,000 HKD for lot 3", payees, "tHKD").fields).toEqual([]);
    expect(fillFromWords(base, "Pay Kowloon Forwarders for the invoice", payees, "tHKD").fields).toEqual([]);
    expect(fillFromWords({ ...base, payee: "someone_else" }, "Pay Kowloon Forwarders 12,000 HKD", payees, "tHKD").fields).toEqual([]);
  });
});
