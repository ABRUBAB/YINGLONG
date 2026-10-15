import { encodeFunctionData, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi, type LedgerName } from "@yinglong/sdk";
import { seededPasskey, type PasskeySigner } from "@yinglong/sdk/account";
import { rolePrivateKey, type Role } from "@yinglong/sdk/server";
import { guestMandate, lotusHkMandate, lotusShenzhenMandate, nadiaMandate, type Delegation, type Mandate } from "@yinglong/mandate";
import { ledgerContext, type LedgerContext } from "./chain/ledger";
import { companyPrincipal, personPrincipal, type Principal } from "./chain/principal";
import { ensurePassport } from "./chain/passport";
import { guardianCalls, sealMandate } from "./chain/mandates";
import { DATA_DIR, DocStore } from "./store";
import { resolve } from "node:path";

export type PrincipalId = "nadia" | "lotus-sz" | "lotus-hk" | "guest";

export interface PrincipalConfig {
  id: PrincipalId;
  kind: "person" | "company";
  name: string;
  ledger: LedgerName;
  agentRole: Role;
  agentLabel: string;
  identityCode: string;
  issuers: { role: Role; claim: string }[];
  defaultUnit: "tHKD" | "tUSD" | "USDC" | "CNY";
}

const env = (k: string, d: string) => process.env[k] ?? d;

export const PRINCIPALS: PrincipalConfig[] = [
  {
    id: "nadia",
    kind: "person",
    name: "Nadia Rahman",
    ledger: env("NADIA_LEDGER", "anvil") as LedgerName,
    agentRole: "agent-ying",
    agentLabel: "Ying",
    identityCode: "YL-TEST-0001",
    issuers: [{ role: "issuer-hbu", claim: "agent of an enrolled HBU student" }],
    defaultUnit: "tHKD",
  },
  {
    id: "lotus-sz",
    kind: "company",
    name: "Lotus Lane Trading (Shenzhen) Co. (fictional)",
    ledger: env("LOTUS_SZ_LEDGER", "fisco") as LedgerName,
    agentRole: "agent-treasurer",
    agentLabel: "Lotus Lane treasurer",
    identityCode: "YL-TEST-0002",
    issuers: [{ role: "issuer-harbour-digital-bank", claim: "treasury agent of a KYB-verified company" }],
    defaultUnit: "CNY",
  },
  {
    id: "lotus-hk",
    kind: "company",
    name: "Lotus Lane (HK) Ltd (fictional)",
    ledger: env("LOTUS_HK_LEDGER", env("NADIA_LEDGER", "anvil")) as LedgerName,
    agentRole: "agent-treasurer",
    agentLabel: "Lotus Lane treasurer",
    identityCode: "YL-TEST-0002",
    issuers: [{ role: "issuer-harbour-digital-bank", claim: "treasury agent of a KYB-verified company" }],
    defaultUnit: "tHKD",
  },
  {
    id: "guest",
    kind: "person",
    name: "Guest (Judge's Challenge)",
    ledger: env("GUEST_LEDGER", env("NADIA_LEDGER", "anvil")) as LedgerName,
    agentRole: "guest-arena",
    agentLabel: "Arena agent",
    identityCode: "YL-TEST-0099",
    issuers: [{ role: "issuer-harbour-digital-bank", claim: "Judge's Challenge sandbox agent (test units only)" }],
    defaultUnit: "tHKD",
  },
];

/** Stored state of one principal on its ledger. Delegations hold signatures; nothing here is a key. */
export interface PrincipalState {
  id: PrincipalId;
  ledger: LedgerName;
  account: Address;
  did: string;
  signerLabel: string;
  agentWallet: Address;
  agentId: bigint;
  mandate?: Mandate;
  mandateHash?: Hex;
  delegationHash?: Hex;
  delegation?: Delegation;
  publishTx?: Hex;
  sealedAt?: string;
  cosignNonce: number;
}

interface WorldDoc {
  principals: Partial<Record<PrincipalId, PrincipalState>>;
}

export const world = new DocStore<WorldDoc>(resolve(DATA_DIR, "world.json"), { principals: {} });

