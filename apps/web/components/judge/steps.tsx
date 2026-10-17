"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { cn, LabelChip } from "@yinglong/ui";
import type { EvidenceSummary, Health, Ledger, Mandate, Ping, ProofBundle } from "@/lib/api/view";
import { getApi, isSample } from "@/lib/api";
import { invalidate } from "@/lib/api/hooks";
import { clearVisitorSession, readVisitorSession } from "@/lib/api/session";
import { completeSignUp, createVisitorSecretKey, reviewSignUp, signStep } from "@/lib/visitor";
import { formatTime } from "@/lib/format";
import { Button, buttonClass } from "@/components/ui/button";
import { TxLink } from "@/components/data/parts";
import { clock, maybe, useStepRun, type Run } from "./run";
import { Mono, Row, ServiceError, Stage, Tile } from "./stage";

const SESSION_TAGS = ["me", "pause", "mandates", "budgets", "receipts", "approvals", "session"];

interface Nav {
  clockNode?: ReactNode;
  onBack?: () => void;
  onNext: () => void;
  onSkip: () => void;
}

/* ------------------------------------------------------------------ step 1: what this is */

export interface IntroData {
  ping: Ping;
  health: Health | null;
  proof: ProofBundle | null;
  evidence: EvidenceSummary | null;
}

function uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function IntroStep({ run, setRun, nav }: { run: Run<IntroData>; setRun: (r: Run<IntroData>) => void; nav: Nav }) {
  const retry = useStepRun(run, setRun, async (report) => {
    const api = getApi();
    const ping = await api.ping();
    if (!ping.ok) throw new Error(`GET /v1/health answered ${ping.status ? `HTTP ${ping.status}` : "nothing"} after ${ping.ms} ms.`);
    report.partial({ ping });
    const [health, proof] = await Promise.all([maybe(() => api.health()).catch(() => null), maybe(() => api.proof()).catch(() => null)]);
    const evidence = proof ? null : await maybe(() => api.evidence()).catch(() => null);
    if (!proof && !evidence) throw new Error("GET /v1/proof and GET /v1/evidence both failed.");
    return { ping, health, proof, evidence };
  });
  const d: Partial<IntroData> = run.at === "done" ? run.value : run.at === "running" || run.at === "error" ? run.partial : {};
  const proof = d.proof ?? null;
  const evidence = d.evidence ?? null;
  const txTotal = proof ? proof.transactions.counts.reduce((a, c) => a + c.total, 0) : null;
  const ledgersWithTx = proof ? proof.transactions.counts.filter((c) => c.total > 0).length : 0;
  const bytecode = proof?.chain.bytecode ?? null;
  const up = proof?.service.uptimeSeconds ?? null;

  return (
    <Stage
      n={1}
      title="Watch an AI agent pay inside its rules, on a real blockchain, in three minutes."
      lead="You get your own agent, it pays a shop, it is blocked when tricked, and even a raw transaction is refused by the blockchain. Every number here comes from the live service."
      clockNode={nav.clockNode}
      run={run}
      onNext={nav.onNext}
      onSkip={nav.onSkip}
      nextLabel="Start: create my test agent"
    >
      <div className="grid gap-4">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-13 text-fg-1" data-live>
          <span aria-hidden="true" className={cn("inline-block size-2 rounded-full", d.ping ? (d.ping.ok ? "bg-jade" : "bg-seal") : "bg-line-3")} />
          {d.ping ? (
            <>
              <span className="font-medium text-fg-0">{d.ping.ok ? "Live" : "Not answering"}:</span>
              <span>
                GET /v1/health answered in <span className="font-mono tabular">{d.ping.ms} ms</span> (HTTP {d.ping.status}) at {formatTime(d.ping.at, { seconds: true })}
              </span>
              {isSample ? <LabelChip dotted>Sample data: a simulated service</LabelChip> : null}
            </>
          ) : run.at === "error" ? (
            <span className="text-fg-2">The service did not answer.</span>
          ) : (
            <span className="text-fg-2">Asking the service...</span>
          )}
        </p>
        {run.at === "error" ? <ServiceError call="GET /v1/health or GET /v1/proof" run={run} onRetry={retry} onSkip={nav.onSkip} /> : null}
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Live numbers">
          <Tile
            id="transactions"
            label="Transactions recorded"
            value={txTotal !== null ? txTotal.toLocaleString("en-US") : evidence ? evidence.hashes.length.toLocaleString("en-US") : "..."}
            source={proof ? `GET /v1/proof, ${ledgersWithTx} ledger${ledgersWithTx === 1 ? "" : "s"}` : evidence ? "GET /v1/evidence, hashes in the evidence file" : "GET /v1/proof"}
          />
          <Tile
            id="identical"
            label="Contracts with identical code on both chains"
            value={bytecode ? `${bytecode.identical} of ${bytecode.compared}` : evidence ? evidence.contracts.length.toLocaleString("en-US") : "..."}
            source={bytecode ? "GET /v1/proof, chain.bytecode" : evidence ? "GET /v1/evidence, contracts deployed" : "GET /v1/proof"}
          />
          <Tile
            id="uptime"
            label={up !== null ? "Service up for" : "Newest block"}
            value={up !== null ? uptime(up) : d.health?.ledgers[0] ? d.health.ledgers[0].block : "..."}
            source={up !== null ? "GET /v1/proof, service.uptimeSeconds" : d.health?.ledgers[0] ? `GET /v1/health, ${d.health.ledgers[0].badge}` : "GET /v1/health"}
          />
        </div>
        {d.health?.ledgers.length ? (
          <p className="m-0 text-12 text-fg-muted">
            Ledgers now: {d.health.ledgers.map((l) => `${l.badge} at block ${l.block}`).join("; ")} (GET /v1/health, version {d.health.version}).
          </p>
        ) : null}
        <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3 lg:grid-cols-6" aria-label="The six steps">
          {ROADMAP.map((r, i) => (
            <li key={r.t} className="yl-card yl-card--glass grid content-start gap-1 p-3.5" style={{ ["--tone" as string]: r.tone }}>
              <span className="font-mono text-11" style={{ color: "var(--tone)" }}>{`0${i + 1}`}</span>
              <span className="text-13 font-medium text-fg-0">{r.t}</span>
              <span className="text-12 leading-snug text-fg-muted">{r.d}</span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-13 text-fg-2">No typing is needed. Each step runs a real operation and shows what came back, with the time it took.</p>
      </div>
    </Stage>
  );
}

const ROADMAP = [
  { t: "Look", d: "The live service answers.", tone: "var(--steel)" },
  { t: "Your agent", d: "Rules locked on chain.", tone: "var(--accent-glow)" },
  { t: "A payment", d: "Nine checks, then paid.", tone: "var(--lime)" },
  { t: "A trick", d: "Blocked, with the reason.", tone: "var(--seal)" },
  { t: "A raw send", d: "The chain refuses it.", tone: "var(--violet)" },
  { t: "Check it", d: "Open the records yourself.", tone: "var(--brass)" },
] as const;

/* ------------------------------------------------------------------ step 2: your own agent */

export interface AccountData {
  reused: boolean;
  replaced: boolean;
  visitorId: string;
  owner: string;
  account: string;
  agentId: string;
  agentName: string;
  ledger: Ledger;
  ledgerBadge: string | null;
  publishTx: string | null;
  publishHref: string | null;
  sentences: string[];
  guard: { messages: number; ok: boolean } | null;
}

export function AccountStep({ run, setRun, nav }: { run: Run<AccountData>; setRun: (r: Run<AccountData>) => void; nav: Nav }) {
  const retry = useStepRun(run, setRun, async (report) => {
    const api = getApi();
    const existing = readVisitorSession();
    if (existing?.method === "key" && existing.secretKey && existing.sealedAt) {
      report.note("A test account from an earlier visit is in this browser; reading it.");
      report.partial({ reused: true, owner: existing.owner ?? "", visitorId: existing.visitorId });
      const me = await maybe(() => api.me());
      const mandates = await maybe(() => api.mandates()).catch(() => [] as Mandate[]);
      const live = mandates.find((m) => m.status === "live") ?? mandates[0] ?? null;
      const published = live?.published[0] ?? null;
      return {
        reused: true,
        replaced: false,
        visitorId: existing.visitorId,
        owner: existing.owner ?? "",
        account: me.account,
        agentId: me.agentId,
        agentName: me.agentName,
        ledger: me.ledger,
        ledgerBadge: me.ledgerBadge,
        publishTx: published?.txHash ?? null,
        publishHref: published?.explorerUrl ?? null,
        sentences: live?.decodedSentences ?? [],
        guard: null,
      };
    }
    const replaced = Boolean(existing);
    const key = createVisitorSecretKey();
    report.partial({ reused: false, replaced, owner: key.owner });
    report.note("Asking the service for an account with the ready-made rules (about 10 seconds).");
    const signUp = await api.visitorSignUp({ owner: key.owner });
    report.partial({
      visitorId: signUp.visitorId,
      account: signUp.account,
      agentId: signUp.agent.agentId,
      agentName: signUp.agent.label,
      ledger: signUp.ledger,
      ledgerBadge: signUp.ledgerBadge,
      sentences: signUp.mandate.sentences,
    });
    report.note("Checking both messages on this device before anything is signed.");
    const directory = await api.contractDirectory(signUp.ledger);
    const review = reviewSignUp(signUp, directory);
    report.partial({ guard: { messages: review.steps.length, ok: review.ok } });
    if (!review.ok) throw new Error(`Not signed. ${review.problems.join("; ")}`);
    report.note("Signing with the key in this browser.");
    const userOpSignature = await signStep(review, key, "publish");
    const delegationSignature = await signStep(review, key, "delegation");
    report.note("Publishing the rules on chain.");
    const sealed = await completeSignUp(api, signUp, key, { userOpSignature, delegationSignature });
    invalidate(...SESSION_TAGS);
    return {
      reused: false,
      replaced,
      visitorId: signUp.visitorId,
      owner: key.owner ?? "",
      account: signUp.account,
      agentId: signUp.agent.agentId,
      agentName: signUp.agent.label,
      ledger: sealed.ledger,
      ledgerBadge: sealed.ledgerBadge ?? signUp.ledgerBadge,
      publishTx: sealed.publishTx,
      publishHref: null,
      sentences: signUp.mandate.sentences,
      guard: { messages: review.steps.length, ok: review.ok },
    };
  });
  const d: Partial<AccountData> = run.at === "done" ? run.value : run.at === "running" || run.at === "error" ? run.partial : {};
  const done = run.at === "done";
  const state = (have: boolean, next: boolean): "verified" | "waiting" | "pending" | "refused" =>
    have ? "verified" : run.at === "error" ? "refused" : next ? "waiting" : "pending";

  return (
    <Stage
      n={2}
      title="Your own agent, with rules locked on the blockchain."
      lead={
        d.reused
          ? "A test account from an earlier visit is already in this browser, so the demo uses it. It holds test money only."
          : "A secret key is made in this browser, the service sets up an account that only this key controls, and the ready-made rules are published on chain. The key never leaves this browser."
      }
      clockNode={nav.clockNode}
      run={run}
      onBack={nav.onBack}
      onNext={nav.onNext}
      onSkip={nav.onSkip}
      nextLabel="Make a payment"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <ol className="m-0 grid list-none content-start p-0" aria-label="Progress of the account">
          <Row state={state(Boolean(d.owner), true)} label={d.reused ? "The secret key kept in this browser" : "A secret key, made in this browser"}>
            {d.owner ? (
              <p className="m-0">
                Its address: <Mono>{d.owner}</Mono>
              </p>
            ) : null}
          </Row>
          <Row state={state(Boolean(d.account), Boolean(d.owner))} label={d.reused ? "Your account and agent" : "An account only this key controls, with an agent of its own"}>
            {d.account ? (
              <p className="m-0 grid gap-0.5">
                <span>
                  Account <Mono>{d.account}</Mono>
                </span>
                <span className="text-13 text-fg-2">
                  Agent {d.agentName} <span className="font-mono">#{d.agentId}</span> on {d.ledgerBadge ?? d.ledger}
                </span>
              </p>
            ) : null}
          </Row>
          {!d.reused ? (
            <Row state={d.guard ? (d.guard.ok ? "verified" : "refused") : state(false, Boolean(d.account))} label="Both messages checked on this device before signing">
              {d.guard ? (
                <p className="m-0 text-13 text-fg-2">
                  {d.guard.messages} messages decoded here: they publish exactly these rules for exactly this agent, and nothing else.{" "}
                  {d.guard.ok ? "Both passed." : "One failed, so nothing was signed."}
                </p>
              ) : null}
            </Row>
          ) : null}
          <Row state={done ? (d.publishTx ? "onchain" : "verified") : state(false, Boolean(d.guard?.ok))} label={d.reused ? "The rules on chain" : "Signed with the key and published on chain"}>
            {done ? (
              d.publishTx && d.ledger ? (
                <TxLink ledger={d.ledger} hash={d.publishTx} href={d.publishHref} badge={d.ledgerBadge} label="Published" />
              ) : (
                <p className="m-0 text-13 text-fg-2">The service reported no publish transaction for this account.</p>
              )
            ) : null}
          </Row>
        </ol>
        <div className="grid content-start gap-4">
          {run.at === "error" ? <ServiceError call="POST /v1/visitors" run={run} onRetry={retry} onSkip={nav.onSkip} /> : null}
          {d.sentences?.length ? (
            <section aria-labelledby="judge-rules" className="grid gap-2">
              <h2 id="judge-rules" className="m-0 text-15 font-semibold text-fg-0">
                Your agent&apos;s rules, as the service states them
              </h2>
              <ol className="m-0 grid list-none gap-0 p-0" aria-label="Your agent's rules">
                {d.sentences.map((s, i) => (
                  <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 border-t border-line-1 py-2.5 text-15 text-fg-0">
                    <span className="pt-0.5 font-mono text-12 text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {done ? (
            <p role="status" className="m-0 rounded-control border border-line-1 px-3 py-2.5 text-12 text-fg-2">
              {d.reused ? "A test account from an earlier visit is in this browser; it holds test money only." : "A test account was created for you; it holds test money only."}{" "}
              {d.replaced ? "It replaced the account that was logged in on this browser; you can log in to that one again on the sign-up page." : ""} You can delete it from this
              browser at the end.
            </p>
          ) : null}
        </div>
      </div>
    </Stage>
  );
}

/* ------------------------------------------------------------------ step 6: check it yourself */

export interface CheckData {
  proof: ProofBundle;
}

export interface SessionRecord {
  label: string;
  ledger: Ledger;
  hash: string;
  href: string | null;
  badge: string | null;
}

export function CheckStep({
  run,
  setRun,
  nav,
  records,
  totalMs,
}: {
  run: Run<CheckData>;
  setRun: (r: Run<CheckData>) => void;
  nav: Nav;
  records: SessionRecord[];
  totalMs: number | null;
}) {
  const retry = useStepRun(run, setRun, async () => ({ proof: await maybe(() => getApi().proof()) }));
  const [deleted, setDeleted] = useState(false);
  const [hasAccount, setHasAccount] = useState(() => Boolean(readVisitorSession()));
  const proof = run.at === "done" ? run.value.proof : null;
  const bytecode = proof?.chain.bytecode ?? null;
  const enforcers = proof ? proof.chain.pairs.filter((p) => p.enforcer) : [];
  const enforcersIdentical = enforcers.filter((p) => p.identical === true).length;
  const commit = proof?.build.commit ?? null;

  return (
    <Stage
      n={6}
      title="Check it yourself."
      lead={
        totalMs !== null
          ? `You did this in ${clock(totalMs)}. Everything you saw is recorded and can be checked without us: the same contract code on both chains, the build it came from, and every record from this session.`
          : "Everything you saw is recorded and can be checked without us: the same contract code on both chains, the build it came from, and every record from this session."
      }
      clockNode={nav.clockNode}
      run={run}
      onBack={nav.onBack}
    >
      <div className="grid gap-6">
        {run.at === "error" ? <ServiceError call="GET /v1/proof" run={run} onRetry={retry} /> : null}
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Proof numbers">
          <Tile
            id="same-code"
            label="Contracts with identical code on both chains"
            value={bytecode ? `${bytecode.identical} of ${bytecode.compared}` : proof ? "n/a" : "..."}
            source={bytecode?.differ.length ? `Differ: ${bytecode.differ.join(", ")}` : "GET /v1/proof, chain.bytecode"}
          />
          <Tile
            id="enforcers"
            label="Rule enforcers identical on both chains"
            value={proof ? `${enforcersIdentical} of ${enforcers.length}` : "..."}
            source="GET /v1/proof, chain.pairs (code hashes compared here)"
          />
          <Tile
            id="commit"
            label="Built from commit"
            value={
              commit ? (
                proof?.build.commitUrl ? (
                  <a href={proof.build.commitUrl} target="_blank" rel="noreferrer" className="text-steel underline-offset-4 hover:underline">
                    {commit.slice(0, 7)}
                  </a>
                ) : (
                  commit.slice(0, 7)
                )
              ) : proof ? (
                "unknown"
              ) : (
                "..."
              )
            }
            source={proof?.build.repo ? `GET /v1/proof, build.commit of ${proof.build.repo}` : "GET /v1/proof, build.commit"}
          />
        </div>

        {records.length ? (
          <section aria-labelledby="judge-records" className="grid gap-2">
            <h2 id="judge-records" className="m-0 text-15 font-semibold text-fg-0">
              This session&apos;s records on chain
            </h2>
            <ul className="m-0 grid list-none gap-0 p-0">
              {records.map((r) => (
                <li key={r.hash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line-1 py-2.5">
                  <span className="text-13 text-fg-1">{r.label}</span>
                  <TxLink ledger={r.ledger} hash={r.hash} href={r.href} badge={r.badge} label={r.label} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="judge-links" className="grid gap-3">
          <h2 id="judge-links" className="m-0 text-15 font-semibold text-fg-0">
            Look further
          </h2>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3" data-links>
            {[
              { href: "/proof", title: "Proof", body: "Every blockchain record, the model results and the bytecode comparison." },
              { href: "/app", title: "Your agent", body: "The console of the test account you just used." },
              { href: "/treasury", title: "Company demo", body: "A company's AI treasurer, with directors' approval, across both ledgers." },
              { href: "/supervisor", title: "Regulator", body: "What a regulator sees, and how it can pause an agent." },
              { href: "/challenge", title: "Try to hack it", body: "Type your own attack; the chain still refuses it." },
              ...(proof?.build.repo
                ? [{ href: proof.build.repo.startsWith("http") ? proof.build.repo : `https://github.com/${proof.build.repo}`, title: "Source code", body: `The repository${commit ? `, at commit ${commit.slice(0, 7)}` : ""}.` }]
                : []),
            ].map((l) => {
              const external = l.href.startsWith("http");
              const cls = "yl-card yl-press grid gap-1 p-4 text-left";
              const inner = (
                <>
                  <span className="text-15 font-semibold text-fg-0">{l.title}</span>
                  <span className="text-13 text-fg-2">{l.body}</span>
                </>
              );
              return (
                <li key={l.href}>
                  {external ? (
                    <a href={l.href} target="_blank" rel="noreferrer" className={cls}>
                      {inner}
                    </a>
                  ) : (
                    <Link href={l.href} className={cls}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="judge-account" className="grid gap-3 rounded-card border border-line-2 bg-bg-1 p-4">
          <h2 id="judge-account" className="m-0 text-15 font-semibold text-fg-0">
            Your test account
          </h2>
          {deleted ? (
            <p role="status" className="m-0 text-13 text-fg-1">
              Deleted from this browser. The account and its records stay on chain, but nothing here can use it any more.
            </p>
          ) : hasAccount ? (
            <>
              <p className="m-0 text-13 text-fg-2">A test account was created for you; it holds test money only. Its key is stored in this browser and nowhere else.</p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    clearVisitorSession();
                    invalidate(...SESSION_TAGS);
                    setDeleted(true);
                  }}
                >
                  Delete this test account from this browser
                </Button>
                <Link href="/app" className={buttonClass("quiet")}>
                  Keep it and open the console
                </Link>
              </div>
            </>
          ) : (
            <p className="m-0 text-13 text-fg-2">No test account is stored in this browser.</p>
          )}
          {!deleted && !hasAccount ? (
            <button type="button" className="sr-only" onClick={() => setHasAccount(Boolean(readVisitorSession()))}>
              Check again
            </button>
          ) : null}
        </section>
      </div>
    </Stage>
  );
}
