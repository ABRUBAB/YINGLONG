/**
 * Optional integration check against a running agent service (read-only endpoints).
 * Run: AGENT_API_IT=http://127.0.0.1:8787 pnpm --filter web test
 * Skipped when AGENT_API_IT is not set, so CI never depends on the service.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLiveApi } from "./live";
import * as V from "./view";
import { guardSigningRequest } from "../signing-guard";
import { decodePayment, executionHash } from "../chain";
import { compareHashRing } from "../hash-ring-check";
import type { Hex } from "viem";

const base = process.env.AGENT_API_IT;

describe.skipIf(!base)("live adapter against the running agent service", () => {
  const api = createLiveApi(base ?? "http://127.0.0.1:8787");

  it("reads parse into the view model", async () => {
    V.Health.parse(await api.health());
    V.Principal.parse(await api.me());
    const mandates = z.array(V.Mandate).parse(await api.mandates());
    for (const m of mandates) expect(compareHashRing(m.delegationHash, m.serviceHashRing)).toBe("match");
    z.array(V.BudgetLane).parse(await api.budgets());
    V.Page(V.Receipt).parse(await api.receipts());
    z.array(V.RegistryAgent).parse(await api.registry());
    V.EvidenceSummary.parse(await api.evidence());
    for (const e of (await api.treasuryEntities()) as V.TreasuryEntity[]) V.TreasuryView.parse(await api.treasury(e.id));
  }, 60_000);

  it("approvals pass the signing guard and decode with the PaymentDecoder port", async () => {
    const ids: string[] = [];
    for (const principal of ["nadia", "lotus-sz"]) {
      const raw = (await (await fetch(`${base}/v1/approvals?principal=${principal}`)).json()) as Array<{ id: string }>;
      // The 8 most recent per principal: the service allows 60 requests a minute per IP.
      ids.push(...raw.slice(-8).map((r) => r.id));
    }
    const list = await Promise.all(ids.map(async (id) => V.ApprovalRequest.parse(await api.approval(id))));
    for (const a of list) {
      expect(guardSigningRequest(a)).toMatchObject({ ok: true });
      if (a.execution && a.kind === "cosign") {
        const pay = decodePayment(a.execution.target as Hex, BigInt(a.execution.value), a.execution.callData as Hex);
        expect(pay.amount.toString()).toBe(a.decoded?.amount?.value);
        expect(a.typedData.message.executionHash).toBe(executionHash(a.execution.target as Hex, BigInt(a.execution.value), a.execution.callData as Hex));
      }
    }
  }, 60_000);
});
