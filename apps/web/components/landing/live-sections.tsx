"use client";

import { LabelChip, SampleDataChip, StateRing } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { ArrowIcon, ButtonLink } from "@/components/ui/button";
import { Qr } from "@/components/qr";
import { ErrorLine, TxLink } from "@/components/data/parts";

const SOURCE_LABEL: Record<string, string> = {
  "anvil-fork": "Anvil fork",
  "live-base": "Base Sepolia",
  "live-fisco": "FISCO BCOS",
  kaggle: "Kaggle run",
  "user-study": "User study",
  ci: "CI",
};

/** 5. Evidence: generated numbers only. With none generated yet, the section says so. */
export function Evidence() {
  const q = useAgent("evidence", (api) => api.evidence(), ["evidence"]);
  const e = q.data;
  return (
    <section aria-labelledby="evidence-title" className="border-y border-line-1 bg-bg-1">
      <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-28">
        <div className="lg:col-span-4">
          <p className="eyebrow m-0 text-fg-muted">Evidence</p>
          <h2 id="evidence-title" className="type-display m-0 mt-3 text-h2 text-fg-0">
            Measured, not claimed
          </h2>
          <p className="m-0 mt-4 max-w-[34ch] text-15 text-fg-2">
            Every number is generated from the code and carries its source. If a number is not generated, it does not appear.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {isSample ? <SampleDataChip /> : null}
            {e ? <span className="text-12 text-fg-muted">Generated {formatTime(e.generatedAt)} HKT</span> : null}
          </div>
          <div className="mt-8">
            <ButtonLink href="/proof" variant="secondary">
              Open the proof <ArrowIcon />
            </ButtonLink>
          </div>
        </div>
        <div className="grid content-start gap-8 lg:col-span-8">
          <ErrorLine error={q.error} />
          {e && e.metrics.length ? (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
              <table className="yl-table min-w-[560px]">
                <caption className="sr-only">Generated metrics with sample size and source</caption>
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    <th scope="col" className="text-right">
                      Value
                    </th>
                    <th scope="col" className="text-right">
                      n
                    </th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {e.metrics.map((m) => (
                    <tr key={m.id}>
                      <td className="text-fg-1">{m.label}</td>
                      <td className="num text-15 text-fg-0">
                        {m.value}
                        {m.interval ? <span className="block text-11 text-fg-muted">95% {m.interval[0]} to {m.interval[1]}</span> : null}
                      </td>
                      <td className="num text-fg-2">{m.n ?? "—"}</td>
                      <td>
                        <LabelChip dotted={m.source === "anvil-fork"}>{SOURCE_LABEL[m.source] ?? m.source}</LabelChip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : e ? (
            <p className="m-0 flex items-center gap-2 text-13 text-fg-2">
              <StateRing state="pending" size={16} label="No generated numbers yet" /> The agent service has not published metrics; transactions below are live.
            </p>
          ) : null}
          {e && e.hashes.length ? (
            <ul className="m-0 grid list-none gap-0 border-t border-line-2 p-0">
              {e.hashes.slice(0, 5).map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line-1 py-3 text-13">
                  <span className="text-fg-1">{h.label}</span>
                  <TxLink ledger={h.tx.ledger} hash={h.tx.txHash} href={h.tx.explorerUrl} badge={h.tx.badge} label={h.typedError ? `Reverted: ${h.typedError}` : "On chain"} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** 6. Judge's Challenge call to action with the guest QR. */
export function ChallengeCta() {
  const q = useAgent("challenge-session", (api) => api.challengeSession(), ["challenge"]);
  return (
    <section aria-labelledby="cta-title" className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="grid items-center gap-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="eyebrow m-0 text-fg-muted">Judge&apos;s Challenge</p>
          <h2 id="cta-title" className="type-display m-0 mt-3 text-h2 text-fg-0">
            Nothing you type can move funds outside the mandate. Try.
          </h2>
          <p className="m-0 mt-4 max-w-[52ch] text-15 text-fg-2">
            Scan the code for a guest mandate with a tiny cap, write any attack to Ying, and see which of the nine scales stopped it. Press bypass to
            send a raw redemption straight to the chain and get the revert hash.
          </p>
          <div className="mt-8">
            <ButtonLink href="/challenge" size="lg">
              Open the challenge <ArrowIcon />
            </ButtonLink>
          </div>
        </div>
        <div className="flex items-center gap-6 lg:col-span-5 lg:justify-end">
          {q.data ? (
            <Qr value={q.data.joinUrl} size={168} label="QR code for a guest mandate in the Judge's Challenge" />
          ) : (
            <Qr value="https://app.yinglong-agent.tech/challenge" size={168} label="QR code for the Judge's Challenge" />
          )}
          <div className="grid gap-1 text-12 text-fg-muted">
            <span>Guest mandate, test units only</span>
            {q.data ? <span>{q.data.quota.perDay} attempts per guest per day</span> : null}
            {isSample ? <SampleDataChip /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
