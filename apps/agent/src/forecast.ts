import type { Address, Hex } from "viem";
import { abi } from "@yinglong/sdk";
import { decodeCaveat, formatUnits, type Mandate } from "@yinglong/mandate";
import { ledgerContext } from "./chain/ledger";
import { narrate, type Narration } from "./llm/narrate";
import { receiptLog, type ReceiptRecord } from "./receipts";
import { stateOf, type PrincipalId } from "./world";

/**
 * SME treasury: a deterministic 30-day cash forecast. Inputs are all read, never guessed by a model:
 *   - the posted balance (coin-free rail: ConditionalPaymentInstructions.postedBalance; token rails: balanceOf),
 *   - scheduled instructions still pending on the rail (they leave on day 0),
 *   - recurring payroll (the last confirmed payroll run repeats every 30 days; without one, the sealed payroll
 *     budget is assumed due today),
 *   - the trailing 30-day run-rate of confirmed supplier payments,
 * against the sealed reserve floor, plus the velocity headroom left in the current window. A model may explain
 * the result (labelled AI-generated); it never changes a number.
 */
const DAY = 86_400n;
const iso = (s: bigint) => new Date(Number(s) * 1000).toISOString();

export interface ForecastInput {
  now: bigint;
  horizonDays: number;
  symbol: string;
  decimals: number;
  posted: bigint;
  pending: { id: number; payee: Address; payeeLabel: string; amount: bigint; validUntil: bigint }[];
  floor: bigint;
  payroll?: { amount: bigint; nextAt: bigint; source: string; payeeLabel: string };
  supplierTrailing30: bigint;
}

export function computeForecast(f: ForecastInput) {
  const events: { day: number; date: string; kind: "scheduled instruction" | "payroll" | "supplier run-rate"; label: string; amount: bigint }[] = [];
  for (const p of f.pending) events.push({ day: 0, date: iso(f.now), kind: "scheduled instruction", label: `pending instruction ${p.id} to ${p.payeeLabel}`, amount: p.amount });
  if (f.payroll && f.payroll.amount > 0n) {
    for (let t = f.payroll.nextAt < f.now ? f.now : f.payroll.nextAt; t <= f.now + BigInt(f.horizonDays) * DAY; t += 30n * DAY) {
      events.push({ day: Number((t - f.now) / DAY), date: iso(t), kind: "payroll", label: `payroll to ${f.payroll.payeeLabel} (${f.payroll.source})`, amount: f.payroll.amount });
    }
  }
  const perDay = f.supplierTrailing30 / 30n;
  const daily: { day: number; date: string; outflow: bigint; balance: bigint; belowFloor: boolean }[] = [];
  let bal = f.posted;
  let firstBreach: { day: number; date: string; balance: bigint; shortfall: bigint } | null = null;
  let min = f.posted;
  for (let d = 0; d <= f.horizonDays; d++) {
    const dated = events.filter((e) => e.day === d).reduce((s, e) => s + e.amount, 0n);
    const out = dated + (d > 0 ? perDay : 0n);
    bal -= out;
    const below = bal < f.floor;
    const date = iso(f.now + BigInt(d) * DAY);
    daily.push({ day: d, date, outflow: out, balance: bal, belowFloor: below });
    if (bal < min) min = bal;
    if (below && !firstBreach) firstBreach = { day: d, date, balance: bal, shortfall: f.floor - bal };
  }
  if (perDay > 0n) events.push({ day: 1, date: iso(f.now + DAY), kind: "supplier run-rate", label: "trailing 30-day supplier payments, spread per day", amount: perDay });
  const flags: string[] = [];
  if (firstBreach) flags.push(`Projected balance falls below the reserve floor on day ${firstBreach.day}: optional orders would be deferred or the board asked.`);
  else flags.push("Projected balance stays above the reserve floor over the horizon.");
  return {
    symbol: f.symbol,
    decimals: f.decimals,
    horizonDays: f.horizonDays,
    start: { posted: f.posted, pending: f.pending.reduce((s, p) => s + p.amount, 0n) },
    reserveFloor: f.floor,
    events: events.sort((a, b) => a.day - b.day),
    supplierRunRatePerDay: perDay,
    daily,
    minBalance: min,
    headroomAboveFloor: min - f.floor,
    firstBreach,
    flags,
  };
}

