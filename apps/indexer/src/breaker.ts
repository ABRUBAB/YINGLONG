// The breaker watcher (plan section 9.4): it holds the `breaker-watcher` key, which an account configures as
// one of its KillSwitchRegistry guardians. On a trip request from the agent or the signer, it calls
// KillSwitchRegistry.trip(account) on the configured ledger(s). It can only pause, never unpause or spend.
import { abi, type LedgerName } from "@yinglong/sdk";
import { getAddress, type Address, type Hex } from "viem";
import { Ledger } from "./chain";
import type { IndexerConfig } from "./config";

const BREAKER_ROLE = "breaker-watcher" as const;

export interface TripResult {
  ledger: LedgerName;
  account: Address;
  reason: string;
  isGuardian: boolean;
  tripped: boolean;
  txHash?: Hex;
  error?: string;
}

export class BreakerWatcher {
  private readonly ledgers = new Map<LedgerName, Ledger>();

  constructor(private readonly config: IndexerConfig) {
    for (const name of config.breakerLedgers) this.ledgers.set(name, new Ledger(name, { rpcUrl: config.rpcUrls[name] }));
  }

  private ledger(name: LedgerName): Ledger {
    const l = this.ledgers.get(name);
    if (!l) throw new Error(`ledger ${name} is not configured for the breaker`);
    return l;
  }

  ledgerNames(): LedgerName[] {
    return [...this.ledgers.keys()];
  }

  async status(account: Address, ledgerName?: LedgerName): Promise<{ ledger: LedgerName; tripped: boolean; isGuardian: boolean; watcher: Address }[]> {
    const names = ledgerName ? [ledgerName] : this.ledgerNames();
    return Promise.all(
      names.map(async (name) => {
        const ledger = this.ledger(name);
        const ks = ledger.addr("KillSwitchRegistry");
        const watcher = ledger.roleAddress(BREAKER_ROLE);
        const [tripped, isGuardian] = await Promise.all([
          ledger.read<boolean>({ address: ks, abi: abi.KillSwitchRegistryAbi, functionName: "tripped", args: [account] }),
          ledger.read<boolean>({ address: ks, abi: abi.KillSwitchRegistryAbi, functionName: "isGuardian", args: [account, watcher] }),
        ]);
        return { ledger: name, tripped, isGuardian, watcher };
      }),
    );
  }

  /** Trip the kill switch for `account` on the given ledger (default: all configured). Idempotent. */
  async trip(account: Address, reason: string, ledgerName?: LedgerName): Promise<TripResult[]> {
    const who = getAddress(account);
    const names = ledgerName ? [ledgerName] : this.ledgerNames();
    const out: TripResult[] = [];
    for (const name of names) {
      const ledger = this.ledger(name);
      const ks = ledger.addr("KillSwitchRegistry");
      const watcher = ledger.roleAddress(BREAKER_ROLE);
      const base: TripResult = { ledger: name, account: who, reason, isGuardian: false, tripped: false };
      try {
        const alreadyTripped = await ledger.read<boolean>({ address: ks, abi: abi.KillSwitchRegistryAbi, functionName: "tripped", args: [who] });
        base.isGuardian = await ledger.read<boolean>({ address: ks, abi: abi.KillSwitchRegistryAbi, functionName: "isGuardian", args: [who, watcher] });
        if (alreadyTripped) {
          out.push({ ...base, tripped: true });
          continue;
        }
        if (!base.isGuardian) {
          out.push({ ...base, error: "breaker watcher is not a guardian of this account; it cannot trip the kill switch" });
          continue;
        }
        await ledger.ensureGas(watcher);
        const res = await ledger.write(BREAKER_ROLE, { address: ks, abi: abi.KillSwitchRegistryAbi, functionName: "trip", args: [who] });
        out.push({ ...base, tripped: true, txHash: res.hash });
      } catch (e) {
        out.push({ ...base, error: String((e as Error).message ?? e).slice(0, 300) });
      }
    }
    return out;
  }
}
