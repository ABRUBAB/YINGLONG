import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { repoRoot } from "@yinglong/sdk/server";

/**
 * Structured-output LLM access with a fixed fallback chain. The model can only ever return JSON matching a
 * closed schema; invalid output is retried at most twice per model, then the next model is tried, and finally
 * the caller falls back to deterministic code (the receipt records which path and which model produced it).
 *   1. Alibaba Cloud Model Studio (DashScope, Qwen models) through its OpenAI-compatible endpoint
 *   2. OpenRouter, free models only (ids ending in ":free") unless OPENROUTER_ALLOW_PAID=1
 *   3. a local llama-server (our fine-tuned intent model, GGUF) if LLAMA_URL is set (text only)
 *   4. null -> deterministic fallback in the caller (the rule parser, template text)
 * Keys are read at runtime from files outside the repository and are never logged or returned.
 */
export type ProviderName = "cerebras" | "dashscope" | "openrouter" | "llama-server";

export interface ModelRef {
  provider: "cerebras" | "dashscope" | "openrouter";
  model: string;
  /** Model family, used to pick a second reader from a different family. */
  family: string;
  /** "schema": strict json_schema response format; "object": json_object mode with the schema in the prompt. */
  json: "schema" | "object";
  /** Do not send `seed` (some free endpoints do not accept it, and require_parameters would filter them out). */
  noSeed?: boolean;
}

export interface LlmResult<T> {
  value: T;
  provider: ProviderName;
  model: string;
  family: string;
  latencyMs: number;
}

export type LlmContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: LlmContent;
}

// ---------------------------------------------------------------- keys (read at runtime, never logged)

function openRouterKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  // An explicit key file wins; the development default is the key file next to the repository.
  const candidates = process.env.OPENROUTER_KEY_FILE ? [process.env.OPENROUTER_KEY_FILE] : [resolve(repoRoot(), "..", "AI_LLM_API_KEY.txt")];
  for (const p of candidates) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/sk-or-[A-Za-z0-9-]+/);
      if (m) return m[0];
    }
  }
  return undefined;
}

/** Cerebras Inference key: CEREBRAS_API_KEY, CEREBRAS_KEY_FILE (bare key, or any text holding one csk- key), or in
 * development the key file next to the repository. Read at runtime, never logged. */
let cbCache: { key?: string; at: number } | undefined;
function cerebrasKey(): string | undefined {
  if (process.env.CEREBRAS_DISABLED === "1") return undefined;
  if (process.env.CEREBRAS_API_KEY) return process.env.CEREBRAS_API_KEY;
  if (cbCache && Date.now() - cbCache.at < 300_000) return cbCache.key;
  const candidates = process.env.CEREBRAS_KEY_FILE ? [process.env.CEREBRAS_KEY_FILE] : [resolve(repoRoot(), "..", "AI_LLM_API_KEY.txt")];
  let key: string | undefined;
  for (const p of candidates) {
    try {
      if (existsSync(p)) key = readFileSync(p, "utf8").match(/csk-[A-Za-z0-9]+/)?.[0];
    } catch {
      key = undefined;
    }
    if (key) break;
  }
  cbCache = { key, at: Date.now() };
  return key;
}

