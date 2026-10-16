// Shared helpers for the live drill scripts: sign up a FRESH visitor principal with a software P-256 passkey
// (exactly the flow of apps/agent/scripts/visitor-e2e.ts; the web app uses a real WebAuthn passkey and the account
// verifies both the same way), check every typed message the way the web app's signing guard does before the
// passkey signs, and read the live FISCO chain through the public read-only RPC.
// The passkey's private key is random and stays in memory; it is never written anywhere.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeFunctionResult, encodeFunctionData, hashTypedData, pad, parseAbi, toHex, type Address, type Hex } from "viem";
import { P256_N, softwarePasskey, type PasskeySigner } from "@yinglong/sdk/account";
import { repoRoot } from "@yinglong/sdk/server";

export interface TypedData {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** What the web app's signing guard does before it lets the passkey sign: recompute the digest from the typed data. */
export function recompute(td: TypedData): Hex {
  const ints = (type: string) => /^u?int\d*$/.test(type);
  const norm = (v: unknown, type: string): unknown => {
    if (type.endsWith("]")) return (v as unknown[]).map((x) => norm(x, type.slice(0, type.lastIndexOf("["))));
    if (ints(type)) return BigInt(v as string);
    const s = td.types[type];
    if (s && v && typeof v === "object") return Object.fromEntries(s.map((f) => [f.name, norm((v as Record<string, unknown>)[f.name], f.type)]));
    return v;
  };
  const types = Object.fromEntries(Object.entries(td.types).filter(([k]) => k !== "EIP712Domain"));
  return hashTypedData({ domain: { ...td.domain, chainId: BigInt(td.domain.chainId as number) } as never, types, primaryType: td.primaryType, message: norm(td.message, td.primaryType) as never } as never);
}

export function guardCheck(td: TypedData, digest: Hex, allowed: string[]): void {
  if (!allowed.includes(td.primaryType)) throw new Error(`guard: refusing to sign a ${td.primaryType} message (allowed here: ${allowed.join(", ")})`);
  if (recompute(td).toLowerCase() !== digest.toLowerCase()) throw new Error(`guard: ${td.primaryType} typed data does not hash to the digest`);
}

/** Operator token for operator-only routes, read at runtime from outside the repository. Never printed. */
export function operatorToken(): string {
  const f = resolve(repoRoot(), "..", ".secrets", "agent-admin-token.txt");
  return existsSync(f) ? readFileSync(f, "utf8").trim() : "";
}

export class Api {
  visitorToken = "";
  constructor(
    readonly base: string,
    private readonly adminToken = "",
  ) {}
  async call<T = Record<string, unknown>>(method: "GET" | "POST", path: string, body?: unknown, opts: { admin?: boolean; visitor?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.visitor !== false && this.visitorToken) headers["x-visitor-token"] = this.visitorToken;
    if (opts.admin && this.adminToken) headers["x-admin-token"] = this.adminToken;
    const r = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json()) as Record<string, unknown>;
    if (!r.ok) throw new Error(`${method} ${path}: ${String(j.error ?? r.status)}`);
    return j as T;
  }
}

export interface Visitor {
  visitorId: string;
  account: Address;
  agent: { label: string; wallet: Address; agentId: string; identityCode: string };
  mandateHash: Hex;
  publishTx: Hex;
  signer: string;
  keyId: string;
  passkey: PasskeySigner;
  publicKey: { x: Hex; y: Hex };
}

interface Registration {
  visitorId: string;
  token: string;
  account: Address;
  agent: { label: string; wallet: Address; agentId: string; identityCode: string };
  mandate: { mandateHash: Hex };
  requests: { step: string; digest: Hex; typedData: TypedData }[];
}

/** A new random software passkey (P-256). */
export function freshPasskey(): { keyId: string; passkey: PasskeySigner; publicKey: { x: Hex; y: Hex } } {
  const keyId = randomBytes(18).toString("base64url");
  const k = (BigInt(toHex(randomBytes(32))) % (P256_N - 1n)) + 1n;
  const passkey = softwarePasskey(keyId, pad(toHex(k), { size: 32 }));
  return { keyId, passkey, publicKey: { x: toHex(passkey.x, { size: 32 }), y: toHex(passkey.y, { size: 32 }) } };
}

