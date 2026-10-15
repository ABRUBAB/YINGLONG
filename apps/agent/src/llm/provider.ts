import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Structured-output LLM access with a fixed fallback chain. The model can only ever return JSON matching a
 * closed schema; invalid output is retried at most twice, then the caller falls back to deterministic code
 * (and the receipt records which path produced the result).
 *   1. OpenRouter (models with structured-output support)
 *   2. a local llama-server (our fine-tuned intent model, GGUF) if LLAMA_URL is set
 *   3. null -> deterministic fallback in the caller
 */
export interface LlmResult<T> {
  value: T;
  provider: "openrouter" | "llama-server";
  model: string;
  latencyMs: number;
}

export type LlmContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: LlmContent;
}

function openRouterKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const f = process.env.OPENROUTER_KEY_FILE ?? resolve(process.cwd(), "..", "..", "..", "AI_LLM_API_KEY.txt");
  const candidates = [f, "D:/fintechatho_2026_china/AI_LLM_API_KEY.txt", resolve(process.cwd(), "..", "AI_LLM_API_KEY.txt")];
  for (const p of candidates) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/sk-or-[A-Za-z0-9-]+/);
      if (m) return m[0];
    }
  }
  return undefined;
}

/** Ordered model list. Paid flash models first when credit exists; free endpoints as fallback. */
export function modelChain(): string[] {
  const env = process.env.OPENROUTER_MODELS;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return [
    "qwen/qwen3.8-flash",
    "deepseek/deepseek-v4.1-flash",
    "z-ai/glm-5.3-flash",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3.5-super-vl:free",
  ];
}

const failed = new Map<string, number>(); // model -> until timestamp (circuit breaker for 402/429)

async function openRouterCall<T>(model: string, messages: LlmMessage[], schemaName: string, jsonSchema: object, timeoutMs: number) {
  const key = openRouterKey();
  if (!key) throw new Error("no OpenRouter key");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "YINGLONG" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        seed: 7,
        provider: { require_parameters: true },
        response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema: jsonSchema } },
      }),
    });
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string; code?: number } };
    if (!r.ok || !j.choices?.[0]?.message?.content) {
      const code = j.error?.code ?? r.status;
      if (code === 402 || code === 429) failed.set(model, Date.now() + (code === 402 ? 30 * 60_000 : 60_000));
      throw new Error(`${model}: ${code} ${j.error?.message ?? ""}`);
    }
    return j.choices[0].message.content;
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

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(t);
}

export async function structured<T>(args: {
  schema: z.ZodType<T>;
  jsonSchema: object;
  schemaName: string;
  messages: LlmMessage[];
  timeoutMs?: number;
  /** Override the model list (e.g. vision models for image readers). */
  models?: string[];
  /** Skip these models (used to force a second reader from a different family). */
  exclude?: string[];
}): Promise<LlmResult<T> | null> {
  if (process.env.LLM_DISABLED === "1") return null;
  const timeoutMs = args.timeoutMs ?? 20_000;
  const hasImage = args.messages.some((m) => Array.isArray(m.content));
  for (const model of (args.models ?? modelChain()).filter((x) => !(args.exclude ?? []).includes(x))) {
    if ((failed.get(model) ?? 0) > Date.now()) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const text = await openRouterCall(model, args.messages, args.schemaName, args.jsonSchema, timeoutMs);
        const parsed = args.schema.safeParse(parseJson(text));
        if (parsed.success) return { value: parsed.data, provider: "openrouter", model, latencyMs: Date.now() - t0 };
      } catch {
        break;
      }
    }
  }
  if (hasImage) return null;
  try {
    const t0 = Date.now();
    const { text, model } = await llamaCall(args.messages, args.jsonSchema, timeoutMs * 2);
    const parsed = args.schema.safeParse(parseJson(text));
    if (parsed.success) return { value: parsed.data, provider: "llama-server", model, latencyMs: Date.now() - t0 };
  } catch {
    /* fall through to deterministic code */
  }
  return null;
}

/** Vision-capable models for quarantined image readers (two families for the agreement check). */
export function visionModels(): string[] {
  const env = process.env.OPENROUTER_VISION_MODELS;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return ["qwen/qwen3.8-omni-flash", "google/gemini-3.5-flash-lite", "nvidia/nemotron-3.5-super-vl:free"];
}

/** For /v1/health: which providers are configured (never the keys). */
export function providerStatus() {
  return { openrouter: !!openRouterKey(), llama: !!process.env.LLAMA_URL, models: modelChain() };
}

export function _keyFilesPresent(): string[] {
  try {
    return readdirSync("D:/fintechatho_2026_china").filter((f) => /KEY|key/.test(f));
  } catch {
    return [];
  }
}
