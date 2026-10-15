// Ledger access for the Agent City services: one profile + deployment + viem clients per ledger, role
// wallets loaded through @yinglong/sdk/server (keys are read at runtime and never logged), a per-role send
// queue so concurrent requests never race on nonces, and typed revert decoding.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  decodeRevert,
  ledger as ledgerProfile,
  revertDataOf,
  type ContractName,
  type DecodedRevert,
  type Deployment,
  type LedgerName,
  type LedgerProfile,
} from "@yinglong/sdk";
import { loadDeployment, roleAddress, rolePrivateKey, type Role } from "@yinglong/sdk/server";

export class RevertError extends Error {
  constructor(
    readonly revert: DecodedRevert,
    readonly original?: unknown,
    readonly txHash?: Hex,
  ) {
    super(`reverted: ${revert.message}`);
  }
}

export interface ContractCall {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

export interface WriteResult {
  hash: Hex;
  receipt: TransactionReceipt;
  ok: boolean;
}

const NONCE_ERRORS = /nonce too low|nonce has already been used|replacement transaction underpriced|already known|nonce too high|noncecheckfail|invalid nonce/i;

export class Ledger {
  readonly profile: LedgerProfile;
  readonly deployment: Deployment;
  readonly chain: Chain;
  readonly pub: PublicClient;
  private readonly wallets = new Map<Role, WalletClient>();
  private readonly nextNonce = new Map<Role, number>();
  private readonly queues = new Map<Role, Promise<unknown>>();

