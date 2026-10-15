// Idempotent on-chain setup for one ledger: register and attest the SERVICE agents only (FX desks, KYB,
// landlord/bursar/supplier/foundation identities), leave Mirage unattested, mint test units, fund FX
// liquidity and the service passports' gas. It never registers `agent-ying` or `agent-treasurer`: their
// owner DID is the principal's smart-account DID, known only to the agent runtime, which registers them
// itself (apps/agent/src/chain/passport.ts). Writes the result to apps/services/state/<ledger>.json (no
// secrets).
//
// Usage: tsx scripts/setup.ts [--ledger anvil|base-sepolia|fisco] [--rpc <url>] [--no-liquidity]
import { resolve } from "node:path";
import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { sign } from "viem/accounts";
import { abi, type LedgerName } from "@yinglong/sdk";
import { rolePrivateKey, type Role } from "@yinglong/sdk/server";
import { Ledger } from "../src/chain";
import { cardKeysFor, registeredJwksHash } from "../src/cards";
import { SERVICE_AGENTS, type ServiceAgent } from "../src/catalogue";
import { ensureLiquidity } from "../src/fx";
import { jwksOf } from "../src/jose";
import { setupStatePath, writeJsonAtomic, type ServiceState, type SetupState } from "../src/state";

interface Args {
  ledger: LedgerName;
  rpc?: string;
  liquidity: boolean;
  publicUrl: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ledger = (get("--ledger") ?? process.env.LEDGER ?? "anvil") as LedgerName;
  if (!["anvil", "base-sepolia", "fisco"].includes(ledger)) throw new Error(`unknown ledger ${ledger}`);
  return {
    ledger,
    rpc: get("--rpc") ?? process.env.RPC_URL,
    liquidity: !argv.includes("--no-liquidity") && ledger !== "base-sepolia",
    publicUrl: (get("--public-url") ?? process.env.SERVICES_PUBLIC_URL ?? "http://127.0.0.1:8790").replace(/\/+$/, ""),
  };
}

const log = (s: string) => process.stdout.write(`${s}\n`);

/**
 * Make sure a service wallet has an active passport controlled by the dedicated `agent-owner` key and the
 * right card kid / JWKS hash, attested by its issuers (none for Mirage). Idempotent.
 */
