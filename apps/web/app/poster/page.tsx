import type { Metadata } from "next";
import { Hero } from "@/components/landing/hero";

export const metadata: Metadata = {
  title: "Poster stage",
  robots: { index: false, follow: false },
};

/** The 3D stage alone on a plain page, for scripts/posters.mjs (fixed state, no events). Not linked from the site. */
export default function PosterPage() {
  return (
    <main id="main" data-poster className="min-h-dvh bg-bg-0">
      <h1 className="sr-only">An AI agent that pays for you. It cannot break your rules.</h1>
      <Hero poster />
    </main>
  );
}
