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
import { decodeRevert, ledger as ledgerProfile, revertDataOf, type DecodedRevert, type Deployment, type LedgerName, type LedgerProfile } from "@yinglong/sdk";
import { loadDeployment, roleAddress, rolePrivateKey, type Role } from "@yinglong/sdk/server";

export interface WriteResult {
  hash: Hex;
  receipt: TransactionReceipt;
  ok: boolean;
}

/** Everything the agent needs to act on one ledger: profile, deployment, clients and role wallets. */
export class LedgerContext {
  readonly profile: LedgerProfile;
  readonly deployment: Deployment;
  readonly chain: Chain;
  readonly pub: PublicClient;
  private wallets = new Map<string, WalletClient>();

  constructor(readonly name: LedgerName) {
    this.profile = ledgerProfile(name);
    this.deployment = loadDeployment(name);
    this.chain = defineChain({
      id: this.profile.chainId,
      name: this.profile.label,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [this.profile.rpcUrl] } },
    });
    this.pub = createPublicClient({ chain: this.chain, cacheTime: 0, transport: http(this.profile.rpcUrl, { timeout: 30_000 }) }) as PublicClient;
  }

  addr(name: keyof Deployment["contracts"]): Address {
    return this.deployment.contracts[name].address;
  }

  wallet(role: Role): WalletClient {
    let w = this.wallets.get(role);
    if (!w) {
      w = createWalletClient({ account: privateKeyToAccount(rolePrivateKey(role)), chain: this.chain, transport: http(this.profile.rpcUrl) });
      this.wallets.set(role, w);
    }
    return w;
  }

  roleAddress(role: Role): Address {
    return roleAddress(role);
  }

  /** Transaction options for this ledger (FISCO BCOS: legacy transactions with gas price 0). */
  txOpts(): { type?: "legacy"; gasPrice?: bigint } {
    return this.profile.legacyTx ? { type: "legacy", gasPrice: this.profile.gasPrice ?? 0n } : {};
  }

  /** Simulate then send a contract write from a role; returns the receipt. Throws a decoded revert. */
  async write(role: Role, call: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; gas?: bigint }): Promise<WriteResult> {
    const w = this.wallet(role);
    try {
      await this.pub.simulateContract({ ...call, account: w.account! } as never);
    } catch (e) {
      throw new RevertError(decodeRevert(revertDataOf(e)), e);
    }
    const hash = await w.writeContract({ ...call, chain: this.chain, account: w.account!, ...this.txOpts() } as never);
    const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    return { hash, receipt, ok: receipt.status === "success" };
  }

  async read<T>(call: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<T> {
    return (await this.pub.readContract(call as never)) as T;
  }

  /** Make sure `address` can pay gas (anvil: set balance; Base: top up from the deployer; FISCO: gas is free). */
  async ensureGas(address: Address, requestedWei: bigint): Promise<void> {
    if (this.name === "fisco") return;
    // Base Sepolia gas is cheap (about 0.006 gwei): 0.0005 ETH per role covers hundreds of transactions.
    const minWei = this.name === "base-sepolia" && requestedWei > 500_000_000_000_000n ? 500_000_000_000_000n : requestedWei;
    const bal = await this.pub.getBalance({ address });
    if (bal >= minWei) return;
    if (this.name === "anvil") {
      await this.pub.request({ method: "anvil_setBalance" as never, params: [address, `0x${(minWei * 10n).toString(16)}`] as never });
      return;
    }
    const w = this.wallet("deployer");
    const hash = await w.sendTransaction({ to: address, value: minWei * 2n - bal, chain: this.chain, account: w.account! });
    await this.pub.waitForTransactionReceipt({ hash });
  }

  explorerTx(hash: Hex): string | undefined {
    return this.profile.explorerTx?.(hash);
  }
}

export class RevertError extends Error {
  constructor(
    readonly revert: DecodedRevert,
    readonly original?: unknown,
  ) {
    super(`reverted: ${revert.message}`);
  }
}

const contexts = new Map<LedgerName, LedgerContext>();
export function ledgerContext(name: LedgerName): LedgerContext {
  let c = contexts.get(name);
  if (!c) {
    c = new LedgerContext(name);
    contexts.set(name, c);
  }
  return c;
}
