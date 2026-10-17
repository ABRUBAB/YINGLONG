import Link from "next/link";
import { ArrowIcon } from "@/components/ui/button";

/**
 * "What you can do here": one thin strip under the hero, six hairline rows (no cards), so a visitor
 * sees every interaction the site offers and where it is.
 */
const THINGS = [
  { href: "/judge", title: "Start the 3-minute demo", body: "The whole system, one click at a time, for a judge." },
  { href: "/start", title: "Create your own agent", body: "Write rules in plain English and lock them with your fingerprint." },
  { href: "/app", title: "See a student's agent", body: "It pays rent and food on its own and asks first for anything bigger." },
  { href: "/treasury", title: "See a company's treasurer", body: "Suppliers and payroll; big payments need two of three directors." },
  { href: "/challenge", title: "Try to hack an agent", body: "Type any trick and see which check stops it, on a real blockchain." },
  { href: "/proof", title: "Check the proof", body: "Every claim links to a blockchain record you can open yourself." },
] as const;

export function TryIt() {
  return (
    <section aria-labelledby="try-title" className="border-t border-line-1 bg-bg-1">
      <div className="yl-container grid gap-6 py-8 lg:grid-cols-12 lg:gap-8">
        <div className="grid content-start gap-2 lg:col-span-3">
          <p className="eyebrow m-0 text-fg-muted">What you can do here</p>
          <h2 id="try-title" className="type-display m-0 text-22 leading-tight text-fg-0">
            Six things to try
          </h2>
          <p className="m-0 text-13 text-fg-2">Test money only. Nothing here touches a bank.</p>
        </div>
        <ol className="m-0 grid list-none gap-x-8 gap-y-0 border-t border-line-2 p-0 sm:grid-cols-2 lg:col-span-9 lg:grid-cols-3">
          {THINGS.map((t) => (
            <li key={t.href} className="border-b border-line-1">
              <Link href={t.href} className="group grid gap-1 py-3.5 no-underline">
                <span className="flex items-center justify-between gap-3 text-15 font-medium text-fg-0">
                  {t.title}
                  <ArrowIcon className="text-fg-muted transition-colors group-hover:text-fg-0" />
                </span>
                <span className="text-12 leading-snug text-fg-2">{t.body}</span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
