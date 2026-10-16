import { Hero } from "@/components/landing/hero";
import { Questions, Scenarios, SiteFooter, Verbs } from "@/components/landing/sections";
import { ChallengeCta, Evidence } from "@/components/landing/live-sections";
import { SiteHeader } from "@/components/landing/site-header";

/**
 * Landing: six sections (master plan 14.5): hero with the Receipt Dragon (poster first), three
 * questions, the seven verbs as a scroll-driven ring, one engine and two scenarios, evidence, and the
 * Judge's Challenge. No pricing, testimonials or logo wall.
 * `/?poster=1` renders the hero alone for scripts/posters.mjs.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const poster = sp.poster === "1";
  if (poster) {
    return (
      <main id="main" data-surface="obsidian" className="min-h-dvh bg-bg-0">
        <Hero poster />
      </main>
    );
  }
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Questions />
        <Verbs />
        <Scenarios />
        <Evidence />
        <ChallengeCta />
      </main>
      <SiteFooter />
    </>
  );
}
