"use client";

import { useState } from "react";
import { cn, HashRing, LabelChip, OutputChip, shortHash, StateRing } from "@yinglong/ui";
import type { Mandate } from "@/lib/api/view";
import { useAgent } from "@/lib/api/hooks";
import { formatTime, JURISDICTION_LABEL } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button";
import { ErrorLine, Loading, TierBadge, TxLink } from "@/components/data/parts";
import { compareHashRing } from "@/lib/hash-ring-check";

function statusRing(m: Mandate) {
  if (m.status === "live") return <StateRing state="sealed" size={16} label="Live, sealed" />;
  if (m.status === "superseded") return <StateRing state="expired" size={16} label="Superseded" />;
  return <StateRing state="refused" size={16} label="Revoked" />;
}

export function MandateRules({ m }: { m: Mandate }) {
  return (
    <ol className="m-0 grid list-none gap-0 p-0">
      {m.rules.map((r, i) => (
        <li key={r.id} className="grid grid-cols-[1.75rem_1fr] gap-x-2 border-t border-line-1 py-2.5 first:border-t-0">
          <span className="font-mono text-12 text-fg-muted tabular">{String(i + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <p className="m-0 text-13 text-fg-1">{r.sentence}</p>
            <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5">
              <OutputChip kind="rule" />
              <span className="font-mono text-11 text-fg-muted">{r.enforcer}</span>
              {r.tierCeiling ? <TierBadge tier={r.tierCeiling} /> : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function MandatesList() {
  const q = useAgent("mandates", (api) => api.mandates(), ["mandates"]);
  const [open, setOpen] = useState<string | null>(null);
  if (q.loading) return <Loading label="Loading mandates" rows={3} />;
  const items = q.data ?? [];
  return (
    <div className="grid gap-4">
      <ErrorLine error={q.error} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-13 text-fg-muted">
          A new mandate supersedes the live one atomically. Only the live version can act.
        </p>
        <ButtonLink href="/app/mandates/new" variant="secondary" size="sm">
          New mandate
        </ButtonLink>
      </div>
      <ul className="m-0 grid list-none gap-0 p-0">
        {items.map((m) => {
          const expanded = open === m.id || (open === null && m.status === "live");
          const ring = compareHashRing(m.delegationHash, m.serviceHashRing, m.status === "revoked");
          return (
            <li key={m.id} className={cn("border-t border-line-2 py-4", m.status !== "live" && "text-fg-2")}>
              <div className="grid grid-cols-[auto_1fr] items-start gap-4 sm:grid-cols-[auto_1fr_auto]">
                <HashRing hash={m.delegationHash} size={56} phase={m.status === "revoked" ? "revoked" : m.status === "live" ? "sealed" : "draft"} />
                <div className="min-w-0">
                  <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-12 text-fg-muted">v{m.version}</span>
                    <span className="text-15 font-medium text-fg-0">{m.title}</span>
                  </p>
                  <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-muted">
                    {statusRing(m)}
                    <span>{JURISDICTION_LABEL[m.jurisdiction]}</span>
                    <span>{m.sealedAt ? `Sealed ${formatTime(m.sealedAt)}` : "Not sealed"}</span>
                    <span className="font-mono" title={m.mandateHash}>
                      {shortHash(m.mandateHash, 8, 6)}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? "none" : m.id)}
                  className="col-start-2 justify-self-start text-12 text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-0 sm:col-start-auto sm:justify-self-end"
                >
                  {expanded ? "Hide rules" : `Show ${m.rules.length} rules`}
                </button>
              </div>
              {expanded ? (
                <div className="mt-4 grid gap-4 sm:pl-[72px]">
                  <MandateRules m={m} />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-1 pt-3 text-12">
                    {m.published.map((t) => (
                      <TxLink key={t.txHash} ledger={t.ledger} hash={t.txHash} href={t.explorerUrl} badge={t.badge} label="Published" />
                    ))}
                    {m.roundTrip.every((c) => c.passed) ? (
                      <StateRing state="verified" size={16} label="Round trip: caveats decode to these sentences" />
                    ) : (
                      <StateRing state="refused" size={16} label="Round trip failed" />
                    )}
                    {ring === "match" ? <StateRing state="verified" size={16} label="Hash Ring matches the agent service" /> : null}
                    {ring === "mismatch" ? <StateRing state="refused" size={16} label="Hash Ring differs from the agent service" /> : null}
                    {m.status !== "live" ? <LabelChip>Cannot act</LabelChip> : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
