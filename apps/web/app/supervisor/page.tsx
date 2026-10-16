import type { Metadata } from "next";
import { Supervisor } from "@/components/supervisor/supervisor";

export const metadata: Metadata = {
  title: "Supervisor",
  description: "Registry of agents, Merkle verification of receipts against both anchors, and a pause-only supervisory control.",
};

export default function SupervisorPage() {
  return <Supervisor />;
}