export function config(id: PrincipalId): PrincipalConfig {
  const c = PRINCIPALS.find((p) => p.id === id);
  if (!c) throw new Error(`unknown principal ${id}`);
  return c;
}

/** Scripted passkey for the demo principal (labelled everywhere as a software P-256 key). */
export function runFor(id: PrincipalId): string {
  return process.env[`RUN_ID_${id.replace(/-/g, "_").toUpperCase()}`] ?? process.env.RUN_ID ?? "v1";
}

export function demoPasskey(id: PrincipalId): PasskeySigner {
  return seededPasskey(`${id}-phone`, `yinglong demo passkey ${id} ${runFor(id)}`);
}

export async function principalHandle(id: PrincipalId): Promise<{ ctx: LedgerContext; p: Principal; cfg: PrincipalConfig }> {
  const cfg = config(id);
  const ctx = ledgerContext(cfg.ledger);
  const run = runFor(id);
  const p =
    cfg.kind === "person"
      ? await personPrincipal(ctx, cfg.name, demoPasskey(id), `yinglong:${id}:${run}`)
      : await companyPrincipal(
          ctx,
          cfg.name,
          (["director-1", "director-2", "director-3"] as Role[]).map((r) => ({ address: ctx.roleAddress(r), privateKey: rolePrivateKey(r) })),
          2,
          `yinglong:${id}:${run}`,
          [0, 1],
        );
  if (cfg.kind === "company") p.did = "did:web:lotus-lane.example";
  return { ctx, p, cfg };
}

function mandateFor(id: PrincipalId, ctx: LedgerContext, p: Principal, now: number): Mandate {
  if (id === "lotus-hk") {
    return lotusHkMandate(
      ctx.deployment,
      { account: p.account, agent: ctx.roleAddress("agent-treasurer"), kowloonForwarders: ctx.roleAddress("svc-kowloon-forwarders"), issuerBank: ctx.roleAddress("issuer-harbour-digital-bank") },
      { now, salt: String(now), did: p.did },
    );
  }
  if (id === "guest") {
    return guestMandate(
      ctx.deployment,
      {
        account: p.account,
        agent: ctx.roleAddress("guest-arena"),
        cafe: `0x${keccak256(stringToBytes("arena-cafe")).slice(26)}` as Address,
        issuerBank: ctx.roleAddress("issuer-harbour-digital-bank"),
      },
      { now, salt: String(now) },
    );
  }
  if (id === "nadia") {
    const m = nadiaMandate(
      ctx.deployment,
      {
        account: p.account,
        agent: ctx.roleAddress("agent-ying"),
        harbourHomes: ctx.roleAddress("svc-harbour-homes"),
        hbuBursar: ctx.roleAddress("svc-hbu-bursar"),
        foodMart: `0x${keccak256(stringToBytes("kowloon-food-mart")).slice(26)}` as Address,
        issuerHbu: ctx.roleAddress("issuer-hbu"),
        issuerBank: ctx.roleAddress("issuer-harbour-digital-bank"),
      },
      { now, salt: String(now), periodLength: Number(process.env.DEMO_PERIOD_SECONDS ?? 30 * 86400) },
    );
    return m;
  }
  const m = lotusShenzhenMandate(
    ctx.deployment,
    {
      account: p.account,
      agent: ctx.roleAddress("agent-treasurer"),
      shenzhenComponents: ctx.roleAddress("svc-shenzhen-components"),
      payroll: `0x${keccak256(stringToBytes("lotus-lane-payroll")).slice(26)}` as Address,
      issuerBank: ctx.roleAddress("issuer-harbour-digital-bank"),
    },
    { now, salt: String(now) },
  );
  m.principal.did = p.did;
  return m;
}