export function cerebrasBaseUrl(): string {
  return (process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1").replace(/\/$/, "");
}

/**
 * Parse a DashScope key file: the bare key (the VPS secret file holds only the key value) or the Model Studio
 * key export (CSV with one "field,value" row per field, or a header row naming an apiKey column).
 */
export function parseDashscopeKeyFile(text: string): string | undefined {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const cells = (l: string) => l.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
  for (const l of lines) {
    const c = cells(l);
    if (c[0] === "apiKey" && c[1] && /^sk-[A-Za-z0-9._-]{8,}$/.test(c[1])) return c[1];
  }
  if (lines.length >= 2) {
    const head = cells(lines[0]!);
    const i = head.indexOf("apiKey");
    const v = i >= 0 ? cells(lines[1]!)[i] : undefined;
    if (v && /^sk-[A-Za-z0-9._-]{8,}$/.test(v)) return v;
  }
  const first = lines[0];
  return first && /^sk-[A-Za-z0-9._-]{8,}$/.test(first) ? first : undefined;
}

/** DASHSCOPE_KEY_FILE, or in development the Model Studio key export next to the repository (by pattern). */
export function dashscopeKeyPath(): string | undefined {
  const explicit = process.env.DASHSCOPE_KEY_FILE;
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  if (process.env.NODE_ENV === "production" || process.env.DASHSCOPE_DISABLED === "1") return undefined;
  const dir = resolve(repoRoot(), "..");
  try {
    const f = readdirSync(dir).find((n) => /apiKey-\d+\.csv$/.test(n));
    return f ? resolve(dir, f) : undefined;
  } catch {
    return undefined;
  }
}

let dsCache: { path?: string; key?: string; at: number } | undefined;
function dashscopeKey(): string | undefined {
  if (process.env.DASHSCOPE_DISABLED === "1") return undefined;
  if (dsCache && Date.now() - dsCache.at < 300_000) return dsCache.key;
  const path = dashscopeKeyPath();
  let key: string | undefined;
  try {
    key = path ? parseDashscopeKeyFile(readFileSync(path, "utf8")) : undefined;
  } catch {
    key = undefined;
  }
  dsCache = { path, key, at: Date.now() };
  return key;
}

/** International (Singapore) endpoint by default; the key export of this project authenticates there. */
export function dashscopeBaseUrl(): string {
  return (process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
}

// ---------------------------------------------------------------- model lists

function familyOf(provider: ModelRef["provider"], model: string): string {
  const id = model.toLowerCase();
  if (provider === "openrouter" && id.includes("/")) return id.split("/")[0]!;
  if (id.startsWith("qwen") || id.startsWith("qwq")) return "qwen";
  if (id.startsWith("deepseek")) return "deepseek";
  if (id.startsWith("glm") || id.startsWith("zhipu")) return "z-ai";
  if (id.startsWith("kimi")) return "moonshotai";
  return id.split(/[-/]/)[0]!;
}

/** "model[@schema|@object][@noseed]" comma list -> refs. */
function parseList(provider: ModelRef["provider"], list: string, defaultJson: ModelRef["json"]): ModelRef[] {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [model, ...flags] = s.split("@");
      const json: ModelRef["json"] = flags.includes("object") ? "object" : flags.includes("schema") ? "schema" : defaultJson;
      return { provider, model: model!, family: familyOf(provider, model!), json, ...(flags.includes("noseed") ? { noSeed: true } : {}) };
    });
}

const freeOnly = (refs: ModelRef[]) => (process.env.OPENROUTER_ALLOW_PAID === "1" ? refs : refs.filter((r) => r.model.endsWith(":free")));

/**
 * Text models in fallback order. DashScope: Qwen flash first (fast JSON), Qwen plus second; json_object mode
 * with the schema in the prompt. OpenRouter: free models checked against the live list (16 Oct 2026); the
 * NVIDIA and dots models support strict structured outputs, the Gemma models only json_object; dots does not
 * accept a seed.
 */
export function textModels(): ModelRef[] {
  // Cerebras first: Qwen 3.8 27B at about 1,850 tokens/s with strict structured outputs.
  const cb = parseList("cerebras", process.env.CEREBRAS_MODELS ?? "qwen-3.8-27b", "schema");
  const ds = parseList("dashscope", process.env.DASHSCOPE_MODELS ?? "qwen3.8-flash,qwen-plus", "object");
  const or = freeOnly(
    parseList(
      "openrouter",
      process.env.OPENROUTER_MODELS ??
        "nvidia/nemotron-3.5-super-vl:free,nvidia/nemotron-3-super-120b-a12b:free,dots-studio/dots-3-note-preview:free@noseed,google/gemma-4-31b-it:free@object,google/gemma-4-26b-a4b-it:free@object",
      "schema",
    ),
  );
  return [...cb, ...ds, ...or];
}

/** Vision-capable models for quarantined image readers; the second reader is taken from a different family. */
export function visionModels(): ModelRef[] {
  const cb = parseList("cerebras", process.env.CEREBRAS_VISION_MODELS ?? "qwen-3.8-27b", "schema");
  const ds = parseList("dashscope", process.env.DASHSCOPE_VISION_MODELS ?? "qwen3-vl-plus", "object");
  const or = freeOnly(
    parseList(
      "openrouter",
      process.env.OPENROUTER_VISION_MODELS ??
        "nvidia/nemotron-3.5-super-vl:free,dots-studio/dots-3-note-preview:free@noseed,google/gemma-4-31b-it:free@object,google/gemma-4-26b-a4b-it:free@object",
      "schema",
    ),
  );
  return [...cb, ...ds, ...or];
}

/** Back-compatible name: the text model chain. */
export const modelChain = textModels;

// ---------------------------------------------------------------- circuit breaker and last errors

const tripped = new Map<string, number>(); // provider:model -> until (ms)
const lastErrors = new Map<string, { status: number | string; code?: string; at: string }>();
const keyOf = (r: ModelRef) => `${r.provider}:${r.model}`;

function configured(p: ModelRef["provider"]): boolean {
  return p === "cerebras" ? !!cerebrasKey() : p === "dashscope" ? !!dashscopeKey() : !!openRouterKey();
}

