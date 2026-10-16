// LIVE private-mandate beat on one ledger, with real transactions and real zero-knowledge proofs:
//   passkey account -> agent passport -> test units -> private mandate sealed (cap, payee allowlist and
//   expiry hidden behind a Poseidon2 commitment) -> two payments inside the hidden cap, each with an
//   UltraHonk proof verified on-chain by ZKMandateEnforcer -> a third payment over the hidden cap: no proof
//   exists (the circuit refuses), a forged proof and a replayed proof both revert on-chain with typed errors.
// Agent wallet: agent-ying, else guest-arena, else (when both already hold passports bound to other
// principals, as on the shared demo ledgers) Ying's dedicated private-mandate wallet; see src/zk/agent.ts.
// Usage (from apps/agent):  npx tsx scripts/zk-private-mandate.ts <anvil|fisco|base-sepolia>
// Needs `pnpm --dir circuits install`; set YINGLONG_BB_CRS_PATH to choose the reference-string cache.
// Writes apps/agent/data/zk-<ledger>.json (including `supervisorView` for
// GET /v1/supervisor/agents/:agentId/private-mandate). All amounts are test units.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeFunctionData, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi, revertDataOf, type LedgerName } from "@yinglong/sdk";
import { seededPasskey } from "@yinglong/sdk/account";
import { repoRoot } from "@yinglong/sdk/server";
import { ledgerContext, type LedgerContext } from "../src/chain/ledger";
import { personPrincipal } from "../src/chain/principal";
import { ensureZkAgent } from "../src/zk/agent";
import { redeemCallData, simulateRedemption, singleExecution } from "../src/chain/mandates";
import { decodeZkRevert } from "../src/zk/errors";
import { zkManifest, zkProver, type ZkMandateSecret, type ZkProof, type ZkRunningState } from "../src/zk/prover";
import {
  PRIVATE_STATEMENT,
  PROOF_TYPE_MANDATE_COMPLIANCE,
  ZKMandateEnforcerAbi,
  ZKVerifierRouterAbi,
  compilePrivateMandate,
  evmChainId,
  sealPrivateMandate,
  withZkArgs,
  zkAddress,
  type PrivateMandateDoc,
} from "../src/zk/privateMandate";

const name = (process.argv[2] ?? "anvil") as LedgerName;
if (name !== "anvil" && name !== "fisco" && name !== "base-sepolia") throw new Error("usage: zk-private-mandate.ts <anvil|fisco|base-sepolia>");
const ctx = ledgerContext(name);
const U = (n: number) => BigInt(n) * 1_000_000n; // tHKD test units, 6 decimals
// Gas limit for redemptions that are expected to revert (and the fallback). Generous on purpose: the router
// reports an out-of-gas verifier as an invalid proof, so a tight limit would look like a proof failure.
const FIXED_GAS = 12_000_000n;
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
const steps: Record<string, unknown>[] = [];
function log(step: string, data: Record<string, unknown>) {
  const row = { step, ledger: name, ...data };
  steps.push(row);
  console.log(json(row));
}

/** Current chain time in block.timestamp units. Anvil: mine a block first. FISCO: latest block (seconds). */
async function chainNow(c: LedgerContext): Promise<bigint> {
  if (c.name === "anvil") await c.pub.request({ method: "evm_mine" as never, params: [] as never });
  const ts = (await c.pub.getBlock()).timestamp;
  if (ts > 100_000_000_000n) throw new Error(`block.timestamp ${ts} looks like milliseconds; the ZK clock window assumes seconds`);
  const wall = BigInt(Math.floor(Date.now() / 1000));
  // FISCO seals blocks only when there are transactions; if the head is stale, fall back to the wall clock.
  return c.name === "fisco" && wall > ts + 120n && wall < ts + 86_400n ? wall : ts;
}