/** Idempotent onboarding: account, agent passport, test funds, guardians and a sealed scenario mandate. */
export async function onboard(id: PrincipalId, opts: { reseal?: boolean } = {}): Promise<PrincipalState> {
  const cfg0 = config(id);
  const ctx0 = ledgerContext(cfg0.ledger);
  for (const r of ["relayer", "deployer", cfg0.agentRole, "agent-owner", ...cfg0.issuers.map((i) => i.role)] as Role[]) {
    await ctx0.ensureGas(ctx0.roleAddress(r), 20_000_000_000_000_000n);
  }
  const { ctx, p, cfg } = await principalHandle(id);
  const passport = await ensurePassport(ctx, cfg.agentRole, p.did, cfg.identityCode, cfg.issuers);
  const existing = world.get().principals[id];

  // Test units: tHKD for persons; posted coin-free balance for the company on the instruction rail.
  if (cfg.kind === "person" || cfg.defaultUnit === "tHKD") {
    const bal = await ctx.read<bigint>({ address: ctx.addr("TestHKD"), abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [p.account] });
    if (id === "guest") {
      if (bal < 450_000_000n) await ctx.write("deployer", { address: ctx.addr("TestHKD"), abi: abi.TestUnitsAbi as never, functionName: "mint", args: [p.account, 500_000_000n] });
    } else if (id === "lotus-hk") {
      if (bal < 200_000_000_000n) await ctx.write("deployer", { address: ctx.addr("TestHKD"), abi: abi.TestUnitsAbi as never, functionName: "mint", args: [p.account, 400_000_000_000n - bal] });
    } else if (bal < 15_000_000_000n) {
      // Top up to 20,000 test units (team-minted test units; no monetary value).
      await ctx.write("deployer", { address: ctx.addr("TestHKD"), abi: abi.TestUnitsAbi as never, functionName: "mint", args: [p.account, 20_000_000_000n - bal] });
      const usd = await ctx.read<bigint>({ address: ctx.addr("TestUSD"), abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [p.account] });
      if (usd < 3_000_000_000n) await ctx.write("deployer", { address: ctx.addr("TestUSD"), abi: abi.TestUnitsAbi as never, functionName: "mint", args: [p.account, 3_000_000_000n - usd] });
    }
  } else {
    const posted = await ctx.read<bigint>({ address: ctx.addr("ConditionalPaymentInstructions"), abi: abi.ConditionalPaymentInstructionsAbi, functionName: "postedBalance", args: [p.account] });
    if (posted === 0n) {
      await ctx.write("relayer", {
        address: ctx.addr("ConditionalPaymentInstructions"),
        abi: abi.ConditionalPaymentInstructionsAbi as never,
        functionName: "postBalance",
        args: [p.account, 100_000_000n, keccak256(stringToBytes("opening statement (e-CNY-style simulator)"))],
      });
    }
  }

  if (existing?.mandateHash && !opts.reseal) {
    const live = await ctx.read<boolean>({ address: ctx.addr("MandateRegistry"), abi: abi.MandateRegistryAbi, functionName: "isLive", args: [existing.mandateHash] });
    if (live) return existing;
  }
  const now = Number((await ctx.pub.getBlock()).timestamp);
  const doc = mandateFor(id, ctx, p, now);
  const sealed = await sealMandate(ctx, p, doc, { extraCalls: guardianCalls(ctx, [ctx.roleAddress("guardian"), ctx.roleAddress("breaker-watcher")]) });
  const state: PrincipalState = {
    id,
    ledger: cfg.ledger,
    account: p.account,
    did: p.did,
    signerLabel: p.signerLabel,
    agentWallet: ctx.roleAddress(cfg.agentRole),
    agentId: passport.agentId,
    mandate: doc,
    mandateHash: sealed.compiled.mandateHash,
    delegationHash: sealed.compiled.delegationHash,
    delegation: sealed.delegation,
    publishTx: sealed.publishTx,
    sealedAt: new Date().toISOString(),
    cosignNonce: existing?.cosignNonce ?? 1,
  };
  world.update((w) => {
    w.principals[id] = state;
  });
  return state;
}

export function stateOf(id: PrincipalId): PrincipalState {
  const s = world.get().principals[id];
  if (!s) throw new Error(`${id} is not onboarded yet`);
  return s;
}

export function nextCosignNonce(id: PrincipalId): bigint {
  let n = 1;
  world.update((w) => {
    const s = w.principals[id]!;
    n = s.cosignNonce ?? 1;
    s.cosignNonce = n + 1;
  });
  return BigInt(n) + BigInt(Date.now()) * 1000n;
}

export function transferCall(token: Address, to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: abi.TestUnitsAbi, functionName: "transfer", args: [to, amount] });
}
