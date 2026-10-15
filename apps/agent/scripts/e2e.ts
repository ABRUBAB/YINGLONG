// End-to-end run of the student scenario on one ledger, with real transactions:
//   onboard (passkey account, agent passport) -> seal mandate -> T1 rent -> raw attack reverts on-chain ->
//   T2 co-signed tuition escrow -> one-tap pause blocks the agent -> resume.
// Usage: npx tsx apps/agent/scripts/e2e.ts [anvil|base-sepolia|fisco]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeAbiParameters, encodeFunctionData, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi, type LedgerName } from "@yinglong/sdk";
import { seededPasskey } from "@yinglong/sdk/account";
import { nadiaMandate, type Delegation } from "@yinglong/mandate";
import { ledgerContext, type LedgerContext } from "../src/chain/ledger";
import { personPrincipal } from "../src/chain/principal";
import { ensurePassport } from "../src/chain/passport";
import { guardianCalls, redeemCallData, replayRevert, sealMandate, simulateRedemption, singleExecution } from "../src/chain/mandates";

const name = (process.argv[2] ?? "anvil") as LedgerName;
const ctx = ledgerContext(name);
const U = (n: number) => BigInt(n) * 1_000_000n;
const evidence: Record<string, unknown>[] = [];

function log(step: string, data: Record<string, unknown>) {
  const row = { step, ledger: name, ...data };
  evidence.push(row);
  console.log(JSON.stringify(row, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

async function chainNow(c: LedgerContext): Promise<bigint> {
  return (await c.pub.getBlock()).timestamp;
}

const RUN = process.env.RUN_ID ?? "v1";

async function main() {
  if (name === "anvil") {
    // Demo time compression on the local bench chain only: jump to a fresh 30-day budget period.
    await ctx.pub.request({ method: "evm_increaseTime" as never, params: [31 * 86400] as never });
    await ctx.pub.request({ method: "evm_mine" as never, params: [] as never });
  }
  for (const r of ["relayer", "deployer", "agent-ying", "agent-owner", "issuer-hbu"] as const) await ctx.ensureGas(ctx.roleAddress(r), 50_000_000_000_000_000n);

  // 1. Nadia's passkey account (owner = none) and Ying's passport.
  const passkey = seededPasskey("nadia-phone", `yinglong demo passkey nadia ${RUN}`);
  const nadia = await personPrincipal(ctx, "Nadia Rahman", passkey, `yinglong:nadia:${RUN}`);
  log("account", { account: nadia.account, signer: nadia.signerLabel });
  const passport = await ensurePassport(ctx, "agent-ying", nadia.did, "YL-TEST-0001", [{ role: "issuer-hbu", claim: "agent of an enrolled HBU student" }]);
  log("passport", { agentId: passport.agentId, registerTx: passport.registerTx, attestTxs: passport.attestTxs });

  // 2. Test units for Nadia (the deployer is the test-unit minter).
  const tHKD = ctx.addr("TestHKD");
  const bal = await ctx.read<bigint>({ address: tHKD, abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [nadia.account] });
  if (bal < U(15_000)) {
    const m = await ctx.write("deployer", { address: tHKD, abi: abi.TestUnitsAbi as never, functionName: "mint", args: [nadia.account, U(20_000)] });
    log("mint", { tx: m.hash, amount: U(20_000) });
  }

  // 3. Seal the mandate (publish + payee book + guardians in one user operation, then passkey signature).
  const now = Number(await chainNow(ctx));
  const foodMart = `0x${keccak256(stringToBytes("kowloon-food-mart")).slice(26)}` as Address;
  const doc = nadiaMandate(
    ctx.deployment,
    {
      account: nadia.account,
      agent: ctx.roleAddress("agent-ying"),
      harbourHomes: ctx.roleAddress("svc-harbour-homes"),
      hbuBursar: ctx.roleAddress("svc-hbu-bursar"),
      foodMart,
      issuerHbu: ctx.roleAddress("issuer-hbu"),
      issuerBank: ctx.roleAddress("issuer-harbour-digital-bank"),
    },
    { now, salt: String(now) },
  );
  const sealed = await sealMandate(ctx, nadia, doc, {
    extraCalls: guardianCalls(ctx, [ctx.roleAddress("guardian"), ctx.roleAddress("breaker-watcher")]),
  });
  log("seal", { publishTx: sealed.publishTx, mandateHash: sealed.compiled.mandateHash, delegationHash: sealed.compiled.delegationHash, sealedBy: sealed.sealedBy });

  const agent = ctx.roleAddress("agent-ying");
  const pay = async (label: string, to: Address, amount: bigint, d: Delegation = sealed.delegation) => {
    const exec = singleExecution({ to: tHKD, data: encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transfer", args: [to, amount] }) });
    const calldata = redeemCallData([d], exec);
    const sim = await simulateRedemption(ctx, agent, calldata);
    return { label, exec, calldata, sim };
  };
  const submit = async (calldata: Hex, force = false) => {
    const w = ctx.wallet("agent-ying");
    const hash = await w.sendTransaction({
      to: ctx.addr("DelegationManager"),
      data: calldata,
      chain: ctx.chain,
      account: w.account!,
      ...(force ? { gas: 1_500_000n } : {}),
      ...ctx.txOpts(),
    });
    const r = await ctx.pub.waitForTransactionReceipt({ hash });
    return { hash, ok: r.status === "success", block: r.blockNumber };
  };

  // 4. T1: rent within the mandate.
  const rent = await pay("rent", ctx.roleAddress("svc-harbour-homes"), U(9_500));
  if (!rent.sim.ok) throw new Error(`rent simulation failed: ${rent.sim.revert?.message}`);
  const rentTx = await submit(rent.calldata);
  log("T1 rent 9,500 tHKD to Harbour Homes", { tx: rentTx.hash, ok: rentTx.ok, explorer: ctx.explorerTx(rentTx.hash) });

  // 5. T4: Mirage's raw redemption (bypassing every off-chain check) reverts on-chain with a typed error.
  const attack = await pay("mirage", ctx.roleAddress("mirage"), U(100));
  log("T4 simulation", { revert: attack.sim.revert?.message });
  const attackTx = await submit(attack.calldata, true);
  const reason = attackTx.ok ? undefined : await replayRevert(ctx, attackTx.hash);
  log("T4 raw attack to Mirage reverted on-chain", { tx: attackTx.hash, ok: attackTx.ok, revert: reason?.message, explorer: ctx.explorerTx(attackTx.hash) });

  // 6. T2: tuition deposit into escrow, co-signed by Nadia's passkey for exactly this execution.
  const escrowData = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint64" }],
    [ctx.roleAddress("svc-hbu-bursar"), keccak256(stringToBytes("enrolment:HBU:2026")), ctx.roleAddress("issuer-hbu"), BigInt(now + 30 * 86400)],
  );
  const tuitionExec = singleExecution({
    to: tHKD,
    data: encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transferAndCall", args: [ctx.addr("ProtectedPayment"), U(5_000), escrowData] }),
  });
  const withoutApproval = await simulateRedemption(ctx, agent, redeemCallData([sealed.delegation], tuitionExec));
  log("T2 without approval", { revert: withoutApproval.revert?.message });
  const cosignIdx = sealed.delegation.caveats.findIndex((c) => c.enforcer.toLowerCase() === ctx.addr("CoSignEnforcer").toLowerCase());
  const expiry = BigInt(now + 300);
  const approvalDigest = await ctx.read<Hex>({
    address: ctx.addr("CoSignEnforcer"),
    abi: abi.CoSignEnforcerAbi,
    functionName: "approvalDigest",
    args: [sealed.compiled.delegationHash, keccak256(tuitionExec), 1n, expiry],
  });
  const approvalSig = await nadia.sign(approvalDigest);
  const approved: Delegation = {
    ...sealed.delegation,
    caveats: sealed.delegation.caveats.map((c, i) =>
      i === cosignIdx ? { ...c, args: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], [1n, expiry, approvalSig]) } : c,
    ),
  };
  const tuitionCall = redeemCallData([approved], tuitionExec);
  const tuitionSim = await simulateRedemption(ctx, agent, tuitionCall);
  if (!tuitionSim.ok) throw new Error(`tuition simulation failed: ${tuitionSim.revert?.message}`);
  const tuitionTx = await submit(tuitionCall);
  log("T2 tuition escrow 5,000 tHKD co-signed by passkey", { tx: tuitionTx.hash, ok: tuitionTx.ok, explorer: ctx.explorerTx(tuitionTx.hash) });

  // 7. One-tap pause: passkey signs Trip, the relayer submits it as a plain transaction.
  const ks = ctx.addr("KillSwitchRegistry");
  const nonce = await ctx.read<bigint>({ address: ks, abi: abi.KillSwitchRegistryAbi, functionName: "nonces", args: [nadia.account] });
  const deadline = BigInt(now + 3600);
  const tripDigest = await ctx.read<Hex>({ address: ks, abi: abi.KillSwitchRegistryAbi, functionName: "tripDigest", args: [nadia.account, nonce, deadline] });
  const t0 = Date.now();
  const trip = await ctx.write("relayer", {
    address: ks,
    abi: abi.KillSwitchRegistryAbi as never,
    functionName: "tripWithSig",
    args: [nadia.account, nonce, deadline, await nadia.sign(tripDigest)],
  });
  log("pause (passkey signature relayed)", { tx: trip.hash, ok: trip.ok, msToConfirmed: Date.now() - t0, block: trip.receipt.blockNumber });
  const blocked = await pay("after pause", ctx.roleAddress("svc-harbour-homes"), U(10));
  log("agent blocked while paused", { revert: blocked.sim.revert?.message });

  const untripDigest = await ctx.read<Hex>({ address: ks, abi: abi.KillSwitchRegistryAbi, functionName: "untripDigest", args: [nadia.account, nonce + 1n, deadline] });
  const untrip = await ctx.write("relayer", {
    address: ks,
    abi: abi.KillSwitchRegistryAbi as never,
    functionName: "untripWithSig",
    args: [nadia.account, nonce + 1n, deadline, await nadia.sign(untripDigest)],
  });
  log("resume (passkey)", { tx: untrip.hash, ok: untrip.ok });

  const dir = resolve(import.meta.dirname, "..", "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `e2e-${name}.json`), JSON.stringify(evidence, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`wrote apps/agent/data/e2e-${name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
