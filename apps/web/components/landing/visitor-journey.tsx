import Link from "next/link";
import { ArrowIcon } from "@/components/ui/button";

const STEPS = [
  { n: "01", label: "See it work", note: "Follow a payment from request to receipt.", href: "/judge" },
  { n: "02", label: "Try to break it", note: "Test what happens when a request crosses a rule.", href: "/challenge" },
  { n: "03", label: "Check the proof", note: "Inspect the records behind the result.", href: "/proof" },
] as const;

/** A short path for first-time visitors, linking the demo to the challenge and its evidence. */
export function VisitorJourney() {
  return (
    <nav aria-label="A quick tour" className="border-y border-line-1 bg-bg-1/50">
      <ol className="yl-container m-0 grid list-none divide-y divide-line-1 p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {STEPS.map((step) => (
          <li key={step.n}>
            <Link href={step.href} className="group grid min-h-24 grid-cols-[2rem_minmax(0,1fr)_1rem] items-center gap-3 px-2 py-4 no-underline sm:px-5">
              <span className="kicker text-fg-muted">{step.n}</span>
              <span className="grid gap-0.5">
                <span className="text-13 font-semibold text-fg-0 group-hover:text-accent">{step.label}</span>
                <span className="text-12 text-fg-muted">{step.note}</span>
              </span>
              <span className="text-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg-0"><ArrowIcon /></span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
