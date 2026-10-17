import type { Metadata } from "next";
import { AboutPage } from "@/components/about/about";

export const metadata: Metadata = {
  title: "About",
  description:
    "What YINGLONG is, the team behind it (Shadow Chaser, Bangladesh), the 2026 Shenzhen International FinTech Competition entry, the five pillars, the build from git, the stack, and what is honestly simulated.",
};

export default function About() {
  return <AboutPage />;
}
