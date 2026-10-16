/**
 * Labelled set for the PII scrubber in src/scales/normalise.ts (C-IN-08, C-DP-02, KR-14).
 * Every identifier is synthetic, generated here from a fixed seed: mainland mobile numbers, 18-digit resident ID
 * numbers (with a valid ISO 7064 MOD 11-2 check character), UnionPay card numbers (Luhn-valid, prefix 62),
 * private keys (32 random bytes) and BIP39-style seed phrases. Each kind appears in the formats people actually
 * type (plain, spaced, dashed, with a country code, without a 0x prefix, without a keyword), embedded in a sentence.
 * Negatives are benign strings that must pass through unchanged (amounts, dates, invoice numbers, addresses,
 * transaction hashes, ordinary sentences).
 */

export type Kind = "mainland-mobile" | "mainland-id" | "unionpay-card" | "private-key" | "seed-phrase";

export interface Positive {
  kind: Kind;
  format: string;
  text: string;
  /** The identifying characters that must not survive (letters and digits only, lower case). */
  core: string;
  /** For seed phrases: the words that must not survive. */
  words?: string[];
}

export interface Negative {
  format: string;
  text: string;
}

let seed = 20261016;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const digit = () => String(Math.floor(rnd() * 10));
const digits = (n: number) => Array.from({ length: n }, digit).join("");
const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const compact = (s: string) => s.replace(/^0x/i, "").replace(/[^0-9A-Za-z]/g, "").toLowerCase();

function mobile(): string {
  return `1${pick(["3", "5", "7", "8", "9"])}${digits(9)}`;
}