class CallError extends Error {
  constructor(
    readonly status: number | string,
    readonly code: string | undefined,
    msg: string,
  ) {
    super(msg);
  }
}

function tripFor(status: number | string, message: string): number {
  if (status === 401 || status === 403 || status === 402 || status === 404) return 30 * 60_000;
  if (status === 429) return /per[- ]day|daily/i.test(message) ? 60 * 60_000 : 60_000;
  if (typeof status === "number" && status >= 500) return 30_000;
  return 0;
}

function withSchemaInstruction(messages: LlmMessage[], jsonSchema: object): LlmMessage[] {
  const note = `\nRespond with one JSON object only (no prose, no code fences) that matches this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`;
  const i = messages.findIndex((m) => m.role === "system" && typeof m.content === "string");
  if (i < 0) return [{ role: "system", content: note.trim() }, ...messages];
  return messages.map((m, j) => (j === i ? { ...m, content: `${m.content as string}${note}` } : m));
}

async function chatCall(ref: ModelRef, messages: LlmMessage[], schemaName: string, jsonSchema: object, timeoutMs: number): Promise<string> {
  const key = ref.provider === "cerebras" ? cerebrasKey() : ref.provider === "dashscope" ? dashscopeKey() : openRouterKey();
  if (!key) throw new CallError("no-key", undefined, `no ${ref.provider} key`);
  const url =
    ref.provider === "cerebras"
      ? `${cerebrasBaseUrl()}/chat/completions`
      : ref.provider === "dashscope"
        ? `${dashscopeBaseUrl()}/chat/completions`
        : "https://openrouter.ai/api/v1/chat/completions";
  const body: Record<string, unknown> = {
    model: ref.model,
    messages: ref.json === "object" ? withSchemaInstruction(messages, jsonSchema) : messages,
    temperature: 0,
    ...(ref.noSeed ? {} : { seed: 7 }),
    response_format: ref.json === "schema" ? { type: "json_schema", json_schema: { name: schemaName, strict: true, schema: jsonSchema } } : { type: "json_object" },
  };
  // Extraction and short paragraphs: no thinking phase (faster, and reasoning models otherwise sometimes spend the
  // whole budget thinking and return empty content).
  if (ref.provider === "cerebras") body.reasoning_effort = "none";
  else if (ref.provider === "dashscope") body.enable_thinking = false;
  else {
    body.provider = { require_parameters: true };
    body.reasoning = { enabled: false };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(ref.provider === "openrouter" ? { "X-Title": "YINGLONG" } : {}) },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string; code?: number | string; type?: string };
      code?: string;
      message?: string;
    };
    const content = j.choices?.[0]?.message?.content;
    if (!r.ok || !content) {
      const status = typeof j.error?.code === "number" ? j.error.code : r.status;
      const code = typeof j.error?.code === "string" ? j.error.code : (j.error?.type ?? j.code);
      throw new CallError(r.ok ? "empty" : status, code, `${ref.provider} ${ref.model}: ${status} ${j.error?.message ?? j.message ?? ""}`);
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function llamaCall(messages: LlmMessage[], jsonSchema: object, timeoutMs: number): Promise<{ text: string; model: string }> {
  const url = process.env.LLAMA_URL;
  if (!url) throw new Error("no LLAMA_URL");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, temperature: 0, json_schema: jsonSchema }),
    });
    const j = (await r.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content;
    if (!text) throw new Error("llama-server returned no content");
    return { text, model: process.env.LLAMA_MODEL_NAME ?? j.model ?? "local-gguf" };
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(t);
  } catch {
    // Some json_object models wrap the object in a sentence: take the outermost braces.
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("not JSON");
  }
}

export async function structured<T>(args: {
  schema: z.ZodType<T>;
  jsonSchema: object;
  schemaName: string;
  messages: LlmMessage[];
  timeoutMs?: number;
  /** Override the model list (e.g. vision models for image readers). */
  models?: ModelRef[];
  /** Skip these model ids. */
  exclude?: string[];
  /** Skip these families (used to force a second reader from a different family). */
  excludeFamilies?: string[];
}): Promise<LlmResult<T> | null> {
  if (process.env.LLM_DISABLED === "1") return null;
  const timeoutMs = args.timeoutMs ?? 20_000;
  const hasImage = args.messages.some((m) => Array.isArray(m.content));
  const chain = (args.models ?? textModels()).filter(
    (r) => configured(r.provider) && !(args.exclude ?? []).includes(r.model) && !(args.excludeFamilies ?? []).includes(r.family),
  );
  for (const ref of chain) {
    if ((tripped.get(keyOf(ref)) ?? 0) > Date.now()) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const text = await chatCall(ref, args.messages, args.schemaName, args.jsonSchema, timeoutMs);
        const parsed = args.schema.safeParse(parseJson(text));
        if (parsed.success) return { value: parsed.data, provider: ref.provider, model: ref.model, family: ref.family, latencyMs: Date.now() - t0 };
      } catch (e) {
        if (e instanceof CallError) {
          lastErrors.set(keyOf(ref), { status: e.status, code: e.code, at: new Date().toISOString() });
          const ms = tripFor(e.status, e.message);
          if (ms) tripped.set(keyOf(ref), Date.now() + ms);
          break;
        }
        // Parse failure or timeout: one retry on the same model, then the next model.
        if ((e as Error).name === "AbortError") break;
      }
    }
  }
  if (hasImage) return null;
  try {
    const t0 = Date.now();
    const { text, model } = await llamaCall(args.messages, args.jsonSchema, timeoutMs * 2);
    const parsed = args.schema.safeParse(parseJson(text));
    if (parsed.success) return { value: parsed.data, provider: "llama-server", model, family: "local", latencyMs: Date.now() - t0 };
  } catch {
    /* fall through to deterministic code */
  }
  return null;
}