/**
 * Sign up (or, with the same passkey, sign up again: same visitor id, new token, the old mandate retired in the same
 * user operation) and seal the mandate with the passkey. Returns the sealed visitor; api.visitorToken is set.
 */
export async function signUpAndSeal(api: Api, key: { keyId: string; passkey: PasskeySigner; publicKey: { x: Hex; y: Hex } }): Promise<Visitor & { sealMs: number }> {
  const t0 = Date.now();
  api.visitorToken = "";
  const reg = await api.call<Registration>("POST", "/v1/visitors", { credentialId: key.keyId, publicKey: key.publicKey });
  api.visitorToken = reg.token;
  const sigs: Record<string, Hex> = {};
  for (const r of reg.requests) {
    guardCheck(r.typedData, r.digest, ["PackedUserOperation", "Delegation"]);
    sigs[r.step] = await key.passkey.sign(r.digest);
  }
  const sealed = await api.call<{ publishTx: Hex; mandateHash: Hex; principal: { signer: string } }>("POST", `/v1/visitors/${reg.visitorId}/seal`, {
    userOpSignature: sigs.publish,
    delegationSignature: sigs.delegation,
  });
  return {
    visitorId: reg.visitorId,
    account: reg.account,
    agent: reg.agent,
    mandateHash: sealed.mandateHash,
    publishTx: sealed.publishTx,
    signer: sealed.principal.signer,
    keyId: key.keyId,
    passkey: key.passkey,
    publicKey: key.publicKey,
    sealMs: Date.now() - t0,
  };
}

export interface ApprovalResponse {
  approvalId: string;
  approval: { kind: string; digest: Hex; typedData: TypedData };
}
export interface ReceiptView {
  receiptId: string;
  principal: string;
  ledger: string;
  tier: string;
  outcome: string;
  txHash?: Hex;
  revertError?: { name: string; message: string };
  explanation: { text: string };
  timestamp: string;
}

/** Create a passkey-gated approval (pause, resume, revoke), check it like the guard, sign it, submit it. */
export async function passkeyAction(api: Api, v: { visitorId: string; passkey: PasskeySigner }, action: "pause" | "resume" | "revoke") {
  const allowed = { pause: ["Trip"], resume: ["Untrip"], revoke: ["PackedUserOperation"] }[action];
  const a = await api.call<ApprovalResponse>("POST", `/v1/principals/${v.visitorId}/${action}`);
  guardCheck(a.approval.typedData, a.approval.digest, allowed);
  const sig = await v.passkey.sign(a.approval.digest);
  const { receipt } = await api.call<{ receipt: ReceiptView }>("POST", `/v1/approvals/${a.approvalId}/signature`, { signature: sig });
  const m = receipt.explanation.text.match(/confirmed in (\d+) ms, block (\d+)/);
  return { approvalId: a.approvalId, primaryType: a.approval.typedData.primaryType, receipt, serverMs: m ? Number(m[1]) : undefined, block: m ? Number(m[2]) : undefined };
}

// ---------------------------------------------------------------- read-only FISCO RPC (public proxy)

export class Rpc {
  constructor(readonly url: string) {}
  async req<T>(method: string, params: unknown[]): Promise<T> {
    const r = await fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = (await r.json()) as { result?: T; error?: { message: string } };
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result as T;
  }
  blockNumber = async () => Number(BigInt(await this.req<Hex>("eth_blockNumber", [])));
  async balanceOf(token: Address, who: Address): Promise<bigint> {
    const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
    const data = encodeFunctionData({ abi, functionName: "balanceOf", args: [who] });
    const out = await this.req<Hex>("eth_call", [{ to: token, data }, "latest"]);
    return decodeFunctionResult({ abi, functionName: "balanceOf", data: out }) as bigint;
  }
  receipt = (h: Hex) => this.req<{ status: Hex | string; blockNumber: Hex; gasUsed: Hex; from: Address } | null>("eth_getTransactionReceipt", [h]);
}

export function deploymentAddress(ledger: string, name: string): Address {
  const d = JSON.parse(readFileSync(resolve(repoRoot(), "contracts", "deployments", `${ledger}.json`), "utf8")) as Record<string, { address?: Address }>;
  const a = d[name]?.address;
  if (!a) throw new Error(`${name} is not in contracts/deployments/${ledger}.json`);
  return a;
}

export const opt = (args: string[], k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1]! : d);