  constructor(
    readonly name: LedgerName,
    opts: { rpcUrl?: string; deployment?: Deployment } = {},
  ) {
    const base = ledgerProfile(name);
    this.profile = opts.rpcUrl ? { ...base, rpcUrl: opts.rpcUrl } : base;
    this.deployment = opts.deployment ?? loadDeployment(name);
    this.chain = defineChain({
      id: this.profile.chainId,
      name: this.profile.label,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [this.profile.rpcUrl] } },
    });
    this.pub = createPublicClient({
      chain: this.chain,
      cacheTime: 0,
      pollingInterval: name === "anvil" ? 250 : 1_000,
      transport: http(this.profile.rpcUrl, { timeout: 30_000 }),
    }) as PublicClient;
  }

  /** CAIP-2 network id used by x402 v2 (the RPC chain id, also on FISCO BCOS). */
  get network(): string {
    return `eip155:${this.profile.chainId}`;
  }

  addr(name: ContractName): Address {
    return this.deployment.contracts[name].address;
  }

  roleAddress(role: Role): Address {
    return roleAddress(role);
  }

  wallet(role: Role): WalletClient {
    let w = this.wallets.get(role);
    if (!w) {
      w = createWalletClient({
        account: privateKeyToAccount(rolePrivateKey(role)),
        chain: this.chain,
        transport: http(this.profile.rpcUrl, { timeout: 30_000 }),
      });
      this.wallets.set(role, w);
    }
    return w;
  }

  /** FISCO BCOS takes legacy transactions with gas price 0. */
  txOpts(): { type?: "legacy"; gasPrice?: bigint } {
    return this.profile.legacyTx ? { type: "legacy", gasPrice: this.profile.gasPrice ?? 0n } : {};
  }

  /** Seconds (or milliseconds on an ms ledger) to add to a ledger timestamp. */
  span(seconds: number | bigint): bigint {
    const s = BigInt(seconds);
    return this.profile.timeUnit === "ms" ? s * 1000n : s;
  }

  /** Current time in the ledger's unit: the later of the wall clock and the latest block timestamp. */
  async now(): Promise<bigint> {
    const block = await this.pub.getBlock({ blockTag: "latest" });
    const wallSeconds = BigInt(Math.floor(Date.now() / 1000));
    const wall = this.profile.timeUnit === "ms" ? wallSeconds * 1000n : wallSeconds;
    return block.timestamp > wall ? block.timestamp : wall;
  }

  async read<T>(call: ContractCall): Promise<T> {
    return (await this.pub.readContract(call as never)) as T;
  }

  /** Run `fn` after every earlier send of the same role has finished (nonce safety inside this process). */
  private serial<T>(role: Role, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(role) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(
      role,
      next.catch(() => undefined),
    );
    return next;
  }

  /** Simulate (typed revert on failure), then broadcast; returns the hash without waiting for a receipt. */
  async send(role: Role, call: ContractCall & { gas?: bigint; skipSimulation?: boolean }): Promise<Hex> {
    return this.serial(role, async () => {
      const w = this.wallet(role);
      const account = w.account!;
      if (!call.skipSimulation) {
        try {
          await this.pub.simulateContract({ ...call, account } as never);
        } catch (e) {
          throw new RevertError(decodeRevert(revertDataOf(e)), e);
        }
      }
      let lastErr: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        // Manage the nonce in-process: FISCO BCOS and a lagging getTransactionCount both make viem's cached
        // nonce go stale between rapid sends, so we track the next nonce and refetch it after a nonce error.
        let nonce = this.nextNonce.get(role);
        if (nonce === undefined) nonce = Number(await this.pub.getTransactionCount({ address: account.address, blockTag: "pending" }));
        try {
          const hash = await w.writeContract({ ...call, chain: this.chain, account, nonce, ...this.txOpts() } as never);
          this.nextNonce.set(role, nonce + 1);
          return hash;
        } catch (e) {
          lastErr = e;
          if (!NONCE_ERRORS.test(String((e as Error)?.message ?? e))) throw e;
          this.nextNonce.delete(role); // force a fresh getTransactionCount on the next attempt
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      throw lastErr;
    });
  }

  /** Wait for a receipt; a reverted transaction is replayed at its parent block to recover the reason. */
  async wait(hash: Hex, timeoutMs = 120_000): Promise<WriteResult> {
    const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: timeoutMs });
    return { hash, receipt, ok: receipt.status === "success" };
  }

  async write(role: Role, call: ContractCall & { gas?: bigint; skipSimulation?: boolean }, timeoutMs = 120_000): Promise<WriteResult> {
    const hash = await this.send(role, call);
    const res = await this.wait(hash, timeoutMs);
    if (!res.ok) throw new RevertError(await this.replayRevert(hash), undefined, hash);
    return res;
  }

  /** Recover the revert reason of a mined, failed transaction by replaying it with eth_call at the parent block. */
  async replayRevert(hash: Hex): Promise<DecodedRevert> {
    try {
      const tx = await this.pub.getTransaction({ hash });
      await this.pub.call({
        account: tx.from,
        to: tx.to ?? undefined,
        data: tx.input,
        value: tx.value,
        blockNumber: tx.blockNumber && tx.blockNumber > 0n ? tx.blockNumber - 1n : undefined,
      });
      return decodeRevert(undefined);
    } catch (e) {
      return decodeRevert(revertDataOf(e));
    }
  }

  /** Make sure an address can pay gas: Anvil sets the balance, Base Sepolia tops up from the deployer, FISCO is free. */
  async ensureGas(address: Address, minWei = 50_000_000_000_000_000n): Promise<void> {
    if (this.name === "fisco") return;
    const bal = await this.pub.getBalance({ address });
    if (bal >= minWei) return;
    if (this.name === "anvil") {
      await this.pub.request({ method: "anvil_setBalance" as never, params: [address, `0x${(minWei * 20n).toString(16)}`] as never });
      return;
    }
    const w = this.wallet("deployer");
    await this.serial("deployer", async () => {
      const hash = await w.sendTransaction({ to: address, value: minWei * 2n - bal, chain: this.chain, account: w.account!, ...this.txOpts() } as never);
      await this.pub.waitForTransactionReceipt({ hash });
      this.nextNonce.delete("deployer"); // this raw send bypassed the managed nonce; refetch next time
    });
  }

  explorerTx(hash: Hex): string | undefined {
    return this.profile.explorerTx?.(hash);
  }
}

const cache = new Map<string, Ledger>();

/** Shared Ledger instance per (name, rpc url). */
export function ledgerFor(name: LedgerName, rpcUrl?: string): Ledger {
  const key = `${name}|${rpcUrl ?? ""}`;
  let l = cache.get(key);
  if (!l) {
    l = new Ledger(name, { rpcUrl });
    cache.set(key, l);
  }
  return l;
}
