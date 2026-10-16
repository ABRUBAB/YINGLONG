import type { Metadata } from "next";
import { Console } from "@/components/console/console";

export const metadata: Metadata = {
  title: "Console",
  description: "Nadia's console: ask Ying, review approvals, read every receipt, and see the mandate Ying acts inside.",
};

export default function ConsolePage() {
  return <Console />;
}
