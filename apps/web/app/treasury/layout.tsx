import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

export default function TreasuryLayout({ children }: { children: ReactNode }) {
  return <AppShell persona="lotus">{children}</AppShell>;
}
