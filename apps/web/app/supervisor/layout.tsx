import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

export default function SupervisorLayout({ children }: { children: ReactNode }) {
  return <AppShell persona="supervisor">{children}</AppShell>;
}
