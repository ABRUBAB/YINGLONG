import { Hero } from "@/components/landing/hero";
import { Pillars, Scenarios } from "@/components/landing/sections";
import { Verbs } from "@/components/landing/verbs";
import { ChallengeCta, Evidence, EvidenceRibbon } from "@/components/landing/live-sections";

/**
 * Landing (docs/DESIGN.md section 8): the Mandate Orbit hero (poster first, 3D after load), the
 * evidence ribbon of real hashes, the five pillars, the seven verbs as a scroll story, one engine
 * and two scenarios, generated evidence, and the Judge's Challenge. No pricing, testimonials or
 * logo wall. `/?poster=1` renders the 3D stage alone for scripts/posters.mjs.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  if (sp.poster === "1") {
    return (
      <main id="main" data-poster data-surface="obsidian" className="min-h-dvh bg-bg-0">
        <h1 className="sr-only">Always with you. Never beyond your mandate.</h1>
        <Hero poster />
      </main>
    );
  }
  return (
    <main id="main">
      <Hero />
      <EvidenceRibbon />
      <Pillars />
      <Verbs />
      <Scenarios />
      <Evidence />
      <ChallengeCta />
    </main>
  );
}
