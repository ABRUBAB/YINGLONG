/**
 * The visitor session: someone who signed up with their own passkey on /start. It holds the visitor's
 * principal id, the session token the agent service issued (valid only after the passkey sealed the
 * mandate), the passkey's credential id and its public key (public by definition; kept so the same
 * passkey can seal a new mandate after a revoke). No private key is ever held here or anywhere else:
 * the passkey never leaves the device.
 *
 * Storage is localStorage, wrapped in try/catch. Losing it only means signing up again with the same
 * passkey, which returns the same visitor id.
 */
import { CONSOLE_PRINCIPAL } from "./client";

export interface VisitorSession {
  visitorId: string;
  token: string;
  /** How this visitor signs: a passkey on this device, or a secret key kept in this browser (like a wallet). */
  method: "passkey" | "key";
  /** Passkey only: the credential id. Empty for a secret-key visitor. */
  credentialId: string;
  publicKey?: { x: string; y: string };
  /** Secret key only: the key itself (test units only; the visitor was shown it and told to save it) and its address. */
  secretKey?: string;
  owner?: string;
  account?: string;
  sealedAt?: string;
}

const KEY = "yinglong.visitor.v1";
const VISITOR_ID = /^v-[0-9a-f]{6,64}$/;
const listeners = new Set<() => void>();
let cached: { raw: string | null; value: VisitorSession | null } | null = null;
let memory: VisitorSession | null = null;
let hydrated = false;

function parse(raw: string | null): VisitorSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<VisitorSession>;
    if (typeof v.visitorId !== "string" || !VISITOR_ID.test(v.visitorId)) return null;
    if (typeof v.token !== "string" || !v.token) return null;
    const method = v.method === "key" ? "key" : "passkey";
    if (method === "passkey" && (typeof v.credentialId !== "string" || !v.credentialId)) return null;
    if (method === "key" && (typeof v.secretKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v.secretKey))) return null;
    return {
      visitorId: v.visitorId,
      token: v.token,
      method,
      credentialId: typeof v.credentialId === "string" ? v.credentialId : "",
      secretKey: method === "key" ? v.secretKey : undefined,
      owner: typeof v.owner === "string" ? v.owner : undefined,
      publicKey: v.publicKey && typeof v.publicKey.x === "string" && typeof v.publicKey.y === "string" ? { x: v.publicKey.x, y: v.publicKey.y } : undefined,
      account: typeof v.account === "string" ? v.account : undefined,
      sealedAt: typeof v.sealedAt === "string" ? v.sealedAt : undefined,
    };
  } catch {
    return null;
  }
}

/** The stored session, read straight from storage (client only; null on the server). */
export function readVisitorSession(): VisitorSession | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Storage blocked (private window, previews): the session lives in memory for this page only.
    return memory;
  }
  if (raw === null && memory) return memory;
  if (cached && cached.raw === raw) return cached.value;
  cached = { raw, value: parse(raw) };
  return cached.value;
}

export function writeVisitorSession(s: VisitorSession): void {
  memory = null;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    memory = s;
  }
  listeners.forEach((l) => l());
}

export function clearVisitorSession(): void {
  memory = null;
  cached = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
  listeners.forEach((l) => l());
}

export function subscribeVisitorSession(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Set once the page has hydrated (SessionSync). Before that, render-time reads must match the server. */
export function markHydrated(): void {
  hydrated = true;
}

export function isHydrated(): boolean {
  return hydrated;
}

/**
 * The principal the console acts for: the visitor when one has signed up on this device, else Nadia.
 * `renderSafe` reads (used by synchronous fixture reads during render) ignore the session until the
 * page has hydrated, so the first client render equals the server render.
 */
export function activePrincipalId(opts: { renderSafe?: boolean } = {}): string {
  if (opts.renderSafe && !hydrated) return CONSOLE_PRINCIPAL;
  return readVisitorSession()?.visitorId ?? CONSOLE_PRINCIPAL;
}

export function activeVisitor(opts: { renderSafe?: boolean } = {}): VisitorSession | null {
  if (opts.renderSafe && !hydrated) return null;
  return readVisitorSession();
}
