// The e-CNY-style conditional-payment simulator (plan section 7.1). It plays the operator bank for the
// coin-free mainland rail: it polls ConditionalPaymentInstructions `Instructed` events, applies simple,
// deterministic conditions, and calls `execute` or `reject` with a reason code using the operator key (the
// `relayer` role). It also posts opening balances for demo accounts and keeps a statement per account.
//
// HONEST LABEL (shown on every surface): "e-CNY-style simulator. Not the PBoC sandbox; no connection to PBoC
// or operator-bank systems." Nothing here has monetary value.
import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { abi } from "@yinglong/sdk";
import type { Role } from "@yinglong/sdk/server";
import type { Ledger } from "./chain";
import { readJson, writeJsonAtomic } from "./state";

export const SIM_LABEL = "e-CNY-style simulator. Not the PBoC sandbox; no connection to PBoC or operator-bank systems.";
export const OPERATOR_ROLE: Role = "relayer";

/** Reason codes written into the on-chain `Rejected(reasonCode)` (bytes32 = keccak of the string). */
export const REASONS = {
  payeeNotKnown: "PAYEE_NOT_KNOWN",
  conditionNotMet: "CONDITION_NOT_MET",
  insufficientBalance: "INSUFFICIENT_BALANCE",
  expired: "INSTRUCTION_EXPIRED",
  purposeNotAllowed: "PURPOSE_NOT_ALLOWED",
} as const;
export type ReasonCode = (typeof REASONS)[keyof typeof REASONS];

export const reasonHash = (r: string): Hex => keccak256(stringToBytes(r));

export interface Condition {
  /** keccak256 of the off-chain invoice/delivery document; matches the instruction's conditionHash. */
  conditionHash: Hex;
  kind: "invoice" | "delivery-confirmation" | "none";
  ref: string;
  satisfied: boolean;
  note?: string;
}

export interface KnownAccount {
  address: Address;
  label: string;
  openingBalance?: string;
  isPayee?: boolean;
}

export interface SimState {
  ledger: string;
  /** Next instruction id to process. Polling by id (not by eth_getLogs) works on FISCO BCOS too, whose log
   * endpoint only serves a short recent window. */
  cursorId: number;
  processed: Record<string, ProcessedInstruction>;
  statements: Record<string, StatementEntry[]>;
}

export interface ProcessedInstruction {
  id: number;
  account: Address;
  payee: Address;
  amount: string;
  purposeHash: Hex;
  conditionHash: Hex;
  decision: "executed" | "rejected";
  reason?: ReasonCode;
  txHash: Hex;
  at: string;
}

export interface StatementEntry {
  at: string;
  kind: "opening-balance" | "debit" | "credit" | "rejected";
  instructionId?: number;
  counterparty?: Address;
  amount: string;
  balanceAfter?: string;
  reason?: ReasonCode;
  ref?: Hex;
}

export interface SimConfig {
  ledger: Ledger;
  statePath: string;
  knownAccounts: KnownAccount[];
  conditions: Condition[];
  /** Allowed purpose codes (empty = any). Compared as keccak(purposeString). */
  allowedPurposes: string[];
  startId?: number;
}

export class Simulator {
  readonly ledger: Ledger;
  private readonly statePath: string;
  private readonly known = new Map<string, KnownAccount>();
  private readonly conditions = new Map<string, Condition>();
  private readonly allowedPurposes: Set<string>;
  private state: SimState;
  private running = false;
  private timer?: NodeJS.Timeout;
  private readonly cpi: Address;

  constructor(cfg: SimConfig) {
    this.ledger = cfg.ledger;
    this.statePath = cfg.statePath;
    this.cpi = cfg.ledger.addr("ConditionalPaymentInstructions");
    for (const a of cfg.knownAccounts) this.known.set(a.address.toLowerCase(), a);
    for (const c of cfg.conditions) this.conditions.set(c.conditionHash.toLowerCase(), c);
    this.allowedPurposes = new Set(cfg.allowedPurposes.map((p) => reasonHash(p).toLowerCase()));
    this.state = readJson<SimState>(this.statePath) ?? {
      ledger: cfg.ledger.name,
      cursorId: cfg.startId ?? 0,
      processed: {},
      statements: {},
    };
  }

