"use client";

import Link from "next/link";
import { Activity, useState } from "react";
import { LabelChip, StateRing } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { clearVisitorSession } from "@/lib/api/session";
import { useVisitorSession } from "@/components/session";
import { formatTime, railLabel } from "@/lib/format";
import { Sheet } from "@/components/ui/sheet";
import { Tabs, TabPanel } from "@/components/ui/controls";
import { SampleBadge } from "@/components/data/parts";
import { AskBox } from "./ask";
import { Approvals } from "./approvals";
import { ActivityTable } from "./activity";
import { MandatesList } from "./mandates";
import { AuthorityPanel } from "./authority-panel";
import { HealthLine } from "@/components/data/health-line";

type Tab = "activity" | "mandates";

/**
 * /app: centre column (Ask, Waiting for you, Activity | Mandates) and the 320 px Authority panel.
 * Below 1024 px the panel opens as a sheet. Both list views stay mounted under <Activity>, so
 * switching tabs keeps scroll position and drawer state.
 */
export function Console() {
  const [tab, setTab] = useState<Tab>("activity");
  const [sheet, setSheet] = useState(false);
  const me = useAgent("me", (api) => api.me(), ["me", "pause"]);
  const mandates = useAgent("mandates", (api) => api.mandates(), ["mandates"]);
  const live = mandates.data?.find((m) => m.status === "live");
  const visitor = useVisitorSession();

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="mx-auto w-full max-w-[880px] px-4 pt-6 pb-12 sm:px-6 lg:px-8 lg:pt-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow m-0 text-fg-muted">Console</p>
            <h1 className="m-0 mt-1 text-22 font-semibold text-fg-0 sm:text-26">
              {me.data ? `${me.data.displayName}` : "Console"}
            </h1>
            <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-fg-muted">
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
              <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-muted">
                <LabelChip>Your passkey account</LabelChip>
                <span>Every signature here is your passkey on this device.</span>
                <button type="button" onClick={() => clearVisitorSession()} className="text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-0">
                  Forget on this device
                </button>
              </p>
            ) : (
              <p className="m-0 mt-2 text-12 text-fg-muted">
                This is Nadia&apos;s demo account.{" "}
                <Link href="/start" className="text-fg-1 underline decoration-line-3 underline-offset-4 hover:text-fg-0">
                  Try it with your own passkey
                </Link>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SampleBadge />
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="inline-flex h-8 items-center rounded-control border border-line-3 px-3 text-13 text-fg-1 lg:hidden"
              aria-haspopup="dialog"
            >
              Authority
            </button>
          </div>
        </header>

        <div className="grid gap-9">
          <AskBox />
          <Approvals />
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
          <HealthLine />
        </div>
      </div>

      <aside
        aria-label="Authority"
        className="sticky top-[var(--nav-h)] hidden h-[calc(100dvh-var(--nav-h))] overflow-y-auto border-l border-line-1 bg-bg-1 px-6 py-8 lg:block"
      >
        <AuthorityPanel morph />
      </aside>

      <Sheet open={sheet} onOpenChange={setSheet} title="Authority" description="The mandate Ying acts inside, as rings." side="bottom">
        <AuthorityPanel />
      </Sheet>
    </div>
  );
}
