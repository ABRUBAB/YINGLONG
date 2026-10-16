import { ViewTransition } from "react";
import { Hero } from "@/components/landing/hero";
import { Pillars, Scenarios } from "@/components/landing/sections";
import { Verbs } from "@/components/landing/verbs";
import { ChallengeCta, Evidence, EvidenceRibbon } from "@/components/landing/live-sections";
import { ScalesPipeline } from "@/components/landing/scales-pipeline";
import { TwinChains } from "@/components/landing/twin-chains";
import { ProofWall } from "@/components/landing/proof-wall";
import { OwnAgent } from "@/components/landing/own-agent";
import { TryIt } from "@/components/landing/try-it";

/**
 * Landing (docs/DESIGN.md section 8): the Mandate Orbit hero (poster first, 3D after load), the
 * evidence ribbon of real hashes, the five pillars, the seven verbs as a scroll story, the nine
 * scales with the last attack stopped, one engine and two scenarios, the same enforcer bytecode on
 * both ledgers, the live proof wall, generated evidence, your own agent, and the Judge's Challenge.
 * No pricing, testimonials or logo wall. `/?poster=1` renders the 3D stage alone for
 * scripts/posters.mjs. Route changes crossfade through <ViewTransition> (unsupported browsers just
 * navigate).
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  if (sp.poster === "1") {
    return (
      <main id="main" data-poster data-surface="obsidian" className="min-h-dvh bg-bg-0">
        <h1 className="sr-only">Always with you. Never beyond your rules.</h1>
        <Hero poster />
      </main>
    );
  }
  return (
    <ViewTransition>
      <main id="main">
        <Hero />
        <TryIt />
        <EvidenceRibbon />
        <Pillars />
        <Verbs />
        <ScalesPipeline />
        <Scenarios />
        <TwinChains />
        <ProofWall />
        <Evidence />
        <OwnAgent />
        <ChallengeCta />
      </main>
    </ViewTransition>
  );
}