  snapshot(): SimState {
    return this.state;
  }
  label(): string {
    return SIM_LABEL;
  }

  addCondition(c: Condition): void {
    this.conditions.set(c.conditionHash.toLowerCase(), c);
  }
  setConditionSatisfied(conditionHash: Hex, satisfied: boolean): boolean {
    const c = this.conditions.get(conditionHash.toLowerCase());
    if (!c) return false;
    c.satisfied = satisfied;
    return true;
  }
  listConditions(): Condition[] {
    return [...this.conditions.values()];
  }
  knownAccounts(): KnownAccount[] {
    return [...this.known.values()];
  }

  private persist(): void {
    writeJsonAtomic(this.statePath, this.state);
  }

  private pushStatement(account: Address, entry: StatementEntry): void {
    const key = account.toLowerCase();
    (this.state.statements[key] ??= []).push(entry);
  }

  /** Post opening balances for known accounts that have one and whose on-chain posted balance is still 0. */
  async postOpeningBalances(): Promise<{ account: Address; balance: string; txHash: Hex }[]> {
    const out: { account: Address; balance: string; txHash: Hex }[] = [];
    await this.ledger.ensureGas(this.ledger.roleAddress(OPERATOR_ROLE));
    for (const a of this.known.values()) {
      if (!a.openingBalance) continue;
      const posted = await this.ledger.read<bigint>({ address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "postedBalance", args: [a.address] });
      if (posted > 0n) continue;
      const res = await this.ledger.write(OPERATOR_ROLE, {
        address: this.cpi,
        abi: abi.ConditionalPaymentInstructionsAbi,
        functionName: "postBalance",
        args: [a.address, BigInt(a.openingBalance), keccak256(stringToBytes(`opening:${a.label}`))],
      });
      this.pushStatement(a.address, { at: new Date().toISOString(), kind: "opening-balance", amount: a.openingBalance, balanceAfter: a.openingBalance });
      out.push({ account: a.address, balance: a.openingBalance, txHash: res.hash });
    }
    this.persist();
    return out;
  }

  /** Evaluate one pending instruction. Returns the decision and reason without acting. */
  evaluate(i: { account: Address; payee: Address; amount: bigint; purposeHash: Hex; conditionHash: Hex; validUntil: bigint }, now: bigint, available: bigint): { ok: boolean; reason?: ReasonCode; condition?: Condition } {
    if (i.validUntil !== 0n && now > i.validUntil) return { ok: false, reason: REASONS.expired };
    if (!this.known.get(i.payee.toLowerCase())?.isPayee) return { ok: false, reason: REASONS.payeeNotKnown };
    if (this.allowedPurposes.size > 0 && !this.allowedPurposes.has(i.purposeHash.toLowerCase())) return { ok: false, reason: REASONS.purposeNotAllowed };
    const zero = `0x${"00".repeat(32)}`;
    if (i.conditionHash.toLowerCase() !== zero) {
      const c = this.conditions.get(i.conditionHash.toLowerCase());
      if (!c || !c.satisfied) return { ok: false, reason: REASONS.conditionNotMet, condition: c };
    }
    if (available < i.amount) return { ok: false, reason: REASONS.insufficientBalance };
    return { ok: true };
  }

