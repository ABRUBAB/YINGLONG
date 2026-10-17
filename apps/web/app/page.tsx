import { ViewTransition } from "react";
import { Hero } from "@/components/landing/hero";
import { LiveTicker } from "@/components/landing/live-ticker";
import { Bento } from "@/components/landing/bento";
import { RulesLab } from "@/components/landing/rules-lab";
import { ScalesPipeline } from "@/components/landing/scales-pipeline";
import { TwinChains } from "@/components/landing/twin-chains";
import { ProofWall } from "@/components/landing/proof-wall";
import { OwnAgent } from "@/components/landing/own-agent";
import { FinalCta } from "@/components/landing/final-cta";
import { ReceiptChain } from "@/components/landing/receipt-chain";

/**
 * Landing: the first screen says what the product is, offers the three actions and shows three live
 * numbers beside the Mandate Orbit (poster first, 3D after load), with real receipts drifting past in
 * a strip under it. Then, in the order a visitor would ask: six things to try (living tiles); a
 * practice run of the rules they can drive (Rules Lab); the nine checks as a place to scroll through
 * (3D, with the flat rail as the fallback) and the Judge's Challenge; a phone to say, see and seal
 * their own agent on; the same enforcer bytecode on two ledgers; the live proof wall; and a closing
 * call to action. No pricing, testimonials or logo wall. `/?poster=1` renders the 3D stage alone
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
        <LiveTicker />
        <Bento />
        <RulesLab />
        <ScalesPipeline />
        <OwnAgent />
        <ReceiptChain />
        <TwinChains />
        <ProofWall />
        <FinalCta />
      </main>
    </ViewTransition>
  );
}
