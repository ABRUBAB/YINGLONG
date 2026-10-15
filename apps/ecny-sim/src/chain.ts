// Minimal ledger access for the e-CNY-style simulator: a public client, the operator wallet (the `relayer`
// role, which is the ConditionalPaymentInstructions operator), a per-role send queue for nonce safety, and a
// getLogs wrapper that obeys the FISCO BCOS constraints (address + topics + fromBlock + toBlock all present,
// topics lower-case hex, no blockHash filters, bounded ranges).
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeRevert, ledger as ledgerProfile, revertDataOf, type ContractName, type Deployment, type LedgerName, type LedgerProfile } from "@yinglong/sdk";
import { loadDeployment, roleAddress, rolePrivateKey, type Role } from "@yinglong/sdk/server";

export class Ledger {
  readonly profile: LedgerProfile;
  readonly deployment: Deployment;
  readonly chain: Chain;
  readonly pub: PublicClient;
  private readonly wallets = new Map<Role, WalletClient>();
  private readonly nextNonce = new Map<Role, number>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly name: LedgerName, opts: { rpcUrl?: string } = {}) {
    const base = ledgerProfile(name);
    this.profile = opts.rpcUrl ? { ...base, rpcUrl: opts.rpcUrl } : base;
    this.deployment = loadDeployment(name);
    this.chain = defineChain({
      id: this.profile.chainId,
      name: this.profile.label,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [this.profile.rpcUrl] } },
    });
    this.pub = createPublicClient({ chain: this.chain, cacheTime: 0, pollingInterval: name === "anvil" ? 300 : 1_000, transport: http(this.profile.rpcUrl, { timeout: 30_000 }) }) as PublicClient;
  }

  addr(name: ContractName): Address {
    return this.deployment.contracts[name].address;
  }
  roleAddress(role: Role): Address {
    return roleAddress(role);
  }
  span(seconds: number): bigint {
    return this.profile.timeUnit === "ms" ? BigInt(seconds) * 1000n : BigInt(seconds);
  }
  txOpts(): { type?: "legacy"; gasPrice?: bigint } {
    return this.profile.legacyTx ? { type: "legacy", gasPrice: this.profile.gasPrice ?? 0n } : {};
  }
  explorerTx(h: Hex): string | undefined {
    return this.profile.explorerTx?.(h);
  }

  wallet(role: Role): WalletClient {
    let w = this.wallets.get(role);
    if (!w) {
      w = createWalletClient({ account: privateKeyToAccount(rolePrivateKey(role)), chain: this.chain, transport: http(this.profile.rpcUrl, { timeout: 30_000 }) });
      this.wallets.set(role, w);
    }
    return w;
  }

  async read<T>(call: { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<T> {
    return (await this.pub.readContract(call as never)) as T;
  }

  async blockNumber(): Promise<bigint> {
    return this.pub.getBlockNumber();
  }

  /** Simulate (typed revert) then send, serialised per process so nonces never race. Waits for the receipt. */
  async write(role: Role, call: { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; gas?: bigint }): Promise<{ hash: Hex; receipt: TransactionReceipt; ok: boolean }> {
    const run = this.queue.then(async () => {
      const w = this.wallet(role);
      const account = w.account!;
      try {
        await this.pub.simulateContract({ ...call, account } as never);
      } catch (e) {
        throw new Error(`reverted: ${decodeRevert(revertDataOf(e)).message}`);
      }
      // In-process nonce management: FISCO BCOS and a lagging getTransactionCount make viem's cached nonce go
      // stale between rapid sends, so track the next nonce and refetch after a nonce error.
      let lastErr: unknown;
      let hash: Hex | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        let nonce = this.nextNonce.get(role);
        if (nonce === undefined) nonce = Number(await this.pub.getTransactionCount({ address: account.address, blockTag: "pending" }));
        try {
          hash = await w.writeContract({ ...call, chain: this.chain, account, nonce, ...this.txOpts() } as never);
          this.nextNonce.set(role, nonce + 1);
          break;
        } catch (e) {
          lastErr = e;
          if (!/nonce|noncecheckfail|already known|replacement transaction underpriced/i.test(String((e as Error)?.message ?? e))) throw e;
          this.nextNonce.delete(role);
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      if (!hash) throw lastErr;
      const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      return { hash, receipt, ok: receipt.status === "success" };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** FISCO-safe eth_getLogs: address + topics + fromBlock + toBlock, hex blocks, bounded range. */
  async getLogs(params: { address: Address; topics?: (Hex | Hex[] | null)[]; fromBlock: bigint; toBlock: bigint }): Promise<Log[]> {
    const topics = (params.topics ?? []).map((t) => (t == null ? null : Array.isArray(t) ? t.map((x) => x.toLowerCase() as Hex) : (t.toLowerCase() as Hex)));
    return (await this.pub.request({
      method: "eth_getLogs" as never,
      params: [{ address: params.address.toLowerCase(), topics, fromBlock: `0x${params.fromBlock.toString(16)}`, toBlock: `0x${params.toBlock.toString(16)}` }] as never,
    })) as unknown as Log[];
  }

  async ensureGas(address: Address, minWei = 20_000_000_000_000_000n): Promise<void> {
    if (this.name === "fisco") return;
    const bal = await this.pub.getBalance({ address });
    if (bal >= minWei) return;
    if (this.name === "anvil") {
      await this.pub.request({ method: "anvil_setBalance" as never, params: [address, `0x${(minWei * 20n).toString(16)}`] as never });
      return;
    }
    const w = this.wallet("deployer");
    const hash = await w.sendTransaction({ to: address, value: minWei * 2n - bal, chain: this.chain, account: w.account!, ...this.txOpts() } as never);
    await this.pub.waitForTransactionReceipt({ hash });
    this.nextNonce.delete("deployer"); // raw send bypassed the managed nonce; refetch next time
  }
}
