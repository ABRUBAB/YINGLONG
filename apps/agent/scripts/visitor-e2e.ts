// End-to-end check of visitor sign-up against a running agent API, playing the browser's part with a software
// P-256 passkey (the web app uses a real WebAuthn passkey; the account verifies both the same way).
// Usage: npx tsx apps/agent/scripts/visitor-e2e.ts [--api http://127.0.0.1:8787]
import { randomBytes } from "node:crypto";
import { hashTypedData, toHex, type Hex } from "viem";
import { seededPasskey } from "@yinglong/sdk/account";

const args = process.argv.slice(2);
const API = args.includes("--api") ? args[args.indexOf("--api") + 1]! : "http://127.0.0.1:8787";
let token = "";

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { "x-visitor-token": token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${method} ${path}: ${String(j.error ?? r.status)}`);
  return j;
}

type TypedData = { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };
/** What the web app's signing guard does before it lets the passkey sign: recompute the digest from the typed data. */
function recompute(td: TypedData): Hex {
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

async function main() {
  const keyId = randomBytes(18).toString("base64url");
  const pk = seededPasskey(keyId, `visitor e2e ${keyId}`);
  const reg = (await call("POST", "/v1/visitors", { credentialId: keyId, publicKey: { x: toHex(pk.x, { size: 32 }), y: toHex(pk.y, { size: 32 }) } })) as {
    visitorId: string;
    token: string;
    account: string;
    requests: { step: string; digest: Hex; typedData: TypedData }[];
  };
  token = reg.token;
  const out: Record<string, unknown> = { visitorId: reg.visitorId, account: reg.account };
  const sigs: Record<string, Hex> = {};
  for (const r of reg.requests) {
    if (recompute(r.typedData).toLowerCase() !== r.digest.toLowerCase()) throw new Error(`typed data does not hash to the digest for ${r.step}`);
    sigs[r.step] = await pk.sign(r.digest);
  }
  out.guard = "both typed messages recompute to their digests";
  const sealed = (await call("POST", `/v1/visitors/${reg.visitorId}/seal`, { userOpSignature: sigs.publish, delegationSignature: sigs.delegation })) as { publishTx: string; principal: { signer: string; passkeyIds: string[] } };
  out.seal = { publishTx: sealed.publishTx, signer: sealed.principal.signer, passkeyIds: sealed.principal.passkeyIds.length };

  const coffee = (await call("POST", `/v1/principals/${reg.visitorId}/ask`, { text: "Buy a coffee at Arena Cafe for 5 HKD", autoExecute: true })) as { tier: string; receipt?: { outcome: string; txHash?: string } };
  out.t1 = { tier: coffee.tier, outcome: coffee.receipt?.outcome, tx: coffee.receipt?.txHash };

  const books = (await call("POST", `/v1/principals/${reg.visitorId}/ask`, { text: "Pay HBU Bookshop 60 HKD for course books" })) as { tier: string; approvalId?: string };
  const t2: Record<string, unknown> = { tier: books.tier, approval: !!books.approvalId };
  out.t2 = t2;
  if (books.approvalId) {
    const a = (await call("GET", `/v1/approvals/${books.approvalId}`)) as { digest: Hex; typedData: TypedData };
    if (recompute(a.typedData).toLowerCase() !== a.digest.toLowerCase()) throw new Error("approval typed data does not hash to its digest");
    const done = (await call("POST", `/v1/approvals/${books.approvalId}/signature`, { signature: await pk.sign(a.digest) })) as { receipt: { outcome: string; txHash?: string } };
    t2.approved = { outcome: done.receipt.outcome, tx: done.receipt.txHash };
  }

  const pause = (await call("POST", `/v1/principals/${reg.visitorId}/pause`)) as { approvalId: string; approval: { digest: Hex } };
  const paused = (await call("POST", `/v1/approvals/${pause.approvalId}/signature`, { signature: await pk.sign(pause.approval.digest) })) as { receipt: { outcome: string; txHash?: string } };
  out.pause = { outcome: paused.receipt.outcome, tx: paused.receipt.txHash };
  const resume = (await call("POST", `/v1/principals/${reg.visitorId}/resume`)) as { approvalId: string; approval: { digest: Hex } };
  const resumed = (await call("POST", `/v1/approvals/${resume.approvalId}/signature`, { signature: await pk.sign(resume.approval.digest) })) as { receipt: { outcome: string } };
  out.resume = resumed.receipt.outcome;

  token = "";
  try {
    await call("POST", `/v1/principals/${reg.visitorId}/ask`, { text: "Buy a coffee at Arena Cafe for 5 HKD", autoExecute: true });
    out.noTokenAutoExecute = "ALLOWED (unexpected)";
  } catch (e) {
    out.noTokenAutoExecute = `refused: ${(e as Error).message.split(": ").pop()}`;
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
