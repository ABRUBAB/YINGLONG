"use client";

import Link from "next/link";
import { Activity, useState } from "react";
import { LabelChip, StateRing } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { isSample } from "@/lib/api";
import { clearVisitorSession } from "@/lib/api/session";
import { useVisitorSession } from "@/components/session";
import { formatTime, railLabel } from "@/lib/format";
import { Sheet } from "@/components/ui/sheet";
import { Tabs, TabPanel } from "@/components/ui/controls";
import { LedgerChip } from "@/components/data/parts";
import { PageHeader, TestUnitsChip } from "@/components/data/panel";
import { AskBox } from "./ask";
import { Approvals } from "./approvals";
import { ActivityTable } from "./activity";
import { MandatesList } from "./mandates";
import { AuthorityPanel } from "./authority-panel";
import { InsightsPanel } from "./insights";
import { CoveragePanel, EscrowsPanel } from "./protection";
import { CredentialsPanel } from "./credentials";
import { HealthLine } from "@/components/data/health-line";
import { VideoExperience } from "@/components/media/video-experience";

type Tab = "activity" | "mandates";

/**
 * /app: the centre column (ask, waiting for you, money, protection and credit, records) and the
 * 320 px Authority panel. Below 1024 px the panel opens as a sheet. Both record views stay mounted
 * under <Activity>, so switching tabs keeps scroll position and drawer state.
 */
export function Console() {
  const [tab, setTab] = useState<Tab>("activity");
  const [sheet, setSheet] = useState(false);
  const me = useAgent("me", (api) => api.me(), ["me", "pause"]);
  const mandates = useAgent("mandates", (api) => api.mandates(), ["mandates"]);
  const live = mandates.data?.find((m) => m.status === "live");
  const visitor = useVisitorSession();

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-6">
      <div className="mx-auto w-full max-w-[960px] px-4 pt-6 pb-14 sm:px-6 lg:px-8 lg:pt-8">
        <PageHeader
          eyebrow="Agent console"
          title={me.data ? me.data.displayName : "Console"}
          lead={`Ask for a payment or a balance, like "Pay my rent". ${me.data?.agentName ?? "The agent"} pays alone inside the rules, asks you first when it must, and refuses the rest.`}
          art="receipts-glass"
          chips={
            <>
              {visitor ? <LabelChip>Your passkey account</LabelChip> : null}
              <TestUnitsChip />
              {me.data ? <LedgerChip ledger={me.data.ledger} badge={me.data.ledgerBadge} /> : null}
              <LabelChip dotted={!visitor}>{me.data?.signer ?? "passkey"}</LabelChip>
            </>
          }
          actions={
            <>
              <VideoExperience
                src="/videos/student-demo.mp4"
                eyebrow="Student demo"
                title="Nadia's student agent"
                buttonLabel="Watch the student demo"
                ctaHref="/start"
                ctaLabel="Create your own agent"
                size="md"
              />
              <button
                type="button"
                onClick={() => setSheet(true)}
                className="yl-press inline-flex h-8 items-center gap-2 rounded-control border border-line-3 px-3 text-13 text-fg-1 lg:hidden"
                aria-haspopup="dialog"
              >
                <StateRing state={me.data?.paused ? "paused" : live ? "sealed" : "expired"} size={16} glyphOnly label="Mandate" />
                Authority
              </button>
            </>
          }
        >
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-fg-muted">
            {me.data?.paused ? (
              <StateRing state="paused" size={16} label={`${me.data.agentName} is paused`} />
            ) : live ? (
              <StateRing state="sealed" size={16} label={`${me.data?.agentName ?? "The agent"} acts inside mandate v${live.version}`} />
            ) : mandates.data ? (
              <StateRing state="expired" size={16} label="No live mandate: the agent has no authority" />
            ) : null}
            {live?.sealedAt ? <span>sealed {formatTime(live.sealedAt)}</span> : null}
            {me.data ? <span>{railLabel(me.data.jurisdiction, me.data.ledgerBadge)}</span> : null}
          </p>
          {visitor ? (
            <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-muted">
              <span>Every signature here is your passkey on this device.</span>
              <button type="button" onClick={() => clearVisitorSession()} className="text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-0">
                Forget on this device
              </button>
            </p>
          ) : (
            <p className="m-0 text-12 text-fg-muted">
              This is Nadia&apos;s demo account (a fictional person).{" "}
              <Link href="/start" className="text-fg-1 underline decoration-line-3 underline-offset-4 hover:text-fg-0">
                Try it with your own passkey
              </Link>
            </p>
          )}
        </PageHeader>

        <div className="mt-8 grid gap-10">
          <AskBox />
          <Approvals />

          {visitor && isSample ? null : (
            <section aria-labelledby="money-h" className="grid gap-4">
              <SectionLabel id="money-h" index="01" title="Money this period" />
              <InsightsPanel />
            </section>
          )}

          {visitor ? null : (
            <section aria-labelledby="protect-h" className="grid gap-4">
              <SectionLabel id="protect-h" index="02" title="Protection and credit" />
              <div className="grid gap-4 xl:grid-cols-2">
                <CoveragePanel />
                <CredentialsPanel />
              </div>
              <EscrowsPanel />
            </section>
          )}

          <section aria-labelledby="records-h" className="grid gap-4">
            <SectionLabel id="records-h" index={visitor ? (isSample ? "01" : "02") : "03"} title="Records" />
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              label="Records"
              tabs={[
                { value: "activity", label: "Activity" },
                { value: "mandates", label: "Mandates" },
              ]}
            >
              <TabPanel value="activity" keepMounted className="pt-4 focus-visible:outline-none" hidden={tab !== "activity"}>
                <Activity mode={tab === "activity" ? "visible" : "hidden"}>
                  <ActivityTable />
                </Activity>
              </TabPanel>
              <TabPanel value="mandates" keepMounted className="pt-4 focus-visible:outline-none" hidden={tab !== "mandates"}>
                <Activity mode={tab === "mandates" ? "visible" : "hidden"}>
                  <MandatesList />
                </Activity>
              </TabPanel>
            </Tabs>
          </section>
          <HealthLine />
        </div>
      </div>

      <aside
        aria-label="Authority"
        className="sticky top-[var(--nav-h)] hidden h-[calc(100dvh-var(--nav-h))] overflow-y-auto border-l border-line-1 bg-bg-1 px-6 py-8 lg:block"
      >
        <AuthorityPanel morph />
      </aside>

      <Sheet open={sheet} onOpenChange={setSheet} title="Authority" description="The mandate the agent acts inside, as rings." side="bottom">
        <AuthorityPanel />
      </Sheet>
    </div>
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
