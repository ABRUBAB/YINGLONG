/**
 * Scale 1: normalise. Removes invisible and bidirectional control characters, applies NFKC, flags mixed-script
 * tokens (homoglyph attacks such as Cyrillic letters inside a Latin name) and scrubs personal data before any
 * text leaves the machine (free API models may log prompts, KR-14).
 * All special characters are built from code points so this file stays plain ASCII.
 */
const cp = (n: number) => String.fromCodePoint(n);
const range = (a: number, b: number) => `${cp(a)}-${cp(b)}`;

// zero-width and invisible characters, bidi embeddings/overrides/isolates, BOM
const INVISIBLE = new RegExp(
  `[${range(0x200b, 0x200f)}${range(0x2060, 0x2064)}${cp(0xfeff)}${cp(0x00ad)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}]`,
  "gu",
);
const CYRILLIC = new RegExp(`[${range(0x0400, 0x04ff)}]`, "u");
const GREEK = new RegExp(`[${range(0x0370, 0x03ff)}]`, "u");

export interface NormaliseResult {
  text: string;
  flags: string[];
  scrubbed: { kind: string; count: number }[];
}

const PII: { kind: string; re: RegExp; replace: string }[] = [
  { kind: "private-key", re: /\b0x[0-9a-fA-F]{64}\b/g, replace: "[REDACTED_PRIVATE_KEY]" },
  { kind: "mainland-id", re: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, replace: "[REDACTED_ID]" },
  { kind: "unionpay-card", re: /\b62\d{14,17}\b/g, replace: "[REDACTED_CARD]" },
  { kind: "card", re: /\b(?:\d[ -]?){15,18}\d\b/g, replace: "[REDACTED_CARD]" },
  { kind: "mainland-mobile", re: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, replace: "[REDACTED_PHONE]" },
  { kind: "seed-phrase", re: /\b(?:seed|mnemonic|recovery)\s*(?:phrase|words)?\s*[:=]?\s*(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi, replace: "[REDACTED_SEED]" },
];

export function normalise(input: string): NormaliseResult {
  const flags: string[] = [];
  let text = input.normalize("NFKC");
  const invisible = text.match(INVISIBLE);
  if (invisible) {
    flags.push(`removed ${invisible.length} invisible or bidi control character(s)`);
    text = text.replace(INVISIBLE, "");
  }
  for (const token of text.split(/\s+/)) {
    if (/[A-Za-z]/.test(token) && (CYRILLIC.test(token) || GREEK.test(token))) {
      flags.push(`mixed-script token (possible homoglyph): ${token.length} chars`);
    }
  }
  const scrubbed: { kind: string; count: number }[] = [];
  for (const p of PII) {
    const m = text.match(p.re);
    if (m) {
      scrubbed.push({ kind: p.kind, count: m.length });
      text = text.replace(p.re, p.replace);
    }
  }
  return { text, flags, scrubbed };
}