async function ensureServicePassport(ledger: Ledger, svc: ServiceAgent): Promise<ServiceState> {
  const registry = ledger.addr("YinglongPassportRegistry");
  const wallet = ledger.roleAddress(svc.role);
  const txs: Hex[] = [];
  let agentId = await ledger.read<bigint>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "agentIdOf", args: [wallet] });
  const controller = ledger.roleAddress("agent-owner");
  const kid = cardKeysFor(svc).registered.kid;
  const jwksHash = registeredJwksHash(svc);

  if (agentId === 0n) {
    await ledger.ensureGas(controller);
    await ledger.ensureGas(wallet);
    const next = await ledger.read<bigint>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "nextAgentId" });
    const deadline = (await ledger.now()) + ledger.span(3600);
    const digest = await ledger.read<Hex>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "bindWalletDigest", args: [next, controller, wallet, deadline] });
    const walletSig = (await sign({ hash: digest, privateKey: rolePrivateKey(svc.role), to: "hex" })) as Hex;
    const res = await ledger.write("agent-owner", {
      address: registry,
      abi: abi.YinglongPassportRegistryAbi,
      functionName: "register",
      args: [
        {
          agentWallet: wallet,
          ownerDidHash: keccak256(stringToBytes(svc.did)),
          passportVcHash: keccak256(stringToBytes(`passport-vc:${svc.slug}:${svc.identityCode}`)),
          provenanceHash: keccak256(stringToBytes(`provenance:${svc.slug}:v1`)),
          enforcerTableHash: keccak256(stringToBytes(JSON.stringify(ledger.deployment.contracts))),
          jwksHash,
          erc8004AgentId: 0n,
          identityCode: svc.identityCode,
          kid,
          registrationURI: `${(process.env.SERVICES_PUBLIC_URL ?? "http://127.0.0.1:8790").replace(/\/+$/, "")}/agents/${svc.slug}/registration.json`,
          deadline,
          walletSig,
        },
      ],
    });
    txs.push(res.hash);
    agentId = await ledger.read<bigint>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "agentIdOf", args: [wallet] });
    log(`  registered ${svc.slug} as agentId ${agentId} (${wallet})`);
  } else {
    // Keep the card binding current (idempotent updates are cheap and make the card verifiable after a rebuild).
    const p = await ledger.read<{ kid: string; jwksHash: Hex; passportVcHash: Hex; provenanceHash: Hex; enforcerTableHash: Hex }>({
      address: registry,
      abi: abi.YinglongPassportRegistryAbi,
      functionName: "passportOf",
      args: [agentId],
    });
    if (p.kid !== kid || p.jwksHash.toLowerCase() !== jwksHash.toLowerCase()) {
      await ledger.ensureGas(controller);
      const res = await ledger.write("agent-owner", {
        address: registry,
        abi: abi.YinglongPassportRegistryAbi,
        functionName: "updateHashes",
        args: [agentId, p.passportVcHash, p.provenanceHash, p.enforcerTableHash, jwksHash, kid],
      });
      txs.push(res.hash);
      log(`  updated ${svc.slug} card binding (kid/jwksHash)`);
    }
  }

  const attestedBy: Address[] = [];
  for (const att of svc.attesters) {
    const issuer = ledger.roleAddress(att.role);
    const already = await ledger.read<boolean>({ address: registry, abi: abi.YinglongPassportRegistryAbi, functionName: "isAttestedBy", args: [agentId, issuer] });
    if (already) {
      attestedBy.push(issuer);
      continue;
    }
    await ledger.ensureGas(issuer);
    const res = await ledger.write(att.role, {
      address: registry,
      abi: abi.YinglongPassportRegistryAbi,
      functionName: "attest",
      args: [agentId, keccak256(stringToBytes(att.claim)), 0n],
    });
    txs.push(res.hash);
    attestedBy.push(issuer);
    log(`  attested ${svc.slug} by ${att.role}`);
  }
  return {
    slug: svc.slug,
    role: svc.role,
    name: svc.name,
    wallet,
    agentId: agentId.toString(),
    controller,
    kid,
    jwksHash,
    identityCode: svc.identityCode,
    attestedBy,
    _txs: txs,
  } as ServiceState & { _txs: Hex[] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ledger = new Ledger(args.ledger, { rpcUrl: args.rpc });
  log(`YINGLONG Agent City setup on ${ledger.name} (${ledger.network}) at ${ledger.profile.rpcUrl}`);
  const txs: { step: string; hash: Hex }[] = [];
  const services: Record<string, ServiceState> = {};

  for (const svc of SERVICE_AGENTS) {
    log(`[passport] ${svc.slug}${svc.kind === "rogue" ? " (rogue: NO attestation)" : ""}`);
    const st = (await ensureServicePassport(ledger, svc)) as ServiceState & { _txs: Hex[] };
    for (const h of st._txs) txs.push({ step: `passport:${svc.slug}`, hash: h });
    delete (st as { _txs?: Hex[] })._txs;
    services[svc.slug] = st;
  }

  // Mint test units to the service payees so the demo can run immediately.
  const minted: Record<string, Record<string, string>> = {};
  if (ledger.name !== "base-sepolia") {
    const tHKD = ledger.addr("TestHKD");
    const tUSD = ledger.addr("TestUSD");
    const seedTargets: { role: Role; tHKD?: bigint; tUSD?: bigint }[] = [
      { role: "agent-ying", tHKD: 20_000_000_000n, tUSD: 3_000_000_000n },
      { role: "svc-scholarship-foundation", tUSD: 100_000_000_000n },
    ];
    await ledger.ensureGas(ledger.roleAddress("deployer"));
    for (const t of seedTargets) {
      const who = ledger.roleAddress(t.role);
      const row: Record<string, string> = {};
      if (t.tHKD) {
        const res = await ledger.write("deployer", { address: tHKD, abi: abi.TestUnitsAbi, functionName: "mint", args: [who, t.tHKD] });
        txs.push({ step: `mint:tHKD:${t.role}`, hash: res.hash });
        row.tHKD = t.tHKD.toString();
      }
      if (t.tUSD) {
        const res = await ledger.write("deployer", { address: tUSD, abi: abi.TestUnitsAbi, functionName: "mint", args: [who, t.tUSD] });
        txs.push({ step: `mint:tUSD:${t.role}`, hash: res.hash });
        row.tUSD = t.tUSD.toString();
      }
      minted[t.role] = row;
      log(`[mint] ${t.role}: ${JSON.stringify(row)}`);
    }
  }

  // Fund FX desk liquidity in SignedQuoteSettlement.
  const liquidity: Record<string, Record<string, string>> = {};
  if (args.liquidity) {
    for (const desk of ["svc-pearl-river-fx", "svc-victoria-fx"] as Role[]) {
      const hk = await ensureLiquidity(ledger, desk, ledger.addr("TestHKD"), 500_000_000_000n);
      const usd = await ensureLiquidity(ledger, desk, ledger.addr("TestUSD"), 50_000_000_000n);
      for (const h of [...hk.txs, ...usd.txs]) txs.push({ step: `liquidity:${desk}`, hash: h });
      liquidity[desk] = {
        tHKD: (await ledger.read<bigint>({ address: ledger.addr("SignedQuoteSettlement"), abi: abi.SignedQuoteSettlementAbi, functionName: "liquidity", args: [ledger.roleAddress(desk), ledger.addr("TestHKD")] })).toString(),
        tUSD: (await ledger.read<bigint>({ address: ledger.addr("SignedQuoteSettlement"), abi: abi.SignedQuoteSettlementAbi, functionName: "liquidity", args: [ledger.roleAddress(desk), ledger.addr("TestUSD")] })).toString(),
      };
      log(`[liquidity] ${desk}: ${JSON.stringify(liquidity[desk])}`);
    }
  }

  const contracts: Record<string, Address> = {};
  for (const name of ["YinglongPassportRegistry", "DelegationManager", "SignedQuoteSettlement", "ConditionalPaymentInstructions", "TestHKD", "TestUSD", "AccountabilityLedger", "KillSwitchRegistry", "PayeeBook", "MandateRegistry", "ERC20TransferAmountEnforcer", "LimitedCallsEnforcer", "TimestampEnforcer"] as const) {
    contracts[name] = ledger.addr(name);
  }

  const state: SetupState = {
    ledger: ledger.name,
    chainId: ledger.profile.chainId,
    updatedAt: new Date().toISOString(),
    label: "YINGLONG Agent City service identities (fictional, test environment). No secrets in this file.",
    contracts,
    services,
    liquidity,
    minted,
    txs,
  };
  const stateDir = process.env.SERVICES_STATE_DIR ? resolve(process.env.SERVICES_STATE_DIR) : resolve(import.meta.dirname, "..", "state");
  const path = setupStatePath(stateDir, ledger.name);
  writeJsonAtomic(path, state);
  // Also publish the aggregated JWKS for convenience.
  writeJsonAtomic(`${stateDir}/jwks-${ledger.name}.json`, jwksOf(SERVICE_AGENTS.map((s) => cardKeysFor(s).registered)));
  log(`\nWrote ${path} (${Object.keys(services).length} service passports, ${txs.length} transactions).`);
}

main().catch((e) => {
  process.stderr.write(`${String((e as Error).stack ?? e)}\n`);
  process.exit(1);
});
