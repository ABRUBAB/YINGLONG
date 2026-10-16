"use client";

import NumberFlow from "@number-flow/react";
import { formatUnits } from "@/lib/format";
import { useMotionOff } from "@/components/preferences";

/**
 * Animated amount for gauges only (never on approval screens, refusals or the drill: master plan
 * 14.8). The value is passed to Intl as an exact decimal string, so no float ever touches the money.
 */
export function AmountFlow({ value, decimals, fractionDigits = 2, className }: { value: bigint; decimals: number; fractionDigits?: number; className?: string }) {
  const motionOff = useMotionOff();
  const exact = formatUnits(value, decimals, fractionDigits).replace(/,/g, "");
  return (
    <NumberFlow
      className={className}
      value={exact as unknown as number}
      format={{ minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits, useGrouping: true }}
      locales="en-US"
      animated={!motionOff}
      willChange={false}
    />
  );
}
