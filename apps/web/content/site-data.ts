/**
 * Typed access to content/generated/site-data.json, written by scripts/site-data.mjs from git, the
 * deployment files, the evidence bundle, docs/ENFORCERS.md and docs/CLAIMS.md. Never edit the JSON.
 */
import raw from "./generated/site-data.json";

export interface TimelineCommit {
  hash: string;
  at: string;
  subject: string;
  track: "web" | "contracts" | "ledgers" | "evidence" | "infra" | "agent";
  milestone: boolean;
}

export interface TwinRow {
  name: string;
  base: { address: string; codeHash: string } | null;
  fisco: { address: string; codeHash: string } | null;
}

export interface BaseStep {
  index: number;
  step: string;
  tx: string | null;
  ok: boolean | null;
  revert: string | null;
  msToConfirmed: number | null;
  block: string | null;
}

export interface StackLayer {
  layer: string;
  items: { name: string; version: string | null; note: string }[];
}

export interface SiteData {
  generatedAt: string;
  timeline: { head: string; count: number; first: string; last: string; commits: TimelineCommit[] } | null;
  twin: { enforcers: TwinRow[]; allContracts: { compared: number; equal: number; differ: string[] } } | null;
  baseScenario: BaseStep[] | null;
  metrics: { generatedAt: string | null; values: Record<string, string> } | null;
  novelty: { id: string; decision: string; text: string; reason: string | null } | null;
  stack: StackLayer[] | null;
  enforcerDocs: {
    enforcers: Record<string, { position: number | null; rule: string; detail: string | null }>;
    errors: Record<string, string>;
  } | null;
  scales: { n: number; name: string; what: string; refuses: string }[] | null;
  sources: Record<string, string>;
}

export const SITE: SiteData = raw as unknown as SiteData;

/** The enforcer that raises a typed error, and its rule in plain words (docs/ENFORCERS.md). */
export function ruleForError(error: string | null | undefined): { enforcer: string; rule: string | null } | null {
  if (!error) return null;
  const name = error.replace(/\(.*$/, "");
  const enforcer = SITE.enforcerDocs?.errors[name];
  if (!enforcer) return null;
  return { enforcer, rule: SITE.enforcerDocs?.enforcers[enforcer]?.rule ?? null };
}

/** A generated metric as an integer, or null when it is not a plain count. */
export function metricCount(key: string): number | null {
  const v = SITE.metrics?.values[key];
  return v && /^\d+$/.test(v) ? Number(v) : null;
}