  /** Process a single instruction id (execute or reject). Idempotent: already-processed ids are skipped. */
  async processInstruction(id: number): Promise<ProcessedInstruction | undefined> {
    if (this.state.processed[String(id)]) return this.state.processed[String(id)];
    const raw = await this.ledger.read<{ account: Address; payee: Address; amount: bigint; purposeHash: Hex; conditionHash: Hex; validUntil: bigint; status: number }>({
      address: this.cpi,
      abi: abi.ConditionalPaymentInstructionsAbi,
      functionName: "instructionOf",
      args: [BigInt(id)],
    });
    if (Number(raw.status) !== 1) return undefined; // not Pending (already settled elsewhere)
    const now = BigInt(Math.floor(Date.now() / 1000)) * (this.ledger.profile.timeUnit === "ms" ? 1000n : 1n);
    const available = await this.ledger.read<bigint>({ address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "balanceOf", args: [raw.account] });
    const verdict = this.evaluate(raw, now, available);

    let processed: ProcessedInstruction;
    if (verdict.ok) {
      const ref = keccak256(stringToBytes(`exec:${id}:${raw.conditionHash}`));
      const res = await this.ledger.write(OPERATOR_ROLE, { address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "execute", args: [BigInt(id), ref] });
      const at = new Date().toISOString();
      processed = { id, account: raw.account, payee: raw.payee, amount: raw.amount.toString(), purposeHash: raw.purposeHash, conditionHash: raw.conditionHash, decision: "executed", txHash: res.hash, at };
      const accBal = await this.ledger.read<bigint>({ address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "postedBalance", args: [raw.account] });
      const payeeBal = await this.ledger.read<bigint>({ address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "postedBalance", args: [raw.payee] });
      this.pushStatement(raw.account, { at, kind: "debit", instructionId: id, counterparty: raw.payee, amount: raw.amount.toString(), balanceAfter: accBal.toString(), ref });
      this.pushStatement(raw.payee, { at, kind: "credit", instructionId: id, counterparty: raw.account, amount: raw.amount.toString(), balanceAfter: payeeBal.toString(), ref });
    } else {
      const reasonCode = verdict.reason ?? REASONS.conditionNotMet;
      const res = await this.ledger.write(OPERATOR_ROLE, { address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "reject", args: [BigInt(id), reasonHash(reasonCode)] });
      const at = new Date().toISOString();
      processed = { id, account: raw.account, payee: raw.payee, amount: raw.amount.toString(), purposeHash: raw.purposeHash, conditionHash: raw.conditionHash, decision: "rejected", reason: reasonCode, txHash: res.hash, at };
      this.pushStatement(raw.account, { at, kind: "rejected", instructionId: id, counterparty: raw.payee, amount: raw.amount.toString(), reason: reasonCode });
    }
    this.state.processed[String(id)] = processed;
    this.persist();
    return processed;
  }

  /**
   * Process every new instruction since the cursor. We poll by sequential instruction id via
   * `instructionCount()` rather than by `Instructed` events, because FISCO BCOS's eth_getLogs only serves a
   * short recent window and would miss older instructions; this path behaves identically on Anvil and FISCO.
   */
  async poll(): Promise<ProcessedInstruction[]> {
    const count = Number(await this.ledger.read<bigint>({ address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "instructionCount", args: [] }));
    const out: ProcessedInstruction[] = [];
    for (let id = this.state.cursorId; id < count; id++) {
      const p = await this.processInstruction(id).catch((e) => {
        process.stderr.write(`[ecny-sim] instruction ${id}: ${String((e as Error).message ?? e)}\n`);
        return undefined;
      });
      if (p) out.push(p);
      // Advance the cursor only past instructions that are no longer pending (processed here or elsewhere).
      if (p || (await this.isSettled(id))) this.state.cursorId = id + 1;
      else break; // a pending instruction we could not act on yet: retry it next poll
    }
    this.persist();
    return out;
  }

  private async isSettled(id: number): Promise<boolean> {
    const raw = await this.ledger.read<{ status: number }>({ address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "instructionOf", args: [BigInt(id)] });
    return Number(raw.status) !== 1;
  }

  start(intervalMs = 3_000): void {
    if (this.running) return;
    this.running = true;
    const tick = () => void this.poll().catch((e) => process.stderr.write(`[ecny-sim] poll: ${String((e as Error).message ?? e)}\n`));
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }
  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  async statement(account: Address): Promise<{ account: Address; label: string; postedBalance: string; available: string; pending: string; entries: StatementEntry[] }> {
    const [posted, available, pending] = await Promise.all([
      this.ledger.read<bigint>({ address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "postedBalance", args: [account] }),
      this.ledger.read<bigint>({ address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "balanceOf", args: [account] }),
      this.ledger.read<bigint>({ address: this.cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "pendingTotal", args: [account] }),
    ]);
    return {
      account,
      label: this.known.get(account.toLowerCase())?.label ?? "(unknown account)",
      postedBalance: posted.toString(),
      available: available.toString(),
      pending: pending.toString(),
      entries: this.state.statements[account.toLowerCase()] ?? [],
    };
  }
}

export const purposeHash = (purpose: string): Hex => keccak256(stringToBytes(purpose));
export const docHashOf = (doc: unknown): Hex => keccak256(stringToBytes(JSON.stringify(doc)));
