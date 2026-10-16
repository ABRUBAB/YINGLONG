// Seed principal states into the test data directory: real scenario mandates compiled against the repository's
// anvil deployment, with throwaway role addresses (test/helpers/env.ts). No transaction is sent.
import { keccak256, stringToBytes, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadDeployment } from "@yinglong/sdk/server";
import { compileMandate, lotusHkMandate, lotusShenzhenMandate, nadiaMandate, type Mandate } from "@yinglong/mandate";
import { world, type PrincipalId, type PrincipalState } from "../../src/world";
import { roles } from "./env";

export const deployment = loadDeployment("anvil");
const r = (k: string) => roles[k]!.address;

export function newAccount(): { address: Address; privateKey: `0x${string}` } {
  const pk = generatePrivateKey();
  return { address: privateKeyToAccount(pk).address, privateKey: pk };
}

function put(id: PrincipalId, m: Mandate, account: Address, agent: Address): PrincipalState {
  const compiled = compileMandate(m, deployment);
  const st: PrincipalState = {
    id,
    ledger: "anvil",
    account,
    did: m.principal.did,
    signerLabel: "scripted passkey (software P-256 key)",
    agentWallet: agent,
    agentId: 7n,
    mandate: m,
    mandateHash: compiled.mandateHash,
    delegationHash: compiled.delegationHash,
    delegation: compiled.delegation,
    sealedAt: new Date().toISOString(),
    cosignNonce: 1,
  };
  world.update((w) => {
    w.principals[id] = st;
  });
  return st;
}

export function seedNadia(account: Address = newAccount().address): PrincipalState {
  const m = nadiaMandate(
    deployment,
    {
      account,
      agent: r("agent-ying"),
      harbourHomes: r("svc-harbour-homes"),
      hbuBursar: r("svc-hbu-bursar"),
      foodMart: `0x${keccak256(stringToBytes("kowloon-food-mart")).slice(26)}` as Address,
      issuerHbu: r("issuer-hbu"),
      issuerBank: r("issuer-harbour-digital-bank"),
    },
    { now: Math.floor(Date.now() / 1000), salt: "1", periodLength: 86_400 },
  );
  return put("nadia", m, account, r("agent-ying"));
}

export function seedLotusSz(account: Address = newAccount().address): PrincipalState {
  const m = lotusShenzhenMandate(
    deployment,
    {
      account,
      agent: r("agent-treasurer"),
      shenzhenComponents: r("svc-shenzhen-components"),
      payroll: `0x${keccak256(stringToBytes("lotus-lane-payroll")).slice(26)}` as Address,
      issuerBank: r("issuer-harbour-digital-bank"),
    },
    { now: Math.floor(Date.now() / 1000), salt: "1" },
  );
  return put("lotus-sz", m, account, r("agent-treasurer"));
}

export function seedLotusHk(account: Address = newAccount().address): PrincipalState {
  const m = lotusHkMandate(
    deployment,
    { account, agent: r("agent-treasurer"), kowloonForwarders: r("svc-kowloon-forwarders"), issuerBank: r("issuer-harbour-digital-bank") },
    { now: Math.floor(Date.now() / 1000), salt: "1" },
  );
  return put("lotus-hk", m, account, r("agent-treasurer"));
}

/** Is the local anvil ledger up with this repository's deployment? Chain-reading tests skip otherwise. */
export async function anvilReady(): Promise<boolean> {
  try {
    const res = await fetch(process.env.ANVIL_RPC_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [deployment.contracts.ProtectedPayment.address, "latest"] }),
      signal: AbortSignal.timeout(2000),
    });
    const j = (await res.json()) as { result?: string };
    return !!j.result && j.result.length > 4;
  } catch {
    return false;
  }
}
