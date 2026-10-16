import { randomBytes } from "node:crypto";
import { encodeFunctionData, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi } from "@yinglong/sdk";
import { buildUserOp, ensureAccount, executeCallData, hybridInitData, submitUserOp, userOpDigest, type PackedUserOp } from "@yinglong/sdk/account";
import { agentAddress } from "@yinglong/sdk/server";
import { compileMandate, delegationTypedData, visitorMandate, type CompiledMandate, type Delegation, type Mandate } from "@yinglong/mandate";
import { ledgerContext } from "./chain/ledger";
import { ensurePassport } from "./chain/passport";
import { guardianCalls, payeeBookCalls } from "./chain/mandates";
import { delegationDigestOnChain, userOpTypedData } from "./chain/principal";
import { recordReceipt } from "./receipts";
import { visitorConfig, visitorStore, world, type PrincipalState, type VisitorRecord } from "./world";

/**
 * Visitor sign-up with a real passkey (WebAuthn, P-256). The browser creates a passkey and sends only its public
 * key; we deploy a HybridDeleGator account whose only signer is that passkey (no ECDSA owner, no seed phrase),
 * register a passport for the visitor's own agent wallet, mint test units, and compile a small mandate. The
 * visitor's passkey then signs two messages in the browser: the user operation that publishes the mandate (with
 * the payee book and the guardians), and the root delegation. Nothing is sealed until both signatures verify
 * on-chain, so the session token only becomes valid once the visitor has proven they hold the passkey.
 */

const WEBAUTHN_ID = /^[A-Za-z0-9_-]{16,512}$/;
const COORD = /^0x[0-9a-fA-F]{64}$/;
const MAGIC_1271 = "0x1626ba7e";

interface PendingSeal {
  op: PackedUserOp;
  mandate: Mandate;
  compiled: CompiledMandate;
  delegation: Delegation;
  opDigest: Hex;
  delegationDigest: Hex;
  expires: number;
}
const pending = new Map<string, PendingSeal>();
const created: number[] = [];

const derived = (label: string) => `0x${keccak256(stringToBytes(label)).slice(26)}` as Address;

export function visitorIdFor(credentialId: string, x: Hex, y: Hex): `v-${string}` {
  return `v-${keccak256(stringToBytes(`${credentialId}:${x.toLowerCase()}:${y.toLowerCase()}`)).slice(2, 12)}`;
}

export function visitorTokenOk(id: string, token: string | undefined): boolean {
  const v = visitorStore.get().visitors[id];
  return !!v && !!v.sealedAt && !!token && keccak256(stringToBytes(token)) === v.tokenHash;
}

