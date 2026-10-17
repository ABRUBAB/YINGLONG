/**
 * The page's own decoding of account user operations: the sign-up publish operation, the root
 * delegation, and the revoke operation (MandateRegistry.revoke + DelegationManager.disableDelegation).
 * Each refusal case changes one thing a malicious service could change.
 */
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeFunctionData, keccak256, toHex, type Hex } from "viem";
import {
  ACCOUNT_ABI,
  BATCH_DEFAULT_MODE,
  DELEGATION_MANAGER_ABI,
  decodeExecuteCallData,
  delegationStructHash,
  MANDATE_REGISTRY_ABI,
  reviewDelegation,
  reviewPublishOp,
  reviewRevoke,
  ROOT_AUTHORITY,
  SINGLE_DEFAULT_MODE,
  type RevokeContext,
} from "./account-ops";
import { createFixtureVisitors, FISCO_DIRECTORY, revokeTypedData } from "./api/fixtures/visitor";
import { guardSigningRequest, typedDataDigest } from "./signing-guard";
import type { TypedData } from "./api/view";

const H = (s: string) => keccak256(toHex(s));
const A = (s: string) => `0x${H(s).slice(26)}` as Hex;
const account = A("account");
const agent = A("agent");
const delegation = {
  delegate: agent,
  delegator: account,
  authority: ROOT_AUTHORITY,
  caveats: [0, 1, 2].map((i) => ({ enforcer: A(`enforcer-${i}`), terms: H(`terms-${i}`), args: "0x" as Hex })),
  salt: 9n,
  signature: "0x" as Hex,
};
const ctx: RevokeContext = {
  principalId: "v-0123456789",
  account,
  ledger: "fisco",
  mandateHash: H("mandate"),
  delegationHash: delegationStructHash(delegation),
  directory: FISCO_DIRECTORY,
};

function withCalls(td: TypedData, calls: { to: Hex; data: Hex; value?: bigint }[], mode: Hex = BATCH_DEFAULT_MODE): TypedData {
  const exec =
    mode === SINGLE_DEFAULT_MODE
      ? (`0x${calls[0]!.to.slice(2)}${(calls[0]!.value ?? 0n).toString(16).padStart(64, "0")}${calls[0]!.data.slice(2)}` as Hex)
      : encodeAbiParameters(
          [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
          [calls.map((c) => ({ target: c.to, value: c.value ?? 0n, callData: c.data }))],
        );
  return { ...td, message: { ...td.message, callData: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [mode, exec] }) } };
}

const revokeCall = (hash: Hex, to: Hex = FISCO_DIRECTORY.MandateRegistry!) => ({ to, data: encodeFunctionData({ abi: MANDATE_REGISTRY_ABI, functionName: "revoke", args: [hash] }) });
const disableCall = (d = delegation, to: Hex = FISCO_DIRECTORY.DelegationManager!) => ({ to, data: encodeFunctionData({ abi: DELEGATION_MANAGER_ABI, functionName: "disableDelegation", args: [d] }) });

describe("signing guard: user operations are decoded", () => {
  const td = revokeTypedData(ctx, delegation);
  const sign = (t: TypedData, kind: "revoke" | "seal" | "resume" = "revoke") => guardSigningRequest({ kind, digest: typedDataDigest(t), typedData: t });
  const transfer = { to: FISCO_DIRECTORY.MandateRegistry!, data: `0xa9059cbb${"00".repeat(64)}` as Hex };

  it("refuses a call outside the kind's account functions, even with a matching digest", () => {
    expect(sign(withCalls(td, [revokeCall(ctx.mandateHash), transfer]))).toMatchObject({ ok: false, code: "UnknownCall" });
    expect(sign(withCalls(td, [revokeCall(ctx.mandateHash)]), "resume")).toMatchObject({ ok: false, code: "UnknownCall" });
  });
  it("refuses a user operation that sends value", () => {
    expect(sign(withCalls(td, [{ ...revokeCall(ctx.mandateHash), value: 1n }], SINGLE_DEFAULT_MODE))).toMatchObject({ ok: false, code: "UnknownCall" });
  });
  it("refuses an unknown request kind instead of throwing", () => {
    expect(guardSigningRequest({ kind: "transfer" as never, digest: typedDataDigest(td), typedData: td })).toMatchObject({ ok: false, code: "KindMismatch" });
  });
});