export type Forecast = ReturnType<typeof computeForecast>;

export function forecastFacts(name: string, fc: Forecast, velocity: VelocityHeadroom | null): Record<string, unknown> {
  const u = (v: bigint) => formatUnits(v, fc.decimals);
  return {
    company: name,
    unit: fc.symbol,
    horizonDays: fc.horizonDays,
    postedBalance: u(fc.start.posted),
    pendingInstructions: u(fc.start.pending),
    reserveFloor: u(fc.reserveFloor),
    lowestProjectedBalance: u(fc.minBalance),
    headroomAboveFloor: u(fc.headroomAboveFloor),
    firstBreachDay: fc.firstBreach?.day ?? "none",
    payrollRuns: fc.events.filter((e) => e.kind === "payroll").map((e) => ({ day: e.day, amount: u(e.amount) })),
    supplierPerDay: u(fc.supplierRunRatePerDay),
    paymentsLeftToday: velocity?.countLeft,
    outflowLeftToday: velocity ? u(velocity.outflowLeft) : undefined,
  };
}

export function forecastTemplate(name: string, fc: Forecast): string {
  const u = (v: bigint) => `${formatUnits(v, fc.decimals)} ${fc.symbol}`;
  return `${name}: posted balance ${u(fc.start.posted)}; lowest projected balance over ${fc.horizonDays} days ${u(fc.minBalance)} against a reserve floor of ${u(fc.reserveFloor)}. ${
    fc.firstBreach ? `The floor would be breached on day ${fc.firstBreach.day}.` : "The floor holds over the horizon."
  }`;
}

export interface VelocityHeadroom {
  windowSeconds: bigint;
  windowEndsAt: string;
  maxCount: number;
  used: number;
  countLeft: number;
  maxOutflow: bigint;
  outflow: bigint;
  outflowLeft: bigint;
}

export const FORECAST_LABEL =
  "Coin-free instructions and test units. A deterministic projection from posted balance, pending instructions, recurring payroll and the supplier run-rate; not advice and not a bank forecast.";

function lastPayroll(id: string, payroll: { address: string; label: string } | undefined, symbol: string, rows: ReceiptRecord[]) {
  if (!payroll) return undefined;
  const runs = rows.filter((r) => r.principal === id && r.receipt.outcome === "confirmed" && r.payment?.symbol === symbol && r.payment.payee.toLowerCase() === payroll.address.toLowerCase());
  return runs[runs.length - 1];
}