export async function registerVisitor(args: { credentialId: string; x: Hex; y: Hex }) {
  if (!WEBAUTHN_ID.test(args.credentialId)) throw new Error("credentialId must be the passkey's raw id in base64url");
  if (!COORD.test(args.x) || !COORD.test(args.y)) throw new Error("publicKey.x and publicKey.y must be 32-byte hex coordinates");
  const now0 = Date.now();
  while (created.length && now0 - created[0]! > 3_600_000) created.shift();
  if (created.length >= Number(process.env.VISITORS_PER_HOUR ?? 30)) throw new Error("too many sign-ups in the last hour; try again later");

  const id = visitorIdFor(args.credentialId, args.x, args.y);
  const cfg = visitorConfig(id);
  const ctx = ledgerContext(cfg.ledger);
  await ctx.freshHead();

  // 1. The account: HybridDeleGator, owner = address(0), the visitor's passkey as its only key.
  const { address: account } = await ensureAccount({
    publicClient: ctx.pub,
    walletClient: ctx.wallet("relayer"),
    factory: ctx.addr("SimpleFactory"),
    implementation: ctx.addr("HybridDeleGatorImpl"),
    initData: hybridInitData([args.credentialId], [BigInt(args.x)], [BigInt(args.y)]),
    salt: keccak256(stringToBytes(`yinglong:visitor:${id}`)),
    ...ctx.txOpts(),
  });
  const did = `did:pkh:eip155:${ctx.profile.chainId}:${account.toLowerCase()}`;
  // The account pays its own user-operation prefund (free on FISCO; a small top-up on Anvil and Base Sepolia).
  await ctx.ensureGas(account, 5_000_000_000_000_000n);

  // 2. The visitor's own agent wallet with a passport bound to the visitor's DID (AgentLineageEnforcer).
  const passport = await ensurePassport(ctx, cfg.agentRole, did, cfg.identityCode, cfg.issuers);
  await ctx.ensureGas(passport.wallet, 5_000_000_000_000_000n);

  // 3. Test units (team-minted; no monetary value).
  const bal = await ctx.read<bigint>({ address: ctx.addr("TestHKD"), abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [account] });
  if (bal < 500_000_000n) await ctx.write("deployer", { address: ctx.addr("TestHKD"), abi: abi.TestUnitsAbi as never, functionName: "mint", args: [account, 1_000_000_000n - bal] });

  // 4. The mandate and the two messages the passkey signs.
  const now = Number(await ctx.now());
  const mandate = visitorMandate(
    ctx.deployment,
    {
      account,
      agent: agentAddress(cfg.agentRole),
      cafe: derived("arena-cafe"),
      foodMart: derived("kowloon-food-mart"),
      bookshop: derived("hbu-bookshop"),
      issuerBank: ctx.roleAddress("issuer-harbour-digital-bank"),
    },
    { now, salt: String(now), name: cfg.name },
  );
  const compiled = compileMandate(mandate, ctx.deployment);
  const live = await ctx.read<Hex>({ address: ctx.addr("MandateRegistry"), abi: abi.MandateRegistryAbi, functionName: "liveMandateOfLineage", args: [account, compiled.lineageIdHash] });
  const retire = BigInt(live) !== 0n ? [{ to: ctx.addr("MandateRegistry"), data: encodeFunctionData({ abi: abi.MandateRegistryAbi, functionName: "revoke", args: [live] }) }] : [];
  const calls = [
    ...payeeBookCalls(ctx, mandate),
    ...guardianCalls(ctx, [ctx.roleAddress("guardian"), ctx.roleAddress("breaker-watcher")]),
    ...retire,
    { to: ctx.addr("MandateRegistry"), data: encodeFunctionData({ abi: abi.MandateRegistryAbi, functionName: "publish", args: [compiled.publishParams] }) },
  ];
  const op = await buildUserOp({
    publicClient: ctx.pub,
    account,
    callData: executeCallData(calls),
    ...(ctx.profile.legacyTx ? { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } : {}),
  });
  const opDigest = await userOpDigest(ctx.pub, op);
  const delegation: Delegation = { ...compiled.delegation, signature: "0x" };
  const delegationDigest = await delegationDigestOnChain(ctx, compiled.delegationHash);

  const token = randomBytes(24).toString("base64url");
  const rec: VisitorRecord = {
    id,
    keyId: args.credentialId,
    x: args.x,
    y: args.y,
    account,
    agentWallet: passport.wallet,
    agentId: passport.agentId,
    tokenHash: keccak256(stringToBytes(token)),
    createdAt: new Date().toISOString(),
    sealedAt: visitorStore.get().visitors[id]?.sealedAt,
  };
  // A re-registration (same passkey) gets a new token, valid only after it seals again with that passkey.
  visitorStore.update((d) => {
    d.visitors[id] = { ...rec, sealedAt: undefined };
  });
  pending.set(id, { op, mandate, compiled, delegation, opDigest, delegationDigest, expires: Date.now() + 15 * 60_000 });
  created.push(now0);

  return {
    visitorId: id,
    token,
    account,
    did,
    ledger: cfg.ledger,
    ledgerBadge: ctx.profile.badge,
    contracts: ctx.signingContracts(),
    agent: { label: cfg.agentLabel, wallet: passport.wallet, agentId: passport.agentId, identityCode: cfg.identityCode },
    mandate: { title: mandate.title, sentences: mandate.sentences, mandateHash: compiled.mandateHash, delegationHash: compiled.delegationHash },
    requests: [
      { kind: "seal", step: "publish", title: "Publish your mandate", digest: opDigest, typedData: userOpTypedData(ctx, op, "person") },
      { kind: "seal", step: "delegation", title: "Give your agent this mandate", digest: delegationDigest, typedData: delegationTypedData(delegation, ctx.addr("DelegationManager"), ctx.profile.chainId) },
    ],
  };
}