describe("revoke review", () => {
  const td = revokeTypedData(ctx, delegation);

  it("accepts exactly revoke(live mandate) + disableDelegation(live delegation) from the account", () => {
    const r = reviewRevoke(td, ctx);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([expect.stringMatching(/^Retire mandate/), expect.stringMatching(/^Disable the delegation/)]);
    expect(guardSigningRequest({ kind: "revoke", digest: typedDataDigest(td), typedData: td })).toMatchObject({ ok: true, primaryType: "PackedUserOperation" });
    expect(guardSigningRequest({ kind: "revoke", digest: H("x"), typedData: { ...td, primaryType: "Delegation" } })).toMatchObject({ ok: false, code: "KindMismatch" });
  });

  const refusals: Array<[string, TypedData]> = [
    ["another mandate hash", withCalls(td, [revokeCall(H("other")), disableCall()])],
    ["a different registry", withCalls(td, [revokeCall(ctx.mandateHash, A("fake-registry")), disableCall()])],
    ["another delegation", withCalls(td, [revokeCall(ctx.mandateHash), disableCall({ ...delegation, salt: 10n })])],
    ["a third call", withCalls(td, [revokeCall(ctx.mandateHash), disableCall(), revokeCall(ctx.mandateHash)])],
    ["value attached", withCalls(td, [revokeCall(ctx.mandateHash), { ...disableCall(), value: 1n }])],
    ["only one call", withCalls(td, [revokeCall(ctx.mandateHash)], SINGLE_DEFAULT_MODE)],
    ["calls swapped", withCalls(td, [disableCall(), revokeCall(ctx.mandateHash)])],
    ["another account", { ...td, domain: { ...td.domain, verifyingContract: A("someone") } }],
    ["a different sender", { ...td, message: { ...td.message, sender: A("someone") } }],
    ["init code riding along", { ...td, message: { ...td.message, initCode: "0x1234" } }],
    ["a token transfer instead", withCalls(td, [{ to: A("token"), data: "0xa9059cbb" }, disableCall()])],
  ];
  it.each(refusals)("refuses %s", (_, bad) => {
    expect(reviewRevoke(bad, ctx).ok).toBe(false);
  });

  it("refuses when the deployment directory is unknown", () => {
    expect(reviewRevoke(td, { ...ctx, directory: { ledger: "fisco" } }).ok).toBe(false);
  });

  it("decodes single and batch execute call data and rejects other modes", () => {
    const single = withCalls(td, [revokeCall(ctx.mandateHash)], SINGLE_DEFAULT_MODE);
    expect(decodeExecuteCallData(single.message.callData as Hex)).toMatchObject({ mode: "single", calls: [{ value: 0n }] });
    const tryMode = `0x01${"00".repeat(5)}01${"00".repeat(25)}` as Hex;
    const odd = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [tryMode, "0x"] });
    expect(() => decodeExecuteCallData(odd)).toThrow(/not a default/);
  });
});

describe("sign-up review", () => {
  const sim = createFixtureVisitors();
  const s = sim.signUp({ credentialId: "AbCdEfGhIjKlMnOpQrSt", publicKey: { x: H("x"), y: H("y") } });
  const facts = { account: s.account, agentWallet: s.agent.wallet, mandateHash: s.mandate.mandateHash, delegationHash: s.mandate.delegationHash };
  const publish = s.requests.find((r) => r.step === "publish")!;
  const del = s.requests.find((r) => r.step === "delegation")!;

  it("accepts the publish operation and the delegation, both passing the signing guard", () => {
    const p = reviewPublishOp(publish.typedData, facts, FISCO_DIRECTORY);
    expect(p.checks.filter((c) => !c.ok)).toEqual([]);
    expect(p.lines).toEqual([expect.stringMatching(/PayeeBook/), expect.stringMatching(/guardian/), expect.stringMatching(/^Publish mandate/)]);
    const d = reviewDelegation(del.typedData, facts, FISCO_DIRECTORY, p.published);
    expect(d.checks.filter((c) => !c.ok)).toEqual([]);
    expect(guardSigningRequest({ kind: "seal", digest: publish.digest, typedData: publish.typedData })).toMatchObject({ ok: true, primaryType: "PackedUserOperation" });
    expect(guardSigningRequest({ kind: "seal", digest: del.digest, typedData: del.typedData })).toMatchObject({ ok: true, primaryType: "Delegation" });
  });

  it("refuses a delegation to someone else's agent, or with rules other than those published", () => {
    const p = reviewPublishOp(publish.typedData, facts, FISCO_DIRECTORY);
    const other = { ...del.typedData, message: { ...del.typedData.message, delegate: A("attacker") } };
    expect(reviewDelegation(other, facts, FISCO_DIRECTORY, p.published).ok).toBe(false);
    const caveats = (del.typedData.message.caveats as { enforcer: string; terms: string }[]).slice(0, -1);
    const fewer = { ...del.typedData, message: { ...del.typedData.message, caveats } };
    const r = reviewDelegation(fewer, facts, FISCO_DIRECTORY, p.published);
    expect(r.checks.find((c) => /exactly the rules/.test(c.label))?.ok).toBe(false);
  });

  it("refuses a publish operation that carries an unknown call or publishes another agent", () => {
    const extra = withCalls(publish.typedData, [...decodeExecuteCallData(publish.typedData.message.callData as Hex).calls.map((c) => ({ to: c.target, data: c.data })), { to: A("token"), data: "0x095ea7b3" }]);
    expect(reviewPublishOp(extra, facts, FISCO_DIRECTORY).ok).toBe(false);
    expect(reviewPublishOp(publish.typedData, { ...facts, agentWallet: A("someone-else") }, FISCO_DIRECTORY).ok).toBe(false);
  });
});
