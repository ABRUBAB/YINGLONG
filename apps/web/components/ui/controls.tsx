"use client";

import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ReactNode } from "react";
import { cn } from "@yinglong/ui";

/** Segmented control (single choice) on Base UI ToggleGroup. Boundary uses line-3 (>= 3:1). */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: V;
  onChange: (v: V) => void;
  options: Array<{ value: V; label: ReactNode }>;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(v) => {
        const next = v[0] as V | undefined;
        if (next) onChange(next);
      }}
      className={cn("inline-flex rounded-control border border-line-3 p-0.5", className)}
    >
      {options.map((o) => (
        <Toggle
          key={o.value}
          value={o.value}
          className={cn(
            "inline-flex items-center justify-center rounded-[4px] px-3 font-medium whitespace-nowrap text-fg-2 transition-colors duration-150",
            "hover:text-fg-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
            "data-[pressed]:bg-fg-1 data-[pressed]:text-bg-0",
            size === "sm" ? "h-7 text-12" : "h-8 text-13",
          )}
        >
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

export function Tabs<V extends string>({
  value,
  onChange,
  tabs,
  label,
  children,
  className,
}: {
  value: V;
  onChange: (v: V) => void;
  tabs: Array<{ value: V; label: ReactNode }>;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseTabs.Root value={value} onValueChange={(v) => onChange(v as V)} className={className}>
      <BaseTabs.List aria-label={label} className="relative flex gap-6 border-b border-line-2">
        {tabs.map((t) => (
          <BaseTabs.Tab
            key={t.value}
            value={t.value}
            className={cn(
              "relative -mb-px inline-flex h-10 items-center gap-2 border-b-2 border-transparent text-13 font-medium text-fg-muted transition-colors",
              "hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              "data-[active]:border-fg-1 data-[active]:text-fg-0",
            )}
          >
            {t.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  );
}

export const TabPanel = BaseTabs.Panel;

export function Switch({
  checked,
  onChange,
  label,
  description,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  id: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <BaseSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v)}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-pill border border-line-3 transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          "data-[checked]:border-fg-1 data-[checked]:bg-fg-1",
        )}
      >
        <BaseSwitch.Thumb
          className={cn(
            "block size-3.5 translate-x-[3px] rounded-pill bg-fg-2 transition-transform duration-150",
            "data-[checked]:translate-x-[18px] data-[checked]:bg-bg-0",
          )}
        />
      </BaseSwitch.Root>
      <label htmlFor={id} className="grid gap-0.5">
        <span className="text-13 font-medium text-fg-1">{label}</span>
        {description ? (
          <span id={`${id}-desc`} className="text-12 text-fg-muted">
            {description}
          </span>
        ) : null}
      </label>
    </div>
  );
}
