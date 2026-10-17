/**
 * End to end against a running agent service: sign up with a secret key (no passkey), seal both
 * messages with it, log in again with a fresh challenge, and pay inside the mandate with the new token.
 * Usage: npx tsx apps/agent/scripts/visitor-key-e2e.mts [agent API URL]
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashTypedData, type Hex } from "viem";
const API = process.argv[2] ?? "http://127.0.0.1:8787";
/* eslint-disable @typescript-eslint/no-explicit-any */
const post = async (path: string, body: unknown, token?: string): Promise<any> => {
  const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-visitor-token": token } : {}) }, body: JSON.stringify(body) });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(path + ": " + j.error);
  return j;
};
const acct = privateKeyToAccount(generatePrivateKey());
const reg = await post("/v1/visitors", { owner: acct.address });
const sig = async (d: Hex) => acct.sign({ hash: d });
const pub = reg.requests.find((r: { step: string }) => r.step === "publish");
const del = reg.requests.find((r: { step: string }) => r.step === "delegation");
const sealed = await post(`/v1/visitors/${reg.visitorId}/seal`, { userOpSignature: await sig(pub.digest), delegationSignature: await sig(del.digest) }, reg.token);
console.log("sealed", sealed.principal.signer, sealed.publishTx.slice(0, 12));
// Anyone can start a sign-up with a public owner address: it must not reset the sealed account.
const hijack = await post("/v1/visitors", { owner: acct.address });
console.log("re-registration by a stranger leaves the account sealed", hijack.visitorId === reg.visitorId);
const ch = await post("/v1/visitors/login/challenge", {});
const td = { ...ch.typedData, message: { nonce: ch.typedData.message.nonce, issuedAt: BigInt(ch.typedData.message.issuedAt) } };
const digest = hashTypedData(td);
console.log("digest matches server", digest === ch.digest);
const login = await post("/v1/visitors/login", { nonce: ch.nonce, issuedAt: ch.issuedAt, signature: await acct.sign({ hash: digest }), owner: acct.address });
console.log("login", login.visitorId === reg.visitorId, login.method);
const pay = await post(`/v1/principals/${reg.visitorId}/ask`, { text: "Buy a coffee at Arena Cafe for 5 HKD", autoExecute: true }, login.token);
console.log("pay", pay.tier, pay.receipt?.outcome);
// The first device's session survives the second device's login.
const first = await post(`/v1/principals/${reg.visitorId}/ask`, { text: "Buy a coffee at Arena Cafe for 4 HKD", autoExecute: true }, reg.token);
console.log("first device still logged in", first.tier, first.receipt?.outcome);
