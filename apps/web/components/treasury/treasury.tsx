"use client";

import { useEffect, useState } from "react";
import { cn, LabelChip, StateRing } from "@yinglong/ui";
import type { DirectorProposal, TreasuryEntity, TreasuryView } from "@/lib/api/view";
import { ApiRequestError, getApi, isSample } from "@/lib/api";
import { invalidate, useAgent } from "@/lib/api/hooks";
import { formatAmount, formatDay, formatTime } from "@/lib/format";
import { Segmented } from "@/components/ui/controls";
import { Button } from "@/components/ui/button";
import { ErrorLine, LedgerChip, Loading, TierBadge, TxLink } from "@/components/data/parts";
import { PageHeader, Panel, TestUnitsChip } from "@/components/data/panel";
import { LaneGauge } from "@/components/console/authority-panel";
import { ForecastPanel } from "./forecast-panel";
import { PayrollPanel, TreasurerRequests } from "./requests";

function DirectorRings({ p, entity }: { p: DirectorProposal; entity: TreasuryEntity }) {
  const signed = new Set(p.signatures.map((s) => s.directorId));
  return (
    <div role="img" className="flex items-center gap-1.5" aria-label={`${p.signatures.length} of ${entity.threshold} required director signatures`}>
      {entity.directors.map((d) => {
        const on = signed.has(d.id);
        return (
          <svg key={d.id} viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <title>{`${d.name}: ${on ? "signed" : "not signed"}`}</title>
            <circle cx="10" cy="10" r="7.5" fill={on ? "var(--fg-1)" : "transparent"} stroke={on ? "var(--fg-1)" : "var(--line-3)"} strokeWidth="1.5" style={{ transition: "fill 300ms ease-out" }} />
            {on ? <path d="M6.6 10.2l2.2 2.2 4.6-4.8" fill="none" stroke="var(--bg-0)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /> : null}
          </svg>
        );
      })}
    </div>
  );
}

function Queue({ view }: { view: TreasuryView }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const open = view.proposals.filter((p) => p.status === "open");
  const closed = view.proposals
    .filter((p) => p.status !== "open")
    .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || 0);
  const [allClosed, setAllClosed] = useState(false);
  const CLOSED_SHOWN = 2;
  const shownClosed = allClosed ? closed : closed.slice(0, CLOSED_SHOWN);
  async function sign(p: DirectorProposal, directorId: string, directorName: string) {
    setBusy(p.id);
    setMsg(null);
    try {
      await getApi().signBoardProposal(view.entity.id, p.id, directorId);
      setMsg(`${directorName} signed${isSample ? " (sample data)" : " with a testnet director key held by the service"}.`);
      invalidate("treasury");
    } catch (e) {
      const err = e as ApiRequestError;
      setMsg(
        err?.status === 403
          ? "Director signatures are collected by the operator in this demo: the three director keys are testnet keys held by the service, not by this browser."
          : (err?.message ?? "Signing failed."),
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <Panel
      id="queue-h"
      eyebrow="Board"
      title={open.length ? `${open.length} waiting for directors` : "Director queue"}
      meta={
        <span>
          {view.entity.threshold} of {view.entity.directors.length} directors sign one user operation from the company account.
        </span>
      }
      tone={open.length ? "brass" : undefined}
      bodyClassName="py-1"
    >
      {open.length === 0 && closed.length === 0 ? <p className="m-0 py-3 text-13 text-fg-muted">Nothing outside the lanes. The agent works alone inside them.</p> : null}
      <ul className="m-0 grid list-none gap-0 p-0">
        {[...open, ...shownClosed].map((p) => {
          const next = view.entity.directors.find((d) => !p.signatures.some((s) => s.directorId === d.id));
          return (
            <li key={p.id} className={cn("grid gap-2.5 border-t border-line-1 py-4 first:border-t-0", p.status !== "open" && "text-fg-2")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-13 font-medium text-fg-0">
                    {p.title} <TierBadge tier={p.tier} />
                  </p>
                  <p className="m-0 mt-0.5 text-12 text-fg-muted">{p.payeeName}</p>
                </div>
                <span className="font-mono text-13 whitespace-nowrap text-fg-1 tabular">{p.amount ? formatAmount(p.amount) : ""}</span>
              </div>
              <p className="m-0 text-12 text-fg-2">{p.reason}</p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <DirectorRings p={p} entity={view.entity} />
                  <span className="text-12 text-fg-muted">
                    {p.signatures.length} of {view.entity.threshold}
                  </span>
                </div>
                {p.status === "open" ? (
                  <Button size="sm" variant="secondary" disabled={busy !== null || !next} onClick={() => next && void sign(p, next.id, next.name)}>
                    {busy === p.id ? "Signing" : next ? `Sign as ${next.name}` : "Signed"}
                  </Button>
                ) : p.status === "executed" && p.tx ? (
                  <TxLink ledger={p.tx.ledger} hash={p.tx.txHash} href={p.tx.explorerUrl} badge={p.tx.badge} label="Executed" />
                ) : (
                  <StateRing state={p.status === "approved" ? "verified" : "expired"} size={16} label={p.status === "approved" ? "Approved" : p.status === "rejected" ? "Rejected" : "Expired"} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {closed.length > CLOSED_SHOWN ? (
        <div className="pb-3">
          <Button size="sm" variant="quiet" aria-expanded={allClosed} onClick={() => setAllClosed((v) => !v)}>
            {allClosed ? "Show only the latest" : `Show ${closed.length - CLOSED_SHOWN} earlier resolution${closed.length - CLOSED_SHOWN === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : null}
      {msg ? (
        <p role="status" className="m-0 pb-3 text-12 text-fg-2">
          {msg}
        </p>
      ) : null}
    </Panel>
  );
}

function Ledger({ view }: { view: TreasuryView }) {
  const sym = view.lanes[0]?.cap.symbol;
  const [all, setAll] = useState(false);
  const SHOWN = 12;
  const rows = all ? view.instructions : view.instructions.slice(0, SHOWN);
  const fisco = view.entity.rail.ledger === "fisco";
  return (
    <Panel
      id="ledger-h"
      eyebrow={fisco ? "FISCO BCOS" : "Ledger"}
      title={fisco ? "Instruction ledger" : "Payments ledger"}
      actions={<LedgerChip ledger={view.entity.rail.ledger} />}
      footer={
        fisco
          ? "Coin-free rail: nothing on this ledger has value. Instructions are settled by an e-CNY-style simulator, not the PBoC sandbox and not any bank. FISCO BCOS here is a consortium chain run by the team."
          : "Test units on a test ledger; no monetary value."
      }
    >
      <div className="-mx-1 overflow-x-auto px-1" tabIndex={0} role="region" aria-label="Instructions (scrolls sideways on small screens)">
        <table className="yl-table min-w-[640px]">
          <caption className="sr-only">Payment instructions with status and anchoring</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Instruction</th>
              <th scope="col" className="text-right">
                Amount
                {sym ? <span className="block text-11 font-normal text-fg-muted">{sym}</span> : null}
              </th>
              <th scope="col">Status</th>
              <th scope="col">Anchor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td className="font-mono text-12 whitespace-nowrap text-fg-muted">
                  <span className="block text-fg-2">{formatTime(i.createdAt, { date: false })}</span>
                  {formatDay(i.createdAt)}
                </td>
                <td className="min-w-[160px]">
                  <span className="block text-13 text-fg-0">{i.payeeName}</span>
                  <span className="block text-12 text-fg-muted">{i.condition ?? i.kind}</span>
                </td>
                <td className="num text-13 text-fg-1">{i.amount && i.amount.value !== "0" ? formatAmount(i.amount, { symbol: false }) : "—"}</td>
                <td>
                  {i.status === "rejected" ? (
                    <StateRing state="refused" label="Rejected" error={i.rejectError ?? undefined} />
                  ) : i.status === "executed" ? (
                    i.tx ? (
                      <TxLink ledger={i.tx.ledger} hash={i.tx.txHash} href={i.tx.explorerUrl} badge={i.tx.badge} label="Executed" />
                    ) : (
                      <StateRing state="verified" label="Executed" />
                    )
                  ) : (
                    <StateRing state="pending" label={i.status === "scheduled" ? "Scheduled" : "Pending"} />
                  )}
                </td>
                <td>
                  {i.anchor.status === "anchored" ? (
                    <StateRing state="onchain" label="Anchored" hash={i.anchor.baseTx ?? i.anchor.root ?? undefined} />
                  ) : i.anchor.status === "pending" ? (
                    <StateRing state="pending" label="Next batch" />
                  ) : (
                    <StateRing state="unknown" label="Not anchored" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.instructions.length > SHOWN ? (
        <div className="pt-3">
          <Button size="sm" variant="quiet" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? `Show the latest ${SHOWN}` : `Show ${view.instructions.length - SHOWN} earlier instruction${view.instructions.length - SHOWN === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

function SectionLabel({ id, index, title }: { id: string; index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line-1 pb-2">
      <span className="kicker">{index}</span>
      <h2 id={id} className="m-0 text-13 font-semibold tracking-wide text-fg-1 uppercase">
        {title}
      </h2>
    </div>
  );
}

const SHORT: Record<TreasuryEntity["jurisdiction"], string> = { mainland: "Shenzhen", hk: "Hong Kong", international: "International" };

export function Treasury() {
  const entities = useAgent("treasury-entities", (api) => api.treasuryEntities(), ["treasury"]);
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!id && entities.data?.[0]) setId(entities.data[0].id);
  }, [entities.data, id]);
  const current = id ?? entities.data?.[0]?.id ?? null;
  const view = useAgent(`treasury:${current}`, (api) => (current ? api.treasury(current) : Promise.reject(new Error("No entity"))), ["treasury"]);
  const forecast = useAgent(`forecast:${current}`, (api) => (current ? api.forecast(current, 30) : Promise.reject(new Error("No entity"))), ["treasury", "forecast"]);
  const v = view.data;
  const nextPayroll = forecast.data?.events.find((e) => e.kind === "payroll") ?? null;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-6 pb-16 sm:px-6 lg:px-8 lg:pt-8">
      <PageHeader
        eyebrow="Company demo"
        title={v?.entity.name ?? "Lotus Lane treasury"}
        lead="An AI treasurer pays suppliers and staff on its own, within the board's limits. Anything bigger needs two of three directors."
        art="treasury-glass"
        chips={
          v ? (
            <>
              <TestUnitsChip />
              <LedgerChip ledger={v.entity.rail.ledger} />
              <LabelChip dotted>Fictional company</LabelChip>
            </>
          ) : null
        }
        actions={
          entities.data && entities.data.length > 1 ? (
            <Segmented<string>
              label="Entity"
              value={current ?? ""}
              onChange={setId}
              options={entities.data.map((e) => ({ value: e.id, label: SHORT[e.jurisdiction] ?? e.name }))}
              className="w-fit"
            />
          ) : null
        }
      >
        <ErrorLine error={entities.error} />
        {v ? (
          <details className="group text-12 text-fg-muted">
            <summary className="w-fit cursor-pointer text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-0">About this payment rail</summary>
            <p className="m-0 mt-2 max-w-[80ch]">
              {v.entity.rail.label}. {v.entity.rail.note} The agent&apos;s authority is bound to verified persons: for a company, its directors ({v.entity.threshold} of{" "}
              {v.entity.directors.length}). The board resolution is the treasurer agent&apos;s mandate.
            </p>
          </details>
        ) : null}
      </PageHeader>

      <ErrorLine error={view.error} className="mt-6" />
      {view.loading && !v ? (
        <div className="mt-8">
          <Loading rows={4} />
        </div>
      ) : null}
      {v ? (
        <div className="mt-10 grid gap-10">
          <section aria-labelledby="lanes-sec" className="grid gap-4">
            <SectionLabel id="lanes-sec" index="01" title="Lanes" />
            <Panel
              id="lanes-h"
              eyebrow="Board mandate"
              title="Where the agent acts alone"
              meta={<span>Each ring is a lane sealed by the board. The tick marks a reserve floor; it turns brass only when a breach is forecast.</span>}
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
                {v.lanes.map((l) => (
                  <LaneGauge key={l.id} lane={l} size={116} />
                ))}
              </div>
            </Panel>
          </section>

          <section aria-labelledby="forecast-sec" className="grid gap-4">
            <SectionLabel id="forecast-sec" index="02" title="What is coming" />
            <ForecastPanel entityId={v.entity.id} />
          </section>

          <section aria-labelledby="decide-sec" className="grid gap-4">
            <SectionLabel id="decide-sec" index="03" title="Decisions" />
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <Queue view={v} />
              <div className="grid gap-4">
                <TreasurerRequests key={v.entity.id} view={v} />
                <PayrollPanel
                  key={`${v.entity.id}:${nextPayroll?.amount.value ?? "none"}`}
                  view={v}
                  next={nextPayroll ? { day: nextPayroll.day, amount: nextPayroll.amount.value } : null}
                />
              </div>
            </div>
          </section>

          <section aria-labelledby="ledger-sec" className="grid gap-4">
            <SectionLabel id="ledger-sec" index="04" title="Records" />
            <Ledger view={v} />
            {v.mandate ? (
              <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-muted">
                <StateRing state="sealed" size={16} label={v.mandate.title} />
                {v.mandate.sealedAt ? <span>sealed {formatTime(v.mandate.sealedAt)}</span> : null}
                {v.mandate.published.map((t) => (
                  <TxLink key={t.txHash} ledger={t.ledger} hash={t.txHash} href={t.explorerUrl} badge={t.badge} label="Published" />
                ))}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
