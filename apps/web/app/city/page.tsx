import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/site-header";
import { AgentCity } from "@/components/city/city";

export const metadata: Metadata = {
  title: "Agent City",
  description: "Greater Bay: the HK test rail and the coin-free FISCO rail, agents with passport rings, payments and anchors across the seam.",
};

export default function CityPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <AgentCity />
      </main>
    </>
  );
}
