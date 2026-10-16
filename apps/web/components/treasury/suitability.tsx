import { cn, shortHash, StateRing } from "@yinglong/ui";
import type { Suitability } from "@/lib/api/view";
import { LedgerChip } from "@/components/data/parts";

const CLASSES = [1, 2, 3, 4, 5] as const;

/**
 * Suitability explanation card for a sweep into a product: the product's risk class read from the
 * ProductRegistry against the maximum sealed in the mandate. Classes inside the mandate sit inside the
 * ring; the product's own class is marked; a class outside is a refusal (barred ring, inverted chip).
 */
export function SuitabilityCard({ s }: { s: Suitability }) {
  const max = s.mandateMaxRiskClass;
  const outside = s.verdict === "unsuitable";
  return (
    <section aria-label="Suitability explanation" className="grid gap-4 rounded-card border border-line-2 bg-bg-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow m-0 text-fg-muted">Suitability</p>
          <p className="m-0 mt-1 text-15 font-semibold text-fg-0">{s.product.label}</p>
          {s.product.onChainName ? (
            <p className="m-0 mt-0.5 text-12 text-fg-muted">
              Registry name: {s.product.onChainName}
              {s.product.nameMatchesRegistry === true ? ", matches the payee book" : s.product.nameMatchesRegistry === false ? ", does not match the payee book" : ""}
            </p>
          ) : null}
        </div>
        {outside ? (
          <StateRing state="refused" size={20} label="Unsuitable" error="UnsuitableProduct" />
        ) : s.verdict === "suitable" ? (
          <StateRing state="verified" size={20} label="Suitable" />
        ) : (
          <StateRing state="unknown" size={20} label={s.verdict === "not a listed product" ? "Not a listed product" : "No suitability rule sealed"} />
        )}
      </div>

      {s.riskClass !== null || max !== null ? (
        <div className="grid gap-2">
          <div className="flex items-stretch gap-1" role="img" aria-label={`Risk class ${s.riskClass ?? "not listed"} (${s.riskLabel}); the mandate allows up to class ${max ?? "none"} (${s.mandateMaxLabel}).`}>
            {CLASSES.map((c) => {
              const allowed = max !== null && c <= max;
              const mine = s.riskClass === c;
              return (
                <div
                  key={c}
                  className={cn(
                    "relative flex h-9 min-w-0 flex-1 items-center justify-center rounded-[6px] border font-mono text-12",
                    allowed ? "border-fg-2 text-fg-1" : "border-dashed border-line-3 text-fg-muted",
                    mine && (outside ? "border-refused-bg bg-refused-bg text-refused-fg" : "border-fg-1 bg-fg-1 text-bg-0"),
                  )}
                >
                  {c}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between gap-3 text-11 text-fg-muted">
            <span>{max !== null ? `Classes 1 to ${max}: allowed by the sealed mandate (${s.mandateMaxLabel})` : "No class is sealed"}</span>
            <span>{s.riskClass !== null ? `This product: class ${s.riskClass} (${s.riskLabel})` : "Not in the registry"}</span>
          </div>
        </div>
      ) : null}

      <ol className="m-0 grid gap-1.5 pl-5 text-12 text-fg-2">
        {s.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-1 pt-3 text-11 text-fg-muted">
        <span>
          {s.source.enforcer} reads <span className="font-mono">ProductRegistry.{s.source.function}</span> at{" "}
          <span className="font-mono" title={s.source.registry}>
            {shortHash(s.source.registry, 6, 4)}
          </span>
          , block <span className="font-mono">#{s.source.block}</span>
        </span>
        <LedgerChip ledger={s.source.ledger} compact />
        <span>Outcome: {s.outcome}</span>
      </div>
      <p className="m-0 text-11 text-fg-muted">{s.label}</p>
    </section>
  );
}
