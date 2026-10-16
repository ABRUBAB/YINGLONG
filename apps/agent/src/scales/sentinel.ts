/**
 * Scale 2: the injection sentinel (M1, a fine-tuned multilingual mmBERT classifier served by ml/serving).
 * It can only ESCALATE (T1 -> T2, or ask): it never refuses money movement on its own (monotonic-safety rule).
 * If the model service is unreachable, a transparent heuristic is used and labelled as such.
 */
export interface SentinelResult {
  score: number; // 0..1, probability of injection
  label: "benign" | "injection";
  model: string;
  matched?: string[];
  /** The service's decision threshold (absent for the rule fallback, which uses 0.5). */
  threshold?: number;
}

const HEURISTICS: [string, RegExp][] = [
  ["override-instructions", /\b(ignore|disregard|forget)\b.{0,40}\b(previous|above|prior|all|your)\b.{0,20}\b(instructions?|rules?|mandate|limits?)\b/i],
  ["role-hijack", /\b(you are now|act as|new instructions|system prompt|developer mode)\b/i],
  ["exfiltrate-funds", /\b(send|transfer|pay|move)\b.{0,30}\b(all|everything|entire|full balance|max(imum)?)\b/i],
  ["change-payee", /\b(changed|new|updated|different)\b.{0,30}\b(bank account|wallet|address|payee details)\b/i],
  ["urgency-authority", /\b(urgent|immediately|right now|director approved|ceo says|do not tell|keep this secret)\b/i],
  ["hidden-marker", /\[(system|admin|assistant)\]|<\s*(system|instructions?)\s*>/i],
  ["address-in-memo", /\b0x[0-9a-fA-F]{40}\b/],
];

export function heuristicSentinel(text: string): SentinelResult {
  const matched = HEURISTICS.filter(([, re]) => re.test(text)).map(([n]) => n);
  const score = Math.min(0.99, matched.length === 0 ? 0.02 : 0.45 + 0.2 * matched.length);
  return { score, label: score >= 0.5 ? "injection" : "benign", model: "heuristic sentinel (fallback, rules)", matched };
}

export async function sentinel(text: string): Promise<SentinelResult> {
  const url = process.env.SENTINEL_URL;
  if (url) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Number(process.env.SENTINEL_TIMEOUT_MS ?? 8_000));
      const r = await fetch(`${url.replace(/\/$/, "")}/sentinel`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      clearTimeout(timer);
      if (r.ok) {
        const j = (await r.json()) as { score: number; label?: string; threshold?: number; model_sha?: string; model?: string };
        const h = heuristicSentinel(text);
        // The service applies the threshold chosen on validation data; use its label when it gives one.
        const label = j.label === "injection" || j.label === "benign" ? j.label : j.score >= (j.threshold ?? 0.5) ? "injection" : "benign";
        return {
          score: j.score,
          label,
          model: j.model ?? `M1 sentinel ${j.model_sha?.slice(0, 12) ?? ""}`.trim(),
          matched: h.matched,
          ...(typeof j.threshold === "number" ? { threshold: j.threshold } : {}),
        };
      }
    } catch {
      /* fall back */
    }
  }
  return heuristicSentinel(text);
}