export async function sealVisitor(id: string, token: string | undefined, sigs: { userOpSignature: Hex; delegationSignature: Hex }): Promise<PrincipalState> {
  const v = visitorStore.get().visitors[id] as VisitorRecord | undefined;
  if (!v || !token || keccak256(stringToBytes(token)) !== v.tokenHash) throw new Error("unknown visitor or wrong session token");
  const pend = pending.get(id);
  if (!pend || pend.expires < Date.now()) throw new Error("this sign-up expired; start again");
  const cfg = visitorConfig(v.id);
  const ctx = ledgerContext(cfg.ledger);
  await ctx.freshHead();

  // The delegation signature must verify on the account itself (ERC-1271 through the passkey) before anything is sent.
  const magic = await ctx.pub
    .readContract({ address: v.account, abi: abi.HybridDeleGatorAbi, functionName: "isValidSignature", args: [pend.delegationDigest, sigs.delegationSignature] })
    .catch(() => "0x");
  if (magic !== MAGIC_1271) throw new Error("the delegation signature does not verify for this account's passkey");

  const res = await submitUserOp({ publicClient: ctx.pub, relayer: ctx.wallet("relayer"), entryPoint: ctx.addr("EntryPoint"), op: { ...pend.op, signature: sigs.userOpSignature }, ...ctx.txOpts() });
  if (!res.success) throw new Error(`publishing the mandate failed in user operation ${res.txHash} (the passkey signature did not validate)`);

  // Label the seal by the signature format the account verified: a WebAuthn assertion (authenticator data and
  // client data) or a raw 96-byte P-256 signature from a software key (scripted runs).
  const sealedBy = sigs.userOpSignature.length === 2 + 2 * 96 ? "scripted passkey (software P-256 key)" : "passkey (WebAuthn)";
  const prev = world.get().principals[v.id];
  const state: PrincipalState = {
    id: v.id,
    ledger: cfg.ledger,
    account: v.account,
    did: `did:pkh:eip155:${ctx.profile.chainId}:${v.account.toLowerCase()}`,
    signerLabel: sealedBy,
    agentWallet: v.agentWallet,
    agentId: v.agentId,
    mandate: pend.mandate,
    mandateHash: pend.compiled.mandateHash,
    delegationHash: pend.compiled.delegationHash,
    delegation: { ...pend.delegation, signature: sigs.delegationSignature },
    publishTx: res.txHash,
    sealedAt: new Date().toISOString(),
    cosignNonce: prev?.cosignNonce ?? 1,
  };
  world.update((w) => {
    w.principals[v.id] = state;
  });
  visitorStore.update((d) => {
    d.visitors[v.id]!.sealedAt = state.sealedAt;
  });
  pending.delete(v.id);
  recordReceipt({
    principal: v.id,
    ledger: cfg.ledger,
    agentId: v.agentId,
    mandateHash: state.mandateHash!,
    delegationHash: state.delegationHash!,
    tier: "T3",
    outcome: "confirmed",
    txHash: res.txHash,
    documents: { plan: { action: "seal", sealedBy, account: v.account } },
    explanation: { text: `Mandate sealed (${sealedBy}): published on-chain with its full rule set; your agent may act only inside it.`, aiGenerated: false },
    aigc: { model: "none (user signature)", provider: "local" },
  });
  return state;
}

export function visitorStatus(id: string) {
  const v = visitorStore.get().visitors[id];
  if (!v) return undefined;
  return { visitorId: v.id, account: v.account, agentWallet: v.agentWallet, agentId: v.agentId, createdAt: v.createdAt, sealedAt: v.sealedAt, pending: pending.has(v.id) };
}
