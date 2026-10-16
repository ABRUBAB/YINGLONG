"use client";

import { useRef } from "react";
import { HashRing, LabelChip, shortHash } from "@yinglong/ui";
import { useAgent } from "@/lib/api/hooks";
import { ArrowIcon, ButtonLink } from "@/components/ui/button";
import { PasskeyIcon } from "@/components/shell/site-nav";
import { SectionHead } from "./sections";
import { useInView } from "./use-live";

/**
 * Your own agent: the /start flow in three verbs, beside a drawn phone (CSS and SVG, no image)
 * showing the passkey prompt that seals a mandate. The ring on the phone is the Hash Ring of the
 * live demo mandate's delegation hash (GET /v1/principals/:id/state); it turns into place when the
 * phone scrolls into view and the passkey button breathes twice (under 5 s), then rests. Both move
 * whole HTML elements (transform and opacity, on the compositor), never SVG strokes.
 */

const STEPS = [
  { n: "01", verb: "Say", text: "Write what your agent may do, in your own words. Every rule comes back as a sentence decoded from the compiled caveats." },
  { n: "02", verb: "See", text: "Compare what you said with what the code will enforce, side by side, before anything is signed." },
  { n: "03", verb: "Seal", text: "Create a passkey on this device. It is your account's only signer and signs two messages you can read first." },
] as const;

export function OwnAgent() {
  const phone = useRef<HTMLDivElement>(null);
  const inView = useInView(phone);
  const mandatesQ = useAgent("mandates", (api) => api.mandates(), ["mandates"]);
  const hash = mandatesQ.data?.find((m) => m.status === "live")?.delegationHash ?? null;
  return (
    <section aria-labelledby="own-title" className="yl-section yl-defer border-y border-line-1 bg-bg-1">
      <div className="yl-container grid items-center gap-14 lg:grid-cols-12 lg:gap-8">
        <div className="grid content-start gap-10 lg:col-span-7">
          <SectionHead
            index="08"
            eyebrow="Your own agent"
            id="own-title"
            title="Your agent, your mandate, your key"
            lead="Sign up with a passkey and get an agent with its own wallet and passport, bound by a mandate only you can change."
          />
          <ol className="m-0 grid list-none gap-0 border-t border-line-2 p-0">
            {STEPS.map((s) => (
              <li key={s.n} className="yl-reveal grid grid-cols-[3rem_1fr] gap-4 border-b border-line-1 py-5">
                <span className="kicker pt-1">{s.n}</span>
                <div>
                  <h3 className="type-display m-0 text-22 text-fg-0">{s.verb}</h3>
                  <p className="m-0 mt-1.5 max-w-[52ch] text-15 text-fg-2">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href="/start" size="lg">
              <PasskeyIcon size={16} />
              Sign up with your passkey
            </ButtonLink>
            <ButtonLink href="/app" variant="quiet" size="lg">
              Or watch Nadia&apos;s agent first <ArrowIcon />
            </ButtonLink>
          </div>
          <div className="flex flex-wrap gap-2">
            <LabelChip>Test units only</LabelChip>
            <LabelChip>Your passkey never leaves this device</LabelChip>
          </div>
        </div>

        <div className="flex justify-center lg:col-span-5" ref={phone}>
          <div className="yl-phone relative w-[min(78vw,300px)] p-2.5" aria-hidden="true">
            <div className="yl-phone-screen relative flex h-full flex-col overflow-hidden">
              {/* status bar and the page behind the prompt */}
              <div className="flex items-center justify-between px-6 pt-4 font-mono text-[10px] text-fg-muted">
                <span>app.yinglong-agent.tech</span>
                <span className="h-1.5 w-6 rounded-pill bg-line-2" />
              </div>
              <div className="grid gap-2 px-6 pt-6">
                <span className="eyebrow text-[9px] text-fg-muted">Seal</span>
                <span className="h-2 w-3/4 rounded-pill bg-bg-3" />
                <span className="h-2 w-1/2 rounded-pill bg-bg-3" />
                <span className="mt-2 h-2 w-2/3 rounded-pill bg-bg-3" />
                <span className="h-2 w-5/12 rounded-pill bg-bg-3" />
              </div>
              {/* the passkey sheet */}
              <div className="mt-auto grid justify-items-center gap-3 rounded-t-[22px] border-t border-line-2 bg-bg-2 px-5 pt-5 pb-6 text-center">
                <span className="h-1 w-9 rounded-pill bg-line-3" />
                <div className="relative grid size-[132px] place-items-center">
                  {hash ? (
                    inView ? (
                      <span className="yl-ring-in block" style={{ ["--d" as string]: "0ms" }}>
                        <HashRing hash={hash} size={132} phase="sealed" bare />
                      </span>
                    ) : (
                      <span className="size-[132px]" />
                    )
                  ) : (
                    <svg viewBox="0 0 132 132" width="132" height="132">
                      <circle cx="66" cy="66" r="44" fill="none" stroke="var(--chrome-1)" strokeWidth="1.5" />
                    </svg>
                  )}
                  <span className={`absolute inline-flex size-[58px] items-center justify-center rounded-pill border border-line-2 bg-bg-2 text-fg-0${inView ? " yl-passkey-ring" : ""}`}>
                    <svg viewBox="0 0 48 48" width="34" height="34">
                      <g>
                        <circle cx="16" cy="24" r="8" fill="none" stroke="currentColor" strokeWidth="2.6" />
                        <path d="M24 24h17M35.5 24v6.5M41 24v5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                      </g>
                    </svg>
                  </span>
                </div>
                <p className="m-0 text-13 font-medium text-fg-0">Use your passkey to seal this mandate</p>
                <p className="m-0 font-mono text-[10px] text-fg-muted">{hash ? `delegation ${shortHash(hash, 8, 6)}` : "delegation hash appears here"}</p>
                <span className="mt-1 inline-flex h-9 w-full items-center justify-center rounded-control bg-fg-1 text-12 font-medium text-bg-0">Continue</span>
                <span className="text-11 text-fg-muted">Cancel</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