/** For tests: forget circuit-breaker state and cached keys. */
export function _resetProviderState(): void {
  tripped.clear();
  lastErrors.clear();
  dsCache = undefined;
  cbCache = undefined;
}

/** For /v1/health: which providers are configured and usable, in fallback order (never keys or key paths). */
export function providerStatus() {
  const now = Date.now();
  const describe = (refs: ModelRef[]) =>
    refs.map((r) => {
      const until = tripped.get(keyOf(r)) ?? 0;
      const err = lastErrors.get(keyOf(r));
      return { model: r.model, family: r.family, json: r.json, cooling: until > now ? new Date(until).toISOString() : undefined, lastError: err ? { status: err.status, code: err.code, at: err.at } : undefined };
    });
  const text = textModels();
  const vision = visionModels();
  const cb = { text: text.filter((r) => r.provider === "cerebras"), vision: vision.filter((r) => r.provider === "cerebras") };
  const ds = { text: text.filter((r) => r.provider === "dashscope"), vision: vision.filter((r) => r.provider === "dashscope") };
  const or = { text: text.filter((r) => r.provider === "openrouter"), vision: vision.filter((r) => r.provider === "openrouter") };
  const cbOn = configured("cerebras");
  const dsOn = configured("dashscope");
  const orOn = configured("openrouter");
  const usable = text.find((r) => configured(r.provider) && (tripped.get(keyOf(r)) ?? 0) <= now);
  const status = (on: boolean, refs: ModelRef[]) => (!on ? "not configured" : refs.some((r) => (tripped.get(keyOf(r)) ?? 0) <= now) ? "ready" : "cooling down");
  return {
    order: ["cerebras", "dashscope", "openrouter", ...(process.env.LLAMA_URL ? ["llama-server"] : []), "rules"],
    providers: [
      {
        name: "cerebras",
        label: "Cerebras Inference (Qwen 3.8 27B), OpenAI-compatible endpoint",
        configured: cbOn,
        endpoint: new URL(cerebrasBaseUrl()).host,
        status: status(cbOn, cb.text),
        models: describe(cb.text),
        vision: describe(cb.vision),
      },
      {
        name: "dashscope",
        label: "Alibaba Cloud Model Studio (DashScope, Qwen), OpenAI-compatible endpoint",
        configured: dsOn,
        endpoint: new URL(dashscopeBaseUrl()).host,
        status: status(dsOn, ds.text),
        models: describe(ds.text),
        vision: describe(ds.vision),
      },
      {
        name: "openrouter",
        label: process.env.OPENROUTER_ALLOW_PAID === "1" ? "OpenRouter" : "OpenRouter (free models only)",
        configured: orOn,
        endpoint: "openrouter.ai",
        status: status(orOn, or.text),
        models: describe(or.text),
        vision: describe(or.vision),
      },
      { name: "llama-server", label: "local llama-server (GGUF)", configured: !!process.env.LLAMA_URL, status: process.env.LLAMA_URL ? "configured" : "not configured" },
      { name: "rules", label: "deterministic rule parser and template text", configured: true, status: "ready" },
    ],
    // Back-compatible summary fields (the web health line shows provider + model).
    cerebras: cbOn,
    dashscope: dsOn,
    openrouter: orOn,
    llama: !!process.env.LLAMA_URL,
    provider: usable?.provider ?? (process.env.LLAMA_URL ? "llama-server" : "local"),
    model: usable?.model ?? (process.env.LLAMA_URL ? (process.env.LLAMA_MODEL_NAME ?? "local-gguf") : "deterministic rule parser"),
    models: text.filter((r) => configured(r.provider)).map((r) => `${r.provider}:${r.model}`),
  };
}
