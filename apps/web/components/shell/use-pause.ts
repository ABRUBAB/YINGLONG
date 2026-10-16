"use client";

import { useState } from "react";
import type { PauseState } from "@yinglong/ui";
import { invalidate, useAgent } from "@/lib/api/hooks";
import { getApi } from "@/lib/api";
import { describeSignError, signAndSubmit, SIGNER_LABEL } from "@/lib/sign";

/** One-tap pause (KillSwitchRegistry Trip, signed and relayed) and owner-only resume. */
export function usePause() {
  const status = useAgent("pause", (api) => api.pauseStatus(), ["pause"]);
  const [busy, setBusy] = useState<"pause" | "resume" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const paused = status.data?.paused ?? false;

  async function run(action: "pause" | "resume") {
    setBusy(action);
    setMessage(null);
    try {
      const req = await getApi().requestPause(action);
      const { signer } = await signAndSubmit(req);
      invalidate("pause", "passport", "receipts", "me");
      setMessage(
        action === "pause"
          ? `Paused with ${SIGNER_LABEL[signer]}. Every delegation stops in the next block.`
          : `Resumed with ${SIGNER_LABEL[signer]}.`,
      );
    } catch (e) {
      setMessage(describeSignError(e));
    } finally {
      setBusy(null);
    }
  }

  const state: PauseState = busy === "pause" ? "pausing" : busy === "resume" ? "resuming" : paused ? "paused" : "active";
  return {
    state,
    paused,
    txs: status.data?.txs ?? [],
    message,
    clearMessage: () => setMessage(null),
    toggle: () => run(paused ? "resume" : "pause"),
  };
}
