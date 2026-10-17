import type { ReactNode } from "react";
import { cn } from "@yinglong/ui";

/** Section head: mono index, eyebrow, display h2 and an optional lead. Used on every marketing section. */
export function SectionHead({
  index,
  eyebrow,
  title,
  lead,
  id,
  className,
  children,
}: {
  index: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  id: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("yl-section-head grid content-start gap-4", className)}>
      <p className="m-0 flex items-center gap-3">
        <span className="kicker">{index}</span>
        <span aria-hidden="true" className="h-px w-6 bg-line-2" />
        <span className="eyebrow text-fg-muted">{eyebrow}</span>
      </p>
      <h2 id={id} className="type-display yl-reveal m-0 max-w-[20ch] text-h2 text-fg-0">
        {title}
      </h2>
      {lead ? <p className="yl-reveal m-0 max-w-[46ch] text-15 text-fg-2 sm:text-18 sm:leading-[1.6]">{lead}</p> : null}
      {children}
    </div>
  );
}
