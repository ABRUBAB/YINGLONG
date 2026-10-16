"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@yinglong/ui";
import { getApi } from "@/lib/api";
import { WireHealth } from "@/lib/api/types";
import type { Ping, ProofBundle } from "@/lib/api/view";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { SampleBadge } from "@/components/data/parts";
import { ExtLink, uptimeText } from "./parts";

const EVERY_MS = 30_000;

type State = "checking" | "online" | "offline";

function Ring({ state }: { state: State }) {
  const stroke = state === "online" ? "var(--jade, var(--fg-1))" : state === "offline" ? "var(--seal, var(--fg-1))" : "var(--line-3)";
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" className="shrink-0">
      <circle cx="16" cy="16" r="11" fill="none" stroke={stroke} strokeWidth="3" strokeDasharray={state === "checking" ? "4 3" : undefined} />
      {state === "online" ? <circle cx="16" cy="16" r="3.2" fill={stroke} /> : null}
      {state === "offline" ? <path d="M12 12l8 8M20 12l-8 8" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" /> : null}
    </svg>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line-1 py-2 first:border-t-0">
      <dt className="shrink-0 text-12 text-fg-muted">{k}</dt>
      <dd className="m-0 min-w-0 text-right text-13 text-fg-1">{children}</dd>
    </div>
  );
}

/**
 * "Is the service live?": GET /v1/health measured on this device, repeated every 30 seconds while the
 * tab is visible. "Try it live" sends one more request and opens the raw answer, so a judge sees the
 * same bytes the page saw.
 */
export function LiveStatusCard({ service, className }: { service: ProofBundle["service"] | null; className?: string }) {
  const id = useId();
  const [ping, setPing] = useState<Ping | null>(null);
  const [checks, setChecks] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const alive = useRef(true);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const p = await getApi().ping();
      if (!alive.current) return;
      setPing(p);
      setChecks((n) => n + 1);
    } catch (e) {
      if (!alive.current) return;
      setPing({ ok: false, status: 0, ms: 0, at: new Date().toISOString(), url: `${getApi().baseUrl}/v1/health`, body: { error: (e as Error).message } });
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void run();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, EVERY_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [run]);

  const state: State = !ping ? "checking" : ping.ok ? "online" : "offline";
  const health = ping ? WireHealth.safeParse(ping.body) : null;
  const ledgers = health?.success ? health.data.ledgers : [];
  const liveUrl = ping && /^https?:/.test(ping.url) ? ping.url : null;
  const shownUrl = ping ? ping.url.replace(/^sample:/, "") : "/v1/health";

  return (
    <aside aria-labelledby={`${id}-h`} className={cn("yl-card grid min-w-0 content-start gap-4 p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Ring state={state} />
          <div className="min-w-0">
            <h2 id={`${id}-h`} className="m-0 text-18 leading-tight font-semibold text-fg-0">
              {state === "checking" ? "Checking the service" : state === "online" ? "The service is live" : "The service did not answer"}
            </h2>
            <p className="m-0 mt-0.5 text-12 text-fg-muted" aria-live="polite">
              {ping ? `GET /v1/health answered ${ping.status || "nothing"} in ${ping.ms} ms` : "Sending GET /v1/health"}
            </p>
          </div>
        </div>
        <SampleBadge className="shrink-0" />
      </div>

      <dl className="m-0 grid">
        <Row k="Last checked">{ping ? `${formatTime(ping.at, { seconds: true, date: false })} HKT` : "—"}</Row>
        <Row k="Response time">
          <span className="font-mono text-fg-0 tabular-nums">{ping ? `${ping.ms} ms` : "—"}</span>
        </Row>
        <Row k="Checked">{checks ? `${checks} time${checks === 1 ? "" : "s"} this visit, every 30 s` : "every 30 s while this tab is open"}</Row>
        <Row k="Up for">
          {service ? (
            <>
              <span className="font-mono tabular-nums">{uptimeText(service.uptimeSeconds)}</span>
              {service.startedAt ? <span className="block text-11 text-fg-muted">since {formatTime(service.startedAt)} HKT</span> : null}
            </>
          ) : (
            "—"
          )}
        </Row>
        {ledgers.map((l) => (
          <Row key={l.name} k={l.badge ?? l.name}>
            {l.ok === false ? (
              "unreachable"
            ) : (
              <>
                block <span className="font-mono tabular-nums">#{String(l.block ?? "?")}</span>
              </>
            )}
          </Row>
        ))}
      </dl>

      <div className="no-print flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="md"
          className="h-10 min-w-[7.5rem]"
          aria-busy={busy}
          aria-expanded={open}
          aria-controls={`${id}-raw`}
          disabled={busy}
          onClick={async () => {
            await run();
            setOpen(true);
          }}
        >
          {busy ? "Asking" : "Try it live"}
        </Button>
        {liveUrl ? <ExtLink href={liveUrl}>Open the JSON</ExtLink> : null}
      </div>

      <div id={`${id}-raw`} hidden={!open || !ping} className="grid gap-0 rounded-control border border-line-2 bg-canvas">
        {ping ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-1 px-3 py-2 font-mono text-11 text-fg-muted">
              <span className="min-w-0 break-all">
                GET {shownUrl} {"·"} {ping.status || "no answer"} {"·"} {ping.ms} ms {"·"} {formatTime(ping.at, { seconds: true, date: false })} HKT
              </span>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOpen(false)}>
                Hide
              </Button>
            </div>
            <pre tabIndex={0} aria-label="Raw response" className="m-0 max-h-64 overflow-auto px-3 py-3 font-mono text-11 leading-relaxed text-fg-1">
              {JSON.stringify(ping.body, null, 2) ?? "null"}
            </pre>
          </>
        ) : null}
      </div>
    </aside>
  );
}
