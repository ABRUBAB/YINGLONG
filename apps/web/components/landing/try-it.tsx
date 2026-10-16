import Link from "next/link";
import { SectionHead } from "./sections";

/**
 * "What you can do here": the first thing under the hero, in plain words, so a visitor sees every
 * interaction the site offers and where it is.
 */
const THINGS = [
  {
    href: "/start",
    title: "Create your own AI agent",
    body: "Write spending rules in plain English, lock them with your fingerprint or a secret key, and let your agent pay inside them.",
    action: "Create your agent",
  },
  {
    href: "/app",
    title: "See a student's agent",
    body: "Nadia's agent pays rent and groceries on its own, and asks her first before anything bigger. Try asking it to pay something.",
    action: "Open the student demo",
  },
  {
    href: "/treasury",
    title: "See a company's AI treasurer",
    body: "It pays suppliers and runs payroll. Big decisions need two of three directors to approve.",
    action: "Open the company demo",
  },
  {
    href: "/challenge",
    title: "Try to hack an agent",
    body: "Type any trick you like. See which safety check stops it, with the blocked transaction on a real blockchain.",
    action: "Try to hack it",
  },
  {
    href: "/proof",
    title: "Check the proof",
    body: "Every claim on this site links to a real blockchain record. Open any of them and check it yourself.",
    action: "Open the proof",
  },
  {
    href: "/city",
    title: "Watch it live",
    body: "A live map of every agent and payment as it happens, and a regulator view that can pause any agent.",
    action: "Open the live map",
  },
] as const;

export function TryIt() {
  return (
    <section aria-labelledby="try-title" className="yl-section border-t border-line-1">
      <div className="yl-container">
        <SectionHead
          index="01"
          eyebrow="What you can do here"
          id="try-title"
          title="Six things to try, no account needed for most"
          lead="Everything runs on test money. Nothing here is real money or touches a bank."
        />
        <ul className="m-0 mt-12 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {THINGS.map((t, i) => (
            <li key={t.href}>
              <Link href={t.href} className="yl-card yl-press grid h-full content-start gap-3 p-5 no-underline">
                <span className="font-mono text-12 text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-18 font-semibold text-fg-0">{t.title}</span>
                <span className="text-13 text-fg-2">{t.body}</span>
                <span className="mt-1 text-13 font-medium text-fg-0">
                  {t.action} <span aria-hidden="true">-&gt;</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