export async function forecastFor(id: PrincipalId, opts: { name: string; days?: number; explain?: boolean }) {
  const st = stateOf(id);
  const ctx = ledgerContext(st.ledger);
  const m = st.mandate as Mandate;
  const asset = m.assets[0]!;
  const block = await ctx.pub.getBlock();
  const now = block.timestamp;
  const isCpi = asset.address.toLowerCase() === ctx.addr("ConditionalPaymentInstructions").toLowerCase();
  const rows = receiptLog.all().filter((r) => r.ledger === st.ledger);

  let posted: bigint;
  const pending: ForecastInput["pending"] = [];
  if (isCpi) {
    const cpi = ctx.addr("ConditionalPaymentInstructions");
    posted = await ctx.read<bigint>({ address: cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "postedBalance", args: [st.account] });
    const pendingTotal = await ctx.read<bigint>({ address: cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "pendingTotal", args: [st.account] });
    if (pendingTotal > 0n) {
      // Scan the most recent instructions for this account's pending ones.
      const n = Number(await ctx.read<bigint>({ address: cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "instructionCount" }));
      const from = Math.max(0, n - 300);
      for (let i = from; i < n; i += 25) {
        const ids = Array.from({ length: Math.min(25, n - i) }, (_, k) => i + k);
        const list = await Promise.all(
          ids.map((j) => ctx.read<{ account: Address; payee: Address; amount: bigint; validUntil: bigint; status: number }>({ address: cpi, abi: abi.ConditionalPaymentInstructionsAbi, functionName: "instructionOf", args: [BigInt(j)] })),
        );
        list.forEach((x, k) => {
          if (x.account.toLowerCase() === st.account.toLowerCase() && Number(x.status) === 1) {
            const label = m.payees.find((p) => p.address.toLowerCase() === x.payee.toLowerCase())?.label ?? x.payee;
            pending.push({ id: ids[k]!, payee: x.payee, payeeLabel: label, amount: x.amount, validUntil: x.validUntil });
          }
        });
      }
    }
  } else {
    posted = await ctx.read<bigint>({ address: asset.address as Address, abi: abi.TestUnitsAbi, functionName: "balanceOf", args: [st.account] });
  }

  const floor = BigInt(m.reserveFloors.find((f) => f.asset === asset.symbol)?.amount ?? "0");
  const payrollPayee = m.payees.find((p) => p.category === "payroll");
  const payrollCap = m.budgets.flatMap((b) => (b.asset === asset.symbol ? b.caps : [])).find((c) => c.category === "payroll");
  const last = lastPayroll(id, payrollPayee, asset.symbol, rows);
  const payroll = payrollPayee
    ? last
      ? { amount: BigInt(last.payment!.amount), nextAt: last.receipt.timestamp + 30n * DAY, source: "repeats the last payroll run every 30 days", payeeLabel: payrollPayee.label }
      : payrollCap
        ? { amount: BigInt(payrollCap.amount), nextAt: now, source: "no payroll run on record: the sealed payroll budget is assumed due today", payeeLabel: payrollPayee.label }
        : undefined
    : undefined;
  const suppliers = new Set(m.payees.filter((p) => p.category === "supplier").map((p) => p.address.toLowerCase()));
  const supplierTrailing30 = rows
    .filter((r) => r.principal === id && r.receipt.outcome === "confirmed" && r.payment?.symbol === asset.symbol && suppliers.has(r.payment.payee.toLowerCase()) && r.receipt.timestamp + 30n * DAY >= now)
    .reduce((s, r) => s + BigInt(r.payment!.amount), 0n);

  // Velocity headroom in the current window (the same counter VelocityEnforcer checks).
  let velocity: VelocityHeadroom | null = null;
  const vrule = st.delegation!.caveats.map((c) => decodeCaveat(c, ctx.deployment)).find((r) => r.kind === "velocity");
  if (vrule && vrule.kind === "velocity") {
    const windowIndex = now / vrule.window;
    const key = await ctx.read<Hex>({ address: ctx.addr("VelocityEnforcer"), abi: abi.VelocityEnforcerAbi, functionName: "usageKey", args: [ctx.addr("DelegationManager"), st.account, windowIndex] });
    const [count, outflow] = await ctx.read<[number, bigint]>({ address: ctx.addr("VelocityEnforcer"), abi: abi.VelocityEnforcerAbi, functionName: "usage", args: [key] });
    velocity = {
      windowSeconds: vrule.window,
      windowEndsAt: iso((windowIndex + 1n) * vrule.window),
      maxCount: vrule.maxCount,
      used: Number(count),
      countLeft: Math.max(0, vrule.maxCount - Number(count)),
      maxOutflow: vrule.maxOutflow,
      outflow,
      outflowLeft: vrule.maxOutflow > outflow ? vrule.maxOutflow - outflow : 0n,
    };
  }

  const fc = computeForecast({ now, horizonDays: Math.min(Math.max(opts.days ?? 30, 1), 90), symbol: asset.symbol, decimals: asset.decimals, posted, pending, floor, payroll, supplierTrailing30 });
  const explanation: Narration = await narrate({
    purpose: "Explain this company's 30-day cash forecast to its directors.",
    facts: forecastFacts(opts.name, fc, velocity),
    fallback: forecastTemplate(opts.name, fc),
    enabled: !!opts.explain,
  });
  return { ...fc, velocity, ledger: st.ledger, block: block.number, rail: isCpi ? "coin-free instructions (e-CNY-style simulator)" : "test token", explanation, label: FORECAST_LABEL };
}
