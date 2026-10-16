import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/site-header";
import { Challenge } from "@/components/challenge/challenge";

export const metadata: Metadata = {
  title: "Judge's Challenge",
  description: "Nothing you type can move funds outside the mandate. Try: a guest mandate, any attack, and the scale that stopped it.",
};

export default function ChallengePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Challenge />
      </main>
    </>
  );
}
