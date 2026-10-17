import { ViewTransition } from "react";
import { Hero } from "@/components/landing/hero";
import { TryIt } from "@/components/landing/try-it";
import { ScalesPipeline } from "@/components/landing/scales-pipeline";
import { TwinChains } from "@/components/landing/twin-chains";
import { ProofWall } from "@/components/landing/proof-wall";
import { OwnAgent } from "@/components/landing/own-agent";

/**
 * Landing, about 4,000 px at 1440 wide: the first screen says what the product is, offers the
 * three actions and shows three live numbers beside the Mandate Orbit (poster first, 3D after
 * load); then a thin strip of what you can do here, the nine checks with the last attack stopped
 * and the Judge's Challenge, the same enforcer bytecode on two ledgers, the live proof wall, and
 * your own agent. No pricing, testimonials or logo wall. `/?poster=1` renders the 3D stage alone
 * for scripts/posters.mjs. Route changes crossfade through <ViewTransition> (unsupported browsers
 * just navigate).
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  if (sp.poster === "1") {
    return (
      <main id="main" data-poster className="min-h-dvh bg-bg-0">
        <h1 className="sr-only">An AI agent that pays for you. It cannot break your rules.</h1>
        <Hero poster />
      </main>
    );
  }
  return (
    <ViewTransition>
      <main id="main">
        <Hero />
        <TryIt />
        <ScalesPipeline />
        <TwinChains />
        <ProofWall />
        <OwnAgent />
      </main>
    </ViewTransition>
  );
}
