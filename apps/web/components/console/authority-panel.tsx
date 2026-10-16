"use client";

import { ViewTransition } from "react";
import { AuthorityOrbits, HashRing, LabelChip, OrbitGauge, shortHash, StateRing } from "@yinglong/ui";
import type { BudgetLane } from "@/lib/api/view";
import { useAgent } from "@/lib/api/hooks";
import { formatUnits, remaining, TIER_LABEL, TIER_WHO } from "@/lib/format";
import { AmountFlow } from "@/components/data/amount-flow";
import { ErrorLine, Loading, TierBadge, TxLink } from "@/components/data/parts";
import { compareHashRing } from "@/lib/hash-ring-check";

export function LaneGauge({ lane, size = 104 }: { lane: BudgetLane; size?: number }) {
  const left = remaining(lane.cap, lane.spent);
  const periodWord = lane.period === "month" ? "this month" : lane.period === "day" ? "today" : lane.period === "week" ? "this week" : lane.period === "once" ? "once" : "in the window";
  return (
    <OrbitGauge
      size={size}
      label={lane.label}
      spent={BigInt(lane.spent.value)}
      cap={BigInt(lane.cap.value)}
      floor={lane.floor ? BigInt(lane.floor.value) : undefined}
      breachForecast={lane.breachForecastDays !== null}
      center={
        <>
          <span className="font-mono text-13 leading-none text-fg-0 tabular">
            <AmountFlow value={left} decimals={lane.cap.decimals} fractionDigits={0} />
          </span>
          <span className="mt-1 text-[10px] leading-none text-fg-muted">left</span>
        </>
      }
      caption={
        <>
          of <span className="font-mono">{formatUnits(lane.cap.value, lane.cap.decimals, 0)}</span> {lane.cap.symbol} {periodWord}
        </>
      }
    />
  );
}

const TIERS = ["T0", "T1", "T2", "T3", "T4", "ASK"] as const;

/** Right Authority panel: the live mandate as orbit gauges, the Hash Ring, authority orbits, tiers. */
export function AuthorityPanel({ morph = false }: { morph?: boolean }) {
  const mandates = useAgent("mandates", (api) => api.mandates(), ["mandates"]);
  const budgets = useAgent("budgets", (api) => api.budgets(), ["budgets", "receipts"]);
  const me = useAgent("me", (api) => api.me(), ["me", "pause"]);
  const live = mandates.data?.find((m) => m.status === "live");
  const ringCheck = live ? compareHashRing(live.delegationHash, live.serviceHashRing) : "absent";
  const paused = me.data?.paused ?? false;

  return (
    <div className="grid gap-7">
      <section aria-labelledby="ap-mandate" className="grid gap-4">
        <div>
          <p className="eyebrow m-0 text-fg-muted">Authority</p>
          <h2 id="ap-mandate" className="m-0 mt-0.5 text-15 font-semibold text-fg-0">
            {live ? `Mandate v${live.version}` : "No live mandate"}
          </h2>
        </div>
        <ErrorLine error={mandates.error} />
        {mandates.loading ? <Loading rows={2} /> : null}
        {live ? (
          <div className="grid justify-items-center gap-3">
            {morph ? (
              <ViewTransition name="mandate-ring">
                <HashRing hash={live.delegationHash} size={168} phase={paused ? "draft" : "sealed"} bare={false} />
              </ViewTransition>
            ) : (
              <HashRing hash={live.delegationHash} size={168} phase={paused ? "draft" : "sealed"} bare={false} />
            )}
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5">
              <StateRing state={paused ? "paused" : "sealed"} size={16} label={paused ? "Paused" : "Sealed"} />
              {live.published.slice(0, 2).map((t) => (
                <TxLink key={t.txHash} ledger={t.ledger} hash={t.txHash} href={t.explorerUrl} badge={t.badge} label="Published" />
              ))}
            </div>
            {ringCheck !== "absent" ? (
              <StateRing
                state={ringCheck === "match" ? "verified" : "refused"}
                size={16}
                label={ringCheck === "match" ? "Agent service computes the same ring" : "Agent service ring differs"}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="ap-budgets" className="grid gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="ap-budgets" className="m-0 text-13 font-semibold text-fg-0">
            Budgets
          </h2>
          <span className="text-11 text-fg-muted">chrome = spent</span>
        </div>
        <ErrorLine error={budgets.error} />
        {budgets.loading ? <Loading rows={2} /> : null}
        <div className="grid grid-cols-2 gap-x-3 gap-y-5">
          {(budgets.data ?? []).map((l) => (
            <LaneGauge key={l.id} lane={l} />
          ))}
        </div>
        {budgets.data?.some((l) => l.floor) ? (
          <p className="m-0 text-11 text-fg-muted">
            The tick on a ring marks the reserve floor. It turns brass only when a breach is forecast.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="ap-orbits" className="grid gap-3">
        <h2 id="ap-orbits" className="m-0 text-13 font-semibold text-fg-0">
          Who acts inside whom
        </h2>
        <AuthorityOrbits
          size={208}
          root={{
            id: "owner",
            label: me.data?.displayName ?? "Owner",
            sublabel: "passkey",
            status: "active",
            children: [
              {
                id: "agent",
                label: me.data?.agentName ?? "Agent",
                sublabel: me.data ? `passport ${me.data.agentId}` : undefined,
                identity: true,
                status: paused ? "paused" : "active",
                children: [
                  { id: "x402", label: "x402 child", sublabel: "single use, exact amount", status: paused ? "paused" : "active" },
                  { id: "escrow", label: "Escrow child", sublabel: "tuition only", status: paused ? "paused" : "active" },
                ],
              },
            ],
          }}
        />
      </section>

      <section aria-labelledby="ap-tiers" className="grid gap-2">
        <h2 id="ap-tiers" className="m-0 text-13 font-semibold text-fg-0">
          Tiers
        </h2>
        <table className="yl-table">
          <caption className="sr-only">Permission tiers and who decides</caption>
          <tbody>
            {TIERS.map((t) => (
              <tr key={t}>
                <td className="w-12">
                  <TierBadge tier={t} />
                </td>
                <td className="text-12 text-fg-1">{TIER_LABEL[t]}</td>
                <td className="text-12 text-fg-muted">{TIER_WHO[t]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 text-11 text-fg-muted">
          An AI signal can only raise a tier. Only deterministic rules refuse.
        </p>
      </section>

      {me.data ? (
        <section aria-labelledby="ap-passport" className="grid gap-2">
          <h2 id="ap-passport" className="m-0 text-13 font-semibold text-fg-0">
            Passport
          </h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-12">
            <dt className="text-fg-muted">Agent</dt>
            <dd className="m-0 text-fg-1">
              {me.data.agentName} <span className="font-mono text-fg-muted">#{me.data.agentId}</span>
            </dd>
            <dt className="text-fg-muted">Account</dt>
            <dd className="m-0 font-mono text-fg-2" title={me.data.account}>
              {shortHash(me.data.account, 8, 6)}
            </dd>
            <dt className="text-fg-muted">Signer</dt>
            <dd className="m-0 text-fg-2">{me.data.signer}</dd>
          </dl>
          <LabelChip dotted className="justify-self-start">
            Identity code: placeholder, not issued
          </LabelChip>
        </section>
      ) : null}
    </div>
  );
}
