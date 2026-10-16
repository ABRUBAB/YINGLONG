import type { Hex } from "viem";

export type LedgerName = "anvil" | "base-sepolia" | "fisco";

export interface LedgerProfile {
  name: LedgerName;
  label: string;
  /** EIP-155 chain id used by RPC and wallets. */
  chainId: number;
  /** Value the CHAINID opcode returns inside contracts (FISCO BCOS may return 0). Resolved at runtime. */
  evmChainId?: number;
  rpcUrl: string;
  /** Unit of block.timestamp on this ledger. */
  timeUnit: "s" | "ms";
  legacyTx: boolean;
  gasPrice?: bigint;
  explorerTx?: (hash: Hex) => string;
  explorerAddress?: (address: string) => string;
  /** Short honest label shown next to every hash from this ledger. */
  badge: string;
}

const env = (k: string): string | undefined => (typeof process !== "undefined" ? process.env?.[k] : undefined);

export const LEDGERS: Record<LedgerName, LedgerProfile> = {
  anvil: {
    name: "anvil",
    label: "Local Anvil (bench)",
    chainId: 31337,
    rpcUrl: env("ANVIL_RPC_URL") ?? "http://127.0.0.1:8645",
    timeUnit: "s",
    legacyTx: false,
    badge: "Anvil bench (simulated)",
  },
  "base-sepolia": {
    name: "base-sepolia",
    label: "Base Sepolia (public testnet)",
    chainId: 84532,
    rpcUrl: env("BASE_SEPOLIA_RPC_URL") ?? "https://sepolia.base.org",
    timeUnit: "s",
    legacyTx: false,
    explorerTx: (h) => `https://sepolia.basescan.org/tx/${h}`,
    explorerAddress: (a) => `https://sepolia.basescan.org/address/${a}`,
    badge: "Base Sepolia (testnet)",
  },
  fisco: {
    name: "fisco",
    label: "FISCO BCOS 3.17.1 (consortium ledger)",
    chainId: Number(env("FISCO_CHAIN_ID") ?? 20200),
    rpcUrl: env("FISCO_RPC_URL") ?? "http://127.0.0.1:8545",
    timeUnit: (env("FISCO_TIME_UNIT") as "s" | "ms" | undefined) ?? "s",
    legacyTx: true,
    gasPrice: 0n,
    // FISCO has no public explorer: the web app decodes the transaction (JSON at /v1/tx/fisco/<hash> on the API).
    explorerTx: (h) => `https://app.yinglong-agent.tech/proof/tx/fisco/${h}`,
    badge: "FISCO BCOS (team-run consortium ledger)",
  },
};

export function ledger(name: LedgerName): LedgerProfile {
  const l = LEDGERS[name];
  if (!l) throw new Error(`unknown ledger ${name}`);
  return l;
}

/** Convert seconds to the ledger's timestamp unit. */
export function toLedgerTime(profile: LedgerProfile, seconds: number | bigint): bigint {
  const s = BigInt(seconds);
  return profile.timeUnit === "ms" ? s * 1000n : s;
}
