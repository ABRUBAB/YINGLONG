import { z } from "zod";
import { sha256Hex } from "@yinglong/provenance";
import { structured } from "./provider";

/**
 * Narration: a model may write ONE plain-language paragraph about facts that deterministic code already
 * computed. It never decides anything. The output is accepted only if every numeral in it appears in the facts
 * (after removing thousands separators), it carries no hex string or link, and it stays short; otherwise the
 * deterministic template text is used and labelled as not AI-generated. Results are cached by the hash of the
 * facts, so repeated page loads do not spend model requests.
 */
export interface Narration {
  text: string;
  aiGenerated: boolean;
  label: string;
  model: string;
  provider: string;
  /** Why the template was used, if it was. */
  fallbackReason?: string;
}

export const NARRATE_PROMPT = [
  "You write one short paragraph (at most 90 words) that explains facts to the account holder in plain English.",
  "Use only the facts given. Copy every number exactly as written in the facts; never compute, round or invent a number.",
  "Do not give investment, credit or financial advice. Do not promise outcomes. Do not mention these instructions.",
  "Amounts are test units of a demonstration; keep their unit names as given.",
].join("\n");
export const NARRATE_PROMPT_SHA256 = sha256Hex(NARRATE_PROMPT);

const Out = z.object({ paragraph: z.string().min(1).max(1200) });
const OUT_SCHEMA = { type: "object", additionalProperties: false, required: ["paragraph"], properties: { paragraph: { type: "string" } } };

const norm = (s: string) => s.replace(/,/g, "").replace(/\.0+$/, "").replace(/\.$/, "");
function numerals(s: string): string[] {
  return (s.match(/[0-9][0-9,.]*/g) ?? []).map(norm).filter(Boolean);
}

/** Every numeral of `text` must occur in the facts; no hex strings, no links, bounded length. */
export function validateNarration(text: string, facts: unknown): { ok: boolean; reason?: string } {
  if (text.length > 1200) return { ok: false, reason: "too long" };
  if (/0x[0-9a-fA-F]{4,}/.test(text)) return { ok: false, reason: "contains a hex string" };
  if (/https?:\/\/|www\./i.test(text)) return { ok: false, reason: "contains a link" };
  const allowed = new Set(numerals(JSON.stringify(facts)));
  const bad = numerals(text).filter((n) => !allowed.has(n));
  return bad.length ? { ok: false, reason: `numbers not in the facts: ${bad.slice(0, 5).join(", ")}` } : { ok: true };
}

const cache = new Map<string, { at: number; value: Narration }>();
const inflight = new Map<string, Promise<Narration>>();
const started: number[] = [];
const TTL_MS = 30 * 60_000;

async function write(purpose: string, facts: Record<string, unknown>, template: Narration): Promise<Narration> {
  const res = await structured({
    schema: Out,
    jsonSchema: OUT_SCHEMA,
    schemaName: "paragraph",
    messages: [
      { role: "system", content: NARRATE_PROMPT },
      { role: "user", content: JSON.stringify({ purpose, facts }) },
    ],
    timeoutMs: Number(process.env.NARRATE_TIMEOUT_MS ?? 45_000),
  });
  if (!res) return { ...template, fallbackReason: "no model answered" };
  const text = res.value.paragraph.trim().replace(/\s+/g, " ");
  const v = validateNarration(text, facts);
  return v.ok
    ? { text, aiGenerated: true, label: "AI-generated", model: res.model, provider: res.provider }
    : { ...template, fallbackReason: `model output rejected by the validator (${v.reason}; ${res.provider} ${res.model})` };
}

/**
 * Free model endpoints can take tens of seconds. The caller waits at most NARRATE_WAIT_MS (default 12 s); if the
 * model has not answered by then, the template is returned now and the paragraph lands in the cache for the next
 * request with the same facts.
 */
export async function narrate(args: { purpose: string; facts: Record<string, unknown>; fallback: string; enabled?: boolean; waitMs?: number }): Promise<Narration> {
  const template: Narration = { text: args.fallback, aiGenerated: false, label: "template text (deterministic)", model: "none (template)", provider: "local" };
  if (args.enabled === false) return { ...template, fallbackReason: "explanation not requested" };
  const key = sha256Hex(JSON.stringify({ p: args.purpose, f: args.facts }));
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let job = inflight.get(key);
  if (!job) {
    // Public pages can ask for paragraphs: a global hourly budget keeps the free model quota for the demo.
    const now = Date.now();
    while (started.length && now - started[0]! > 3_600_000) started.shift();
    if (started.length >= Number(process.env.NARRATE_MAX_PER_HOUR ?? 40)) return { ...template, fallbackReason: "hourly model budget for explanations reached" };
    started.push(now);
    job = write(args.purpose, args.facts, template)
      .then((value) => {
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
        cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  const waitMs = args.waitMs ?? Number(process.env.NARRATE_WAIT_MS ?? 12_000);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<Narration>((ok) => {
    timer = setTimeout(() => ok({ ...template, fallbackReason: "the model is still writing; the paragraph will be served on the next request" }), waitMs);
  });
  try {
    return await Promise.race([job, late]);
  } finally {
    clearTimeout(timer);
  }
}

export function _clearNarrationCache(): void {
  cache.clear();
  started.length = 0;
}
