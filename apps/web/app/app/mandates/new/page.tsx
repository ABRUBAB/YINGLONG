import type { Metadata } from "next";
import { MandateStudio } from "@/components/studio/studio";

export const metadata: Metadata = {
  title: "Mandate Studio",
  description: "Say it, see it, seal it: rules in your own words, compiled into on-chain caveats, decoded back, sealed with a passkey.",
};

export default function MandateStudioPage() {
  return <MandateStudio />;
}
