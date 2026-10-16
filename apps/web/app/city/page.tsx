import type { Metadata } from "next";
import { AgentCity } from "@/components/city/city";

export const metadata: Metadata = {
  title: "Agent City",
  description:
    "Greater Bay: the Shenzhen coin-free FISCO rail and the Hong Kong test rail, every principal, agent passport, payee and payment read live from the agent service, with anchors across the seam.",
};

export default function CityPage() {
  return (
    <main id="main">
      <AgentCity />
    </main>
  );
}
