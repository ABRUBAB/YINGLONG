"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getApi } from "@/lib/api";
import { invalidate } from "@/lib/api/hooks";
import { markHydrated, readVisitorSession, subscribeVisitorSession, type VisitorSession } from "@/lib/api/session";

const SESSION_TAGS = ["me", "pause", "mandates", "budgets", "receipts", "approvals", "passport", "session"];

/**
 * Mounted once in the root layout. After hydration it lets render-time (fixture) reads see the visitor
 * session, and refreshes every view when the session appears, changes or is cleared.
 */
export function SessionSync() {
  useEffect(() => {
    markHydrated();
    // Live reads already used the session (they never run during render); fixture reads did not.
    if (getApi().mode === "fixtures" && readVisitorSession()) invalidate(...SESSION_TAGS);
    return subscribeVisitorSession(() => invalidate(...SESSION_TAGS));
  }, []);
  return null;
}

/** The visitor signed up on this device, or null (always null during server render and hydration). */
export function useVisitorSession(): VisitorSession | null {
  return useSyncExternalStore(subscribeVisitorSession, readVisitorSession, () => null);
}
