"use client";

import Link from "next/link";
import { StateRing } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { formatAmount, formatTime } from "@/lib/format";
import { buttonClass } from "@/components/ui/button";
import { ErrorLine, SectionHead, TierBadge } from "@/components/data/parts";

/** Waiting for you: T2 approvals. Brass is used only here and on things that wait on a person. */
export function Approvals() {
  const q = useAgent("approvals", (api) => api.approvals(), ["approvals"]);
  const items = q.data ?? [];
  if (q.loading || (!items.length && !q.error)) return null;
  return (
    <section aria-labelledby="approvals-h" className="grid gap-3">
      <SectionHead id="approvals-h" eyebrow="Waiting for you" title={`${items.length} approval${items.length === 1 ? "" : "s"}`} />
      <ErrorLine error={q.error} />
      <ul className="yl-card yl-enter m-0 grid list-none divide-y divide-line-1 border-brass/50 p-0">
        {items.map((a) => (
          <li key={a.id} className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 px-4 py-3.5 sm:grid-cols-[auto_1fr_auto_auto] sm:items-center">
            <StateRing state="waiting" size={20} glyphOnly label="Needs you" className="mt-0.5 sm:mt-0" />
            <div className="min-w-0">
              <p className="m-0 flex flex-wrap items-center gap-2 text-13 font-medium text-fg-0">
                {a.kind === "pause"
                  ? "Pause your agent"
                  : a.kind === "resume"
                    ? "Resume your agent"
                    : a.kind === "revoke"
                      ? "Revoke your mandate"
                      : (a.decoded?.payee?.name ?? a.decoded?.targetName ?? "Signature request")}
                {a.kind === "cosign" && a.decoded?.payee?.name && a.decoded.targetName !== a.decoded.payee.name ? (
                  <span className="font-normal text-fg-muted">via {a.decoded.targetName}</span>
                ) : null}
                {a.tier ? <TierBadge tier={a.tier} /> : null}
              </p>
              <p className="m-0 mt-0.5 text-12 text-fg-muted">
                {a.reason ?? "Needs your passkey."} Expires {formatTime(a.expiresAt)}.
              </p>
            </div>
            <span className="col-start-2 font-mono text-13 text-fg-1 tabular sm:col-start-auto sm:text-right">
              {a.decoded?.amount ? formatAmount(a.decoded.amount) : ""}
            </span>
            <Link href={`/approve/${a.id}`} className={buttonClass("secondary", "sm", "col-start-2 justify-self-start sm:col-start-auto")}>
              Review
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