function residentId(): string {
  const region = `${1 + Math.floor(rnd() * 6)}${digits(5)}`;
  const year = 1950 + Math.floor(rnd() * 55);
  const month = String(1 + Math.floor(rnd() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
  const body = `${region}${year}${month}${day}${digits(3)}`;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = body.split("").reduce((a, c, i) => a + Number(c) * w[i]!, 0);
  return body + "10X98765432"[sum % 11]!;
}

function unionPay(len: number): string {
  const body = `62${digits(len - 3)}`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return body + String((10 - (sum % 10)) % 10);
}

// A subset of the BIP39 English word list (3 to 8 letters each).
const BIP39 = [
  "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse", "access", "accident",
  "account", "accuse", "achieve", "acid", "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
  "adapt", "add", "addict", "address", "adjust", "admit", "adult", "advance", "advice", "aerobic", "affair", "afford",
  "afraid", "again", "age", "agent", "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
] as const;
const phrase = (n: number) => Array.from({ length: n }, () => pick(BIP39));

const group = (s: string, sizes: number[], sep: string) => {
  const out: string[] = [];
  let i = 0;
  for (const n of sizes) {
    out.push(s.slice(i, i + n));
    i += n;
  }
  if (i < s.length) out.push(s.slice(i));
  return out.join(sep);
};

function build(): { positives: Positive[]; negatives: Negative[] } {
  const positives: Positive[] = [];
  const add = (kind: Kind, format: string, id: string, carrier: (x: string) => string, words?: string[]) =>
    positives.push({ kind, format, text: carrier(id), core: compact(words ? words.join("") : id), words });

  for (let i = 0; i < 4; i++) {
    const m = mobile();
    add("mainland-mobile", "plain 11 digits", m, (x) => `Please call me on ${x} after lunch.`);
    add("mainland-mobile", "+86 prefix", `+86 ${m}`, (x) => `My phone is ${x}, thanks.`);
    add("mainland-mobile", "86- prefix", `86-${m}`, (x) => `Contact: ${x}`);
    add("mainland-mobile", "3-4-4 with spaces", group(m, [3, 4, 4], " "), (x) => `Text the landlord at ${x} tonight.`);
    add("mainland-mobile", "3-4-4 with dashes", group(m, [3, 4, 4], "-"), (x) => `Courier number ${x}.`);
  }
  for (let i = 0; i < 4; i++) {
    const id = residentId();
    add("mainland-id", "plain 18 characters", id, (x) => `ID number ${x} for the tenancy form.`);
    add("mainland-id", "6-8-4 with spaces", group(id, [6, 8, 4], " "), (x) => `Resident ID: ${x}`);
    add("mainland-id", "lower-case check character", id.toLowerCase(), (x) => `id ${x}`);
  }
  for (let i = 0; i < 4; i++) {
    const c16 = unionPay(16);
    const c19 = unionPay(19);
    add("unionpay-card", "plain 16 digits", c16, (x) => `Card ${x} expires next year.`);
    add("unionpay-card", "plain 19 digits", c19, (x) => `Use card ${x} for the deposit.`);
    add("unionpay-card", "4-4-4-4 with spaces", group(c16, [4, 4, 4, 4], " "), (x) => `UnionPay ${x}`);
    add("unionpay-card", "4-4-4-4 with dashes", group(c16, [4, 4, 4, 4], "-"), (x) => `card no. ${x}`);
  }
  for (let i = 0; i < 4; i++) {
    const k = hex(64);
    add("private-key", "0x + 64 hex", `0x${k}`, (x) => `Here is my wallet key ${x} please import it.`);
    add("private-key", "64 hex without 0x", k, (x) => `private key: ${x}`);
    add("private-key", "0x + 64 upper-case hex", `0x${k.toUpperCase()}`, (x) => `key=${x}`);
  }
  for (let i = 0; i < 3; i++) {
    const w12 = phrase(12);
    const w24 = phrase(24);
    add("seed-phrase", "'seed phrase:' + 12 words", w12.join(" "), (x) => `My seed phrase: ${x}`, w12);
    add("seed-phrase", "'mnemonic' + 24 words", w24.join(" "), (x) => `mnemonic ${x}`, w24);
    add("seed-phrase", "'recovery words' + 12 words", w12.join(" "), (x) => `recovery words ${x}`, w12);
    add("seed-phrase", "12 words, no keyword", w12.join(" "), (x) => `Can you keep this safe: ${x}`, w12);
    add("seed-phrase", "12 numbered words", w12.map((w, j) => `${j + 1}. ${w}`).join(" "), (x) => `seed: ${x}`, w12);
  }

  const negatives: Negative[] = [
    { format: "amount with decimals", text: "Pay Harbour Homes HKD 9,500.00 for the October rent." },
    { format: "date", text: "The tuition is due on 2026-10-20 at noon." },
    { format: "invoice number", text: "Invoice INV-2026-000123 from Kowloon Food Mart, total 1,200 tHKD." },
    { format: "order number (10 digits)", text: "Order 4401928374 was delivered to the front desk." },
    { format: "EVM address (40 hex)", text: `Send it to 0x${hex(40)} as agreed.` },
    { format: "transaction hash (0x + 64 hex)", text: `The receipt shows transaction 0x${hex(64)} on FISCO BCOS.` },
    { format: "transaction hash (0x + 64 hex)", text: `Explorer link for 0x${hex(64)} please.` },
    { format: "ordinary sentence starting with 'recovery'", text: "recovery plan for the shop means more stock and longer hours this winter and spring season" },
    { format: "ordinary sentence", text: "Buy a coffee at Arena Cafe for 5 HKD and a sandwich for lunch." },
    { format: "landline with area code", text: "The bank branch line is 2345 6789 in Hong Kong." },
  ];
  return { positives, negatives };
}

export const SET = build();

/** True if any 8-character window of the identifier (or 3 of its words) survives in the scrubbed text. */
export function leaks(p: Positive, scrubbed: string): boolean {
  if (p.words) {
    const out = new Set(scrubbed.toLowerCase().split(/[^a-z]+/));
    return p.words.filter((w) => out.has(w)).length >= 3;
  }
  const out = compact(scrubbed.replace(/\[REDACTED_[A-Z_]+\]/g, " "));
  const L = Math.min(8, p.core.length);
  for (let i = 0; i + L <= p.core.length; i++) if (out.includes(p.core.slice(i, i + L))) return true;
  return false;
}
