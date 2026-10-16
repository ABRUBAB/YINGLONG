// Read-only chain checks for the evidence bundle, through a public JSON-RPC endpoint (for FISCO BCOS the read-only
// proxy at https://api.yinglong-agent.tech/rpc/fisco: the FISCO node accepts batches of at most 8 calls, and the proxy
// applies a per-IP rate limit). Nothing here signs or sends a transaction.
import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, type Address, type Hex } from "viem";

type Call = { method: string; params: unknown[] };
type Out<T> = { result?: T; error?: string };

export class ReadRpc {
  constructor(readonly url: string) {}

  /** JSON-RPC batch in chunks of 8, paced and retried when rate-limited. Each entry gets its own result or error. */
  async batch<T = unknown>(calls: Call[]): Promise<Out<T>[]> {
    const out: Out<T>[] = [];
    for (let i = 0; i < calls.length; i += 8) {
      if (i) await new Promise((s) => setTimeout(s, 250));
      const chunk = calls.slice(i, i + 8).map((c, k) => ({ jsonrpc: "2.0", id: i + k, ...c }));
      type Row = { id: number; result?: T; error?: { message: string } };
      let res: Row[] | undefined;
      for (let attempt = 0; attempt < 6 && !res; attempt++) {
        const r = await fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(chunk) });
        if (r.status === 429) {
          await new Promise((s) => setTimeout(s, 5000 * (attempt + 1)));
          continue;
        }
        const j = (await r.json()) as unknown;
        // Some upstreams answer a one-element batch with a bare object.
        res = Array.isArray(j)
          ? (j as Row[])
          : j && typeof j === "object" && "id" in j && chunk.length === 1
            ? [j as Row]
            : chunk.map((c) => ({ id: c.id, error: { message: JSON.stringify(j).slice(0, 200) } }));
      }
      if (!res) throw new Error(`${this.url}: rate limited`);
      const byId = new Map(res.map((x) => [x.id, x]));
      for (const c of chunk) {
        const x = byId.get(c.id);
        out.push(x?.error ? { error: x.error.message } : { result: x?.result });
      }
    }
    return out;
  }

  async req<T>(method: string, params: unknown[]): Promise<T> {
    const [o] = await this.batch<T>([{ method, params }]);
    if (!o || o.error) throw new Error(`${method}: ${o?.error ?? "no response"}`);
    return o.result as T;
  }
  blockNumber = async () => Number(BigInt(await this.req<Hex>("eth_blockNumber", [])));
}

const GETTERS = ["owner", "pendingOwner", "admin", "pendingAdmin", "supervisor", "pendingSupervisor", "minter", "operator", "registrar", "guardian"] as const;

export interface RoleScan {
  ledger: string;
  block: number;
  deployers: Address[];
  contracts: number;
  getterCalls: number;
  held: string[];
  other: { contract: string; getter: string; holder: Address }[];
}

/**
 * For every deployed contract, call each zero-argument role getter (owner(), admin(), supervisor(), minter(),
 * operator(), registrar(), ...) and AccountabilityLedger.isAnchorer(deployer); list every role a deployer key still
 * holds. Deployer keys: the deployment file's deployer plus the senders of any deployment transactions it records.
 * Contracts that do not implement a getter revert and are skipped.
 */
export async function scanDeployerRoles(rpc: ReadRpc, ledger: string, dep: Record<string, unknown>): Promise<RoleScan> {
  const deployers = new Set<string>();
  if (typeof dep.deployer === "string") deployers.add(getAddress(dep.deployer));
  const txs = Object.values(dep)
    .map((v) => (v && typeof v === "object" ? (v as { txHash?: string }).txHash : undefined))
    .filter((h): h is string => !!h);
  for (const t of await rpc.batch<{ from: Address } | null>(txs.map((h) => ({ method: "eth_getTransactionByHash", params: [h] })))) {
    if (t.result?.from) deployers.add(getAddress(t.result.from));
  }
  const entries = Object.entries(dep).filter(([, v]) => v && typeof v === "object" && "address" in v) as [string, { address: string }][];
  const calls: { name: string; getter: string; call: Call; abi: ReturnType<typeof parseAbi>; fn: string }[] = [];
  for (const [name, v] of entries) {
    const to = getAddress(v.address);
    for (const g of GETTERS) {
      const abi = parseAbi([`function ${g}() view returns (address)`]);
      calls.push({ name, getter: `${g}()`, abi, fn: g, call: { method: "eth_call", params: [{ to, data: encodeFunctionData({ abi, functionName: g }) }, "latest"] } });
    }
    if (name === "AccountabilityLedger") {
      const abi = parseAbi(["function isAnchorer(address) view returns (bool)"]);
      for (const d of deployers) calls.push({ name, getter: "isAnchorer(deployer)", abi, fn: "isAnchorer", call: { method: "eth_call", params: [{ to, data: encodeFunctionData({ abi, functionName: "isAnchorer", args: [d as Address] }) }, "latest"] } });
    }
  }
  const res = await rpc.batch<Hex>(calls.map((c) => c.call));
  const held: string[] = [];
  const other: RoleScan["other"] = [];
  calls.forEach((c, i) => {
    const out = res[i]?.result;
    if (!out || out === "0x" || out.length !== 66) return;
    try {
      const v = decodeFunctionResult({ abi: c.abi, functionName: c.fn, data: out } as never) as unknown;
      if (typeof v === "boolean") {
        if (v) held.push(`${c.name}.${c.getter}`);
        return;
      }
      const holder = getAddress(v as Address);
      if (BigInt(holder) === 0n) return;
      if (deployers.has(holder)) held.push(`${c.name}.${c.getter}`);
      else other.push({ contract: c.name, getter: c.getter, holder });
    } catch {
      /* not an address */
    }
  });
  return { ledger, block: await rpc.blockNumber(), deployers: [...deployers] as Address[], contracts: entries.length, getterCalls: calls.length, held, other };
}

/** Runtime code hashes read live (keccak256 of eth_getCode). */
export async function liveCodeHashes(rpc: ReadRpc, addrs: Address[]): Promise<(Hex | undefined)[]> {
  const res = await rpc.batch<Hex>(addrs.map((a) => ({ method: "eth_getCode", params: [a, "latest"] })));
  return res.map((r) => (r.result && r.result !== "0x" ? keccak256(r.result) : undefined));
}

/** owner() of a DeleGator account (address(0) means no ECDSA owner). */
export async function accountOwner(rpc: ReadRpc, account: Address): Promise<Address | undefined> {
  const abi = parseAbi(["function owner() view returns (address)"]);
  try {
    const out = await rpc.req<Hex>("eth_call", [{ to: account, data: encodeFunctionData({ abi, functionName: "owner" }) }, "latest"]);
    return getAddress(decodeFunctionResult({ abi, functionName: "owner", data: out }) as Address);
  } catch {
    return undefined;
  }
}

/** gasUsed of each transaction hash (undefined when the receipt is not found). */
export async function gasUsed(rpc: ReadRpc, hashes: string[]): Promise<(bigint | undefined)[]> {
  const res = await rpc.batch<{ gasUsed: Hex } | null>(hashes.map((h) => ({ method: "eth_getTransactionReceipt", params: [h] })));
  return res.map((r) => (r.result?.gasUsed ? BigInt(r.result.gasUsed) : undefined));
}
