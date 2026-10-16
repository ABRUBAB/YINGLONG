import type { Metadata } from "next";
import { ApproveCard } from "@/components/approve/approve-card";

export const metadata: Metadata = {
  title: "Approve",
  description: "One approval, decoded on your own device, signed with one passkey.",
  robots: { index: false, follow: false },
};

export default async function ApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApproveCard id={decodeURIComponent(id)} />;
}