async function main() {
  const t0 = Date.now();
  const zk = await zkProver();
  await zk.initPoseidon();
  const manifest = zkManifest();
  const dm = ctx.addr("DelegationManager");
  const tHKD = ctx.addr("TestHKD");
  const enforcer = zkAddress(ctx, "ZKMandateEnforcer");
  const router = zkAddress(ctx, "ZKVerifierRouter");
  const verifier = await ctx.read<Address>({ address: router, abi: ZKVerifierRouterAbi, functionName: "verifierOf", args: [PROOF_TYPE_MANDATE_COMPLIANCE] });
  if (verifier.toLowerCase() !== zkAddress(ctx, "HonkVerifier").toLowerCase()) throw new Error(`router proof type 0x01 points at ${verifier}`);
  const chainIdInEvm = await evmChainId(ctx);
  log("zk stack", { router, enforcer, verifier, evmChainId: chainIdInEvm, rpcChainId: ctx.profile.chainId });

  for (const r of ["relayer", "deployer", "agent-owner", "issuer-hbu"] as const) {
    await ctx.ensureGas(ctx.roleAddress(r), 50_000_000_000_000_000n);
  }

  // 1. Principal (passkey-only smart account) and the agent's passport.
  const passkey = seededPasskey("zk-phone", "yinglong demo passkey zk v1");
  const principal = await personPrincipal(ctx, "Private-mandate principal (test)", passkey, "yinglong:zk:v1");
  log("principal", { account: principal.account, did: principal.did, signer: principal.signerLabel });
  const zkAgent = await ensureZkAgent(ctx, principal.did, "YL-TEST-0001", [{ role: "issuer-hbu", claim: "agent acting under a private mandate (test)" }]);
  const agent = zkAgent.address;
  const passport = { agentId: zkAgent.agentId };
  log("passport", { agent: zkAgent.label, wallet: agent, agentId: zkAgent.agentId, registerTx: zkAgent.registerTx, attestTxs: zkAgent.attestTxs, note: zkAgent.note });

  // 2. Test units for the principal (the deployer is the minter).
  let mintTx: Hex | undefined;
  const bal = await ctx.read<bigint>({ address: tHKD, abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [principal.account] });
  if (bal < U(15_000)) {
    const m = await ctx.write("deployer", { address: tHKD, abi: abi.TestUnitsAbi as never, functionName: "mint", args: [principal.account, U(20_000)] });
    mintTx = m.hash;
    log("mint", { tx: m.hash, amount: U(20_000), gasUsed: m.receipt.gasUsed });
  }

  // 3. The hidden mandate and its public document.
  const now = await chainNow(ctx);
  const foodMart = `0x${keccak256(stringToBytes("kowloon-food-mart")).slice(26)}` as Address;
  const payees = {
    harbourHomes: ctx.roleAddress("svc-harbour-homes"),
    hbuBursar: ctx.roleAddress("svc-hbu-bursar"),
    foodMart,
  };
  const secret: ZkMandateSecret = {
    cap: U(10_000),
    allowlist: [payees.harbourHomes, payees.hbuBursar, payees.foodMart],
    expiry: now + 30n * 86_400n,
    salt: zk.randomField(),
  };
  const tree = zk.buildAllowlistTree(secret.allowlist);
  const commitment = zk.toHex32(zk.mandateCommitment(secret.cap, tree.root, secret.expiry, secret.salt));
  const doc: PrivateMandateDoc = {
    kind: "yinglong.private-mandate/v1",
    ledger: name,
    chainId: ctx.profile.chainId,
    principal: { account: principal.account, did: principal.did },
    agent: { wallet: agent, agentId: passport.agentId.toString() },
    lineageId: "yinglong:zk:private-mandate",
    asset: { symbol: "tHKD", address: tHKD },
    methods: ["transfer"],
    jurisdiction: "hk",
    validity: { from: Number(now - 3600n), until: Number(now + 365n * 86_400n) },
    zk: {
      proofType: PROOF_TYPE_MANDATE_COMPLIANCE,
      circuit: manifest.circuit?.name ?? "mandate_compliance",
      vkHash: manifest.vkHash ?? "",
      router,
      enforcer,
      commitment,
      statement: PRIVATE_STATEMENT,
    },
    nonce: zk.toHex32(zk.randomField()),
  };
  const compiled = compilePrivateMandate(ctx, doc, BigInt(keccak256(stringToBytes(`yinglong:zk:delegation:${doc.nonce}`))) >> 192n);
  const sealed = await sealPrivateMandate(ctx, principal, compiled);
  const dh = compiled.delegationHash;
  log("seal", {
    publishTx: sealed.publishTx,
    retiredMandate: sealed.retiredMandate,
    mandateHash: compiled.mandateHash,
    delegationHash: dh,
    commitment,
    caveats: compiled.caveatNames,
    sealedBy: sealed.sealedBy,
  });

  // 4. Payments.
  let running: ZkRunningState = { total: 0n, blind: 0n };
  const proveFor = async (payee: Address, amount: bigint, nonce: bigint, from: ZkRunningState) => {
    const claimedTime = await chainNow(ctx);
    const started = Date.now();
    const proof = await zk.proveMandateCompliance({
      mandate: secret,
      running: from,
      payment: { delegationHash: dh, chainId: chainIdInEvm, payee, amount, nonce, claimedTime },
    });
    return { proof, claimedTime, proveMs: Date.now() - started };
  };
  const redeemData = (payee: Address, amount: bigint, enforcerArgs: Hex) => {
    const exec = singleExecution({ to: tHKD, data: encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transfer", args: [payee, amount] }) });
    return redeemCallData([withZkArgs(sealed, enforcerArgs)], exec);
  };
  /** Valid redemptions: eth_estimateGas plus 30 percent. Expected reverts: a fixed generous limit. */
  const gasFor = async (data: Hex, expectSuccess: boolean): Promise<bigint> => {
    if (!expectSuccess) return FIXED_GAS;
    try {
      return ((await ctx.pub.estimateGas({ account: agent, to: dm, data })) * 13n) / 10n;
    } catch {
      return FIXED_GAS;
    }
  };
  const send = async (data: Hex, expectSuccess = true) => {
    const w = zkAgent.wallet;
    const gas = await gasFor(data, expectSuccess);
    const hash = await w.sendTransaction({ to: dm, data, gas, chain: ctx.chain, account: w.account!, ...ctx.txOpts() } as never);
    const r = await ctx.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    return { hash, ok: r.status === "success", gasUsed: r.gasUsed, gasLimit: gas, block: r.blockNumber };
  };
  const simulate = async (data: Hex) => {
    const sim = await simulateRedemption(ctx, agent, data);
    return sim.ok ? { ok: true as const } : { ok: false as const, revert: decodeZkRevert(sim.revert?.raw) };
  };
  const replay = async (hash: Hex) => {
    const tx = await ctx.pub.getTransaction({ hash });
    try {
      await ctx.pub.call({ account: tx.from, to: tx.to!, data: tx.input, blockNumber: (tx.blockNumber ?? 1n) - 1n });
      return undefined;
    } catch (e) {
      return decodeZkRevert(revertDataOf(e));
    }
  };

  const payments: Record<string, unknown>[] = [];
  const plan = [
    { label: "rent deposit to Harbour Homes", payee: payees.harbourHomes, amount: U(4_000), nonce: 1n },
    { label: "course fee to the HBU bursar", payee: payees.hbuBursar, amount: U(3_500), nonce: 2n },
  ];
  let lastProof: { proof: ZkProof; claimedTime: bigint; data: Hex } | undefined;
  for (const p of plan) {
    const before = await ctx.read<bigint>({ address: tHKD, abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [p.payee] });
    const { proof, claimedTime, proveMs } = await proveFor(p.payee, p.amount, p.nonce, running);
    const data = redeemData(p.payee, p.amount, proof.enforcerArgs);
    const sim = await simulate(data);
    if (!sim.ok) throw new Error(`${p.label}: simulation reverted ${sim.revert.message}`);
    const tx = await send(data);
    if (!tx.ok) throw new Error(`${p.label}: transaction ${tx.hash} reverted: ${(await replay(tx.hash))?.message}`);
    const after = await ctx.read<bigint>({ address: tHKD, abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [p.payee] });
    const stored = await ctx.read<Hex>({ address: enforcer, abi: ZKMandateEnforcerAbi, functionName: "runningCommitment", args: [dm, dh] });
    running = proof.newRunning;
    lastProof = { proof, claimedTime, data };
    const row = {
      label: p.label,
      payee: p.payee,
      amount: p.amount,
      nonce: p.nonce,
      claimedTime,
      proveMs,
      proofBytes: (proof.proof.length - 2) / 2,
      tx: tx.hash,
      ok: tx.ok,
      gasUsed: tx.gasUsed,
      gasLimit: tx.gasLimit,
      block: tx.block,
      received: after - before,
      oldRunningCommitment: proof.oldRunningCommitment,
      newRunningCommitment: proof.newRunningCommitment,
      storedCommitmentMatches: stored.toLowerCase() === proof.newRunningCommitment.toLowerCase(),
      explorer: ctx.explorerTx(tx.hash),
    };
    payments.push(row);
    log(`payment ${p.nonce}: ${p.label}`, row);
  }

  // 5. Over the hidden cap: 4,000 + 3,500 + 3,000 > 10,000.
  const over = { label: "groceries at Kowloon Food Mart", payee: payees.foodMart, amount: U(3_000), nonce: 3n };
  const overTime = await chainNow(ctx);
  const overReq = {
    mandate: secret,
    running,
    payment: { delegationHash: dh, chainId: chainIdInEvm, payee: over.payee, amount: over.amount, nonce: over.nonce, claimedTime: overTime },
  };
  let proverRefusal = "";
  let proved = false;
  try {
    await zk.proveMandateCompliance(overReq);
    proved = true;
  } catch (e) {
    proverRefusal = e instanceof Error ? e.message : String(e);
  }
  if (proved) throw new Error("the prover produced an over-cap proof");
  const circuit = await zk.checkStatement(overReq);
  if (circuit.ok) throw new Error("the circuit accepted an over-cap statement");
  log("over-cap: no proof exists", { attempted: over.amount, proverRefusal, circuitRefusal: circuit.error });

  // 5a. Forged: reuse payment 2's proof for the over-cap transfer under a fresh nonce.
  const prev = lastProof!;
  const forgedArgs = zk.encodeEnforcerArgs(over.nonce, overTime, prev.proof.newRunningCommitment, prev.proof.proof);
  const forgedData = redeemData(over.payee, over.amount, forgedArgs);
  const forgedSim = await simulate(forgedData);
  const forgedTx = await send(forgedData, false);
  const forgedRevert = forgedTx.ok ? undefined : await replay(forgedTx.hash);
  const forged = {
    description: "payment 2's proof re-used for the 3,000 tHKD over-cap transfer under nonce 3",
    simulation: forgedSim.ok ? "passed (unexpected)" : forgedSim.revert.message,
    tx: forgedTx.hash,
    ok: forgedTx.ok,
    gasUsed: forgedTx.gasUsed,
    gasLimit: forgedTx.gasLimit,
    block: forgedTx.block,
    revert: forgedRevert?.message,
    explorer: ctx.explorerTx(forgedTx.hash),
  };
  log("forged proof reverted on-chain", forged);

  // 5b. Replayed: payment 2's exact redemption sent again.
  const replaySim = await simulate(prev.data);
  const replayTx = await send(prev.data, false);
  const replayRevertReason = replayTx.ok ? undefined : await replay(replayTx.hash);
  const replayed = {
    description: "payment 2's redemption (same proof, same nonce) sent again",
    simulation: replaySim.ok ? "passed (unexpected)" : replaySim.revert.message,
    tx: replayTx.hash,
    ok: replayTx.ok,
    gasUsed: replayTx.gasUsed,
    gasLimit: replayTx.gasLimit,
    block: replayTx.block,
    revert: replayRevertReason?.message,
    explorer: ctx.explorerTx(replayTx.hash),
  };
  log("replayed proof reverted on-chain", replayed);
  if (forgedTx.ok || replayTx.ok) throw new Error("an invalid redemption succeeded");

  await zk.destroyProver();

  const stored = await ctx.read<Hex>({ address: enforcer, abi: ZKMandateEnforcerAbi, functionName: "runningCommitment", args: [dm, dh] });
  const first = payments[0] as { tx: Hex; gasUsed: bigint };
  const last = payments[payments.length - 1] as { tx: Hex; newRunningCommitment: Hex };
  const supervisorView = {
    agentId: passport.agentId.toString(),
    agentWallet: agent,
    principal: principal.did,
    ledger: name,
    commitment,
    mandateHash: compiled.mandateHash,
    delegationHash: dh,
    runningCommitment: stored,
    proofStatus: `verified on-chain: ${payments.length} payments accepted, over-cap payment unprovable, forged and replayed proofs rejected`,
    verifierTx: { ledger: name, chainId: ctx.profile.chainId, txHash: last.tx },
    verifier: { router, enforcer, honkVerifier: verifier, vkHash: manifest.vkHash, proofType: PROOF_TYPE_MANDATE_COMPLIANCE },
    statements: [
      { statement: "The mandate behind the commitment exists and the agent knows it (cap, payee allowlist, expiry hidden).", result: "proved", txHash: first.tx },
      ...payments.map((p) => {
        const r = p as { label: string; tx: Hex; amount: bigint; nonce: bigint };
        return {
          statement: `Payment ${r.nonce} (${r.label}): payee is in the hidden allowlist, claimed time is before the hidden expiry, running total stays within the hidden cap.`,
          result: "proved and verified on-chain",
          amount: r.amount.toString(),
          txHash: r.tx,
        };
      }),
      { statement: "A third payment of 3,000 tHKD would push the running total over the hidden cap.", result: `no proof exists (${circuit.error ?? "circuit refused"})` },
      { statement: "A forged proof (payment 2's proof for the over-cap transfer) is rejected.", result: forged.revert ?? "reverted", txHash: forged.tx },
      { statement: "A replayed proof (payment 2 resent) is rejected.", result: replayed.revert ?? "reverted", txHash: replayed.tx },
    ],
    note: "Amounts and payees of executed payments are public on the ledger; the cap, the rest of the allowlist, the expiry and the salt are not. Test units only.",
  };

  const out = {
    label: "Live run with real transactions and real UltraHonk proofs. Test units (tHKD) only. Not audited.",
    ledger: name,
    rpcChainId: ctx.profile.chainId,
    evmChainId: chainIdInEvm,
    badge: ctx.profile.badge,
    runAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    toolchain: manifest.toolchain,
    principal: { account: principal.account, did: principal.did, signer: principal.signerLabel },
    agent: { label: zkAgent.label, wallet: agent, agentId: zkAgent.agentId, registerTx: zkAgent.registerTx, attestTxs: zkAgent.attestTxs, note: zkAgent.note },
    mintTx,
    mandate: {
      mandateHash: compiled.mandateHash,
      delegationHash: dh,
      commitment,
      publishTx: sealed.publishTx,
      retiredMandate: sealed.retiredMandate,
      caveats: compiled.caveatNames.map((n, i) => ({ name: n, enforcer: compiled.caveats[i]!.enforcer })),
      publicDocument: doc,
      sealedBy: sealed.sealedBy,
    },
    demoDisclosure: {
      note: "Disclosed in this file for the demo narrative only. On-chain there is only the commitment; the salt, the expiry and the blindings are never written anywhere.",
      hiddenCap: secret.cap,
      hiddenAllowlist: [
        { label: "Harbour Homes", address: payees.harbourHomes },
        { label: "HBU bursar", address: payees.hbuBursar },
        { label: "Kowloon Food Mart", address: payees.foodMart },
      ],
    },
    payments,
    overCap: { label: over.label, payee: over.payee, attemptedAmount: over.amount, runningTotalBefore: running.total, proverRefusal, circuitRefusal: circuit.error },
    forged,
    replayed,
    finalRunningCommitment: stored,
    steps,
    supervisorView,
  };
  const dir = resolve(repoRoot(), "apps", "agent", "data");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `zk-${name}.json`);
  writeFileSync(file, `${JSON.stringify(out, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)}\n`);
  console.log(`wrote ${file}`);
}

main().catch(async (e) => {
  console.error(e);
  try {
    (await zkProver()).destroyProver();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
