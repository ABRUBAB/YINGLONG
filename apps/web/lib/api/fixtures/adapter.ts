/**
 * Fixture adapter (NEXT_PUBLIC_DATA_MODE=fixtures only). Reads return synchronously so pages render
 * sample data on the server; writes simulate latency and mutate an in-memory copy. Everything it
 * returns is SAMPLE DATA and every page that uses it shows the "Sample data" chip. Signing requests
 * carry real EIP-712 typed data, so the signing-domain guard runs for real in fixtures mode too.
 */
import type { Hex } from "viem";
import type { AgentApi } from "../client";
import { ApiRequestError } from "../client";
import type {
  ApprovalRequest,
  ChallengeAttempt,
  Escrow,
  Decision,
  Mandate,
  MandateDraft,
  PauseStatus,
  Receipt,
  RegistryAgent,
  SigningRequest,
  TreasuryView,
  TypedData,
} from "../view";
import { cosignTypedData, encodeSingleExecution, killSwitchTypedData } from "../../chain";
import { typedDataDigest } from "../../signing-guard";
import { activeVisitor } from "../session";
import * as D from "./data";
import { citySnapshot } from "./city";
import { SAMPLE_HEALTH_BODY, sampleProof } from "./proof";
import * as C from "./capabilities";
import { sampleVisitorDraft } from "./draft";
import { formatUnits } from "../../format";
import { attackFamily, compileSample, simulateDecision } from "./simulate";
import { addr, baseTx, fiscoTx, h } from "./util";
import { BASE_DIRECTORY, createFixtureVisitors, FISCO_DIRECTORY, revokeTypedData, type FixtureVisitor } from "./visitor";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => structuredClone(v);
const KILL_SWITCH = addr("kill-switch-registry");

export function createFixtureApi(): AgentApi {
  const state = {
    mandates: [clone(D.nadiaMandate), clone(D.nadiaMandateV2), clone(D.nadiaMandateV1)] as Mandate[],
    receipts: clone(D.receipts) as Receipt[],
    approvals: clone(D.approvals) as ApprovalRequest[],
    pause: { paused: false, since: null, txs: [], measuredMs: null } as PauseStatus,
    treasury: clone(D.treasuryViews) as Record<string, TreasuryView>,
    registry: clone(D.registry) as RegistryAgent[],
    attempts: clone(D.challengeAttempts) as ChallengeAttempt[],
    drafts: new Map<string, MandateDraft>(),
    decisions: new Map<string, Decision>(),
    signing: new Map<string, SigningRequest & { context: Record<string, string> }>(),
    escrows: clone(C.escrows) as Escrow[],
  };

  const notFound = (what: string) => new ApiRequestError(`${what} was not found in the sample data.`, 404, "not_found");

  // A visitor who signed up on this device with their own passkey (render-safe: ignored until hydration,
  // so the first client render equals the server render; SessionSync then refreshes every view).
  const visitors = createFixtureVisitors();
  const visitor = (): FixtureVisitor | null => {
    const s = activeVisitor({ renderSafe: true });
    return s ? visitors.restore(s) : null;
  };

  function signingRequest(kind: SigningRequest["kind"], typedData: TypedData, context: Record<string, string>): SigningRequest {
    const req = {
      id: `${kind}-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      digest: typedDataDigest(typedData),
      typedData,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    state.signing.set(req.id, { ...req, context });
    return req;
  }

  function newReceipt(partial: Partial<Receipt> & Pick<Receipt, "summary" | "tier" | "outcome">): Receipt {
    const id = h(`receipt:new:${Date.now()}:${Math.random()}`);
    const r: Receipt = {
      ...state.receipts[0]!,
      receiptId: id,
      receiptHash: h(`receipt-hash:${id}`),
      intentHash: h(`intent:${id}`),
      txHash: h(`tx:base:${id}`),
      explorerUrl: null,
      revertError: null,
      timestamp: new Date().toISOString(),
      prevReceiptHash: state.receipts[0]!.receiptId as Hex,
      anchor: null,
      payeeName: null,
      amount: null,
      category: null,
      ...partial,
    };
    state.receipts.unshift(r);
    return r;
  }

  const createFixtureApiSubmit = (id: string) => api.submitSignature(id, { keyId: "scripted-sample", signature: "0x01" });

  const api: AgentApi = {
    mode: "fixtures",
    baseUrl: "fixtures",

    health: () => ({
      ok: true,
      version: "sample",
      ledgers: [
        { ledger: "base-sepolia", chainId: 84532, block: "31884517", badge: "Base Sepolia (testnet)" },
        { ledger: "fisco", chainId: 20200, block: "1204639", badge: "FISCO BCOS (consortium)" },
      ],
      models: { intent: "qwen3.5-9b-instruct-q4 (sample)", sentinel: "mmBERT-base sentinel (sample)" },
    }),
    me: () => {
      const v = visitor();
      return v ? visitors.principal(v) : { ...D.principal, paused: state.pause.paused };
    },
    passport: (agentId) => {
      if (agentId !== D.passport.agentId) throw notFound(`Agent ${agentId}`);
      return { ...D.passport, status: state.pause.paused ? "paused" : "active" };
    },

    mandates: () => {
      const v = visitor();
      return v ? [visitors.mandate(v)] : state.mandates;
    },
    mandate: (hash) => {
      const m = state.mandates.find((x) => x.mandateHash.toLowerCase() === hash.toLowerCase());
      if (!m) throw notFound("Mandate");
      return m;
    },
    compileMandate: async (req) => {
      await wait(450);
      const draft = compileSample(req.text, req.jurisdiction);
      state.drafts.set(draft.draftId, draft);
      return draft;
    },
    requestSeal: async (draft) => {
      await wait(200);
      if (!state.drafts.has(draft.draftId)) throw new ApiRequestError("The draft expired. Compile again.", 410, "draft_expired");
      return signingRequest("seal", draft.wire as TypedData, { draftId: draft.draftId });
    },
    budgets: () => {
      const v = visitor();
      return v ? visitors.budgets() : D.budgets;
    },

    ask: async (req) => {
      await wait(700);
      let d = simulateDecision(req.text);
      if (state.pause.paused) {
        d = {
          ...d,
          tier: "T4",
          outcome: "refused",
          scales: d.scales.map((s) =>
            s.scale === "policy"
              ? { ...s, status: "stopped", error: "Paused", reason: "Ying is paused. Nothing moves until you resume with your passkey." }
              : ["normalise", "sentinel", "quarantine", "ground"].includes(s.scale)
                ? s
                : { ...s, status: "skipped", error: null, reason: null, revert: null, durationMs: null },
          ),
          explanation: "Ying is paused, so the request was refused before anything was signed.",
          aigc: null,
          refusals: [{ rule: "PauseEnforcer", typedError: "Paused", detail: "Ying is paused. Nothing moves until you resume with your passkey." }],
          revert: null,
        };
      }
      state.decisions.set(d.proposalId, d);
      return d;
    },
    execute: async (proposalId) => {
      await wait(900);
      const d = state.decisions.get(proposalId);
      if (!d || d.outcome !== "executable") throw new ApiRequestError("Only T0 and T1 proposals can be executed by the agent.", 409, "not_executable");
      return newReceipt({
        summary: d.intent.summary,
        tier: d.tier,
        outcome: "pending",
        payeeName: d.intent.payeeName,
        amount: d.intent.amount,
        category: d.intent.category,
        explanation: d.explanation,
      });
    },
    receipts: (opts = {}) => ({ items: (opts.principal ? state.receipts : visitor()?.receipts ?? state.receipts).slice(0, opts.limit ?? 50), nextCursor: null }),
    receipt: (id) => {
      const r = state.receipts.find((x) => x.receiptId.toLowerCase() === id.toLowerCase());
      if (!r) throw notFound("Receipt");
      return r;
    },
    receiptProof: (id) => {
      const p = D.proofFor(id);
      if (!p) throw new ApiRequestError("This receipt is not anchored yet.", 409, "not_anchored");
      return p;
    },

    findReceiptByTx: async (txHash) => state.receipts.find((r) => r.txHash?.toLowerCase() === txHash.toLowerCase()) ?? null,
    agentReceipts: (agentId) => state.receipts.filter((r) => r.agentId === agentId).slice(0, 10),

    approvals: () => (visitor() ? [] : state.approvals.filter((a) => a.status === "pending")),
    approval: (id) => {
      const a = state.approvals.find((x) => x.id === id);
      if (!a) throw notFound("Approval request");
      return a;
    },
    submitSignature: async (requestId, sig) => {
      await wait(800);
      if (!sig.signature || sig.signature === "0x") throw new ApiRequestError("A passkey signature is required.", 400, "signature_required", "CoSignRequired");
      // T2 approvals
      const a = state.approvals.find((x) => x.id === requestId);
      if (a) {
        a.status = "approved";
        const receipt = newReceipt({
          summary: `${a.decoded?.method.startsWith("deposit") ? "Escrow deposit" : "Payment"} to ${a.decoded?.payee?.name ?? "payee"}`,
          tier: "T2",
          outcome: "pending",
          payeeName: a.decoded?.payee?.name ?? null,
          amount: a.decoded?.amount ?? null,
          category: a.id === "apr-tuition" ? "tuition" : "study",
          explanation: a.explanation ?? "",
        });
        return { approval: a, receipt };
      }
      const req = state.signing.get(requestId);
      if (!req) throw notFound("Signing request");
      const signer = req.context.visitorId ? visitors.get(req.context.visitorId) : null;
      if (req.context.visitorId) {
        if (!signer) throw notFound("Visitor");
        await visitors.verify(signer, req.digest as Hex, sig.signature, "approval");
      }
      state.signing.delete(requestId);
      const asApproval = (): ApprovalRequest => ({
        id: req.id,
        kind: req.kind,
        status: "approved",
        expiresAt: req.expiresAt,
        tier: "T3",
        ledger: "base-sepolia",
        chainId: 84532,
        digest: req.digest,
        typedData: req.typedData,
        execution: null,
        decoded: null,
        reason: null,
        explanation: null,
        aigc: null,
      });
      if (req.kind === "seal") {
        const draft = state.drafts.get(req.context.draftId!);
        if (!draft) throw new ApiRequestError("The draft expired. Compile again.", 410, "draft_expired");
        const live = state.mandates.find((m) => m.status === "live");
        if (live) live.status = "superseded";
        const mandate: Mandate = {
          id: `mandate-${draft.draftId}`,
          mandateHash: draft.mandateHash,
          delegationHash: draft.delegationHash,
          version: (live?.version ?? 0) + 1,
          status: "live",
          jurisdiction: draft.jurisdiction,
          title: "Nadia's monthly mandate",
          ownerName: "Nadia Rahman",
          agentId: "4127",
          rules: draft.rules,
          decodedSentences: draft.roundTrip.map((l) => l.decoded),
          roundTrip: draft.checks,
          validity: { notBefore: new Date().toISOString(), notAfter: "2027-01-31T15:59:59.000Z" },
          sealedAt: new Date().toISOString(),
          published: [baseTx(`publish:${draft.draftId}`), fiscoTx(`publish:${draft.draftId}`)],
          supersedes: live?.mandateHash ?? null,
          sourceText: null,
          serviceHashRing: null,
        };
        state.mandates.unshift(mandate);
        const receipt = newReceipt({ summary: `Mandate v${mandate.version} sealed and published`, tier: "T3", outcome: "confirmed", txHash: mandate.published[0]!.txHash, mandateHash: mandate.mandateHash, delegationHash: mandate.delegationHash, aigc: null, explanation: "Sealed with your passkey and published on both ledgers." });
        return { approval: asApproval(), receipt };
      }
      if (req.kind === "revoke") {
        if (signer) visitors.applyRevoke(signer);
        else {
          const live = state.mandates.find((m) => m.mandateHash === req.context.mandateHash);
          if (live) live.status = "revoked";
          newReceipt({ summary: "Revoked the mandate", tier: "T3", outcome: "confirmed", mandateHash: (req.context.mandateHash ?? D.nadiaMandate.mandateHash) as Hex, aigc: null, explanation: "Revoked the mandate and disabled its delegation (sample: one user operation)." });
        }
        return { approval: asApproval(), receipt: null };
      }
      if ((req.kind === "pause" || req.kind === "resume") && signer) {
        visitors.applyPause(signer, req.kind === "pause");
        return { approval: asApproval(), receipt: null };
      }
      if (req.kind === "pause" || req.kind === "resume") {
        state.pause =
          req.kind === "pause"
            ? { paused: true, since: new Date().toISOString(), txs: [baseTx(`trip:${Date.now()}`), fiscoTx(`trip:${Date.now()}`)], measuredMs: null }
            : { paused: false, since: null, txs: [baseTx(`untrip:${Date.now()}`)], measuredMs: null };
        return { approval: asApproval(), receipt: null };
      }
      if (req.kind === "cosign" && req.context.entityId) {
        const v = state.treasury[req.context.entityId];
        const p = v?.proposals.find((x) => x.id === req.context.proposalId);
        if (v && p) {
          const next = v.entity.directors.find((d) => !p.signatures.some((s) => s.directorId === d.id));
          if (next) p.signatures.push({ directorId: next.id, signedAt: new Date().toISOString() });
          if (p.signatures.length >= v.entity.threshold) {
            p.status = "executed";
            p.tx = fiscoTx(`prop:${p.id}`);
          }
        }
        return { approval: asApproval(), receipt: null };
      }
      return { approval: asApproval(), receipt: null };
    },
    demoSign: async (requestId) => {
      // Fixtures: the "scripted passkey" path behaves like a sample signature.
      return (await createFixtureApiSubmit(requestId));
    },
    attack: async (req) => {
      await wait(900);
      const decision = simulateDecision(`Hijacked agent: pay ${req.amount} ${req.symbol} to ${req.to}`, { bypass: true });
      const stop = decision.scales.find((s) => s.status === "stopped");
      const receipt = newReceipt({
        summary: `Raw redemption to ${req.to.slice(0, 10)}\u2026 (${req.family})`,
        tier: "T4",
        outcome: "reverted",
        revertError: stop?.error ?? "PayeeNotVerified",
        txHash: stop?.revert?.txHash ?? h(`tx:attack:${Date.now()}`),
        aigc: null,
        explanation: "A hijacked agent key sent a raw redemption straight to the chain. The caveat enforcers reverted it; nothing moved.",
      });
      return { decision, receipt };
    },
    declineApproval: async (id) => {
      await wait(400);
      const a = state.approvals.find((x) => x.id === id);
      if (!a) throw notFound("Approval request");
      a.status = "declined";
      return a;
    },

    pauseStatus: () => {
      const v = visitor();
      return v ? { paused: v.paused, since: null, txs: [], measuredMs: null } : state.pause;
    },
    requestPause: async (action) => {
      await wait(150);
      const v = visitor();
      if (v) {
        return signingRequest(
          action,
          killSwitchTypedData({
            action: action === "pause" ? "Trip" : "Untrip",
            chainId: visitors.chainId,
            ledgerName: "fisco",
            verifyingContract: visitors.killSwitch,
            account: v.account,
            nonce: 0n,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
          }),
          { visitorId: v.id },
        );
      }
      return signingRequest(
        action,
        killSwitchTypedData({
          action: action === "pause" ? "Trip" : "Untrip",
          chainId: 84532,
          ledgerName: "base-sepolia",
          verifyingContract: KILL_SWITCH,
          account: D.NADIA_ACCOUNT,
          nonce: 3n,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
        }),
        {},
      );
    },

    requestRevoke: async () => {
      await wait(200);
      const v = visitor();
      const ctx = await api.revokeContext();
      const td = revokeTypedData(ctx, v ? v.delegation : D.nadiaDelegation);
      return signingRequest("revoke", td, v ? { visitorId: v.id, mandateHash: ctx.mandateHash } : { mandateHash: ctx.mandateHash });
    },
    revokeContext: async (principalId) => {
      const v = visitor();
      if (v && (!principalId || principalId === v.id)) {
        if (v.revoked) throw new ApiRequestError("the mandate is not live", 400, "service_error");
        return visitors.revokeContext(v);
      }
      const live = state.mandates.find((m) => m.status === "live");
      if (!live) throw new ApiRequestError("the mandate is not live", 400, "service_error");
      return { principalId: "nadia", account: D.NADIA_ACCOUNT, ledger: "base-sepolia", mandateHash: live.mandateHash as Hex, delegationHash: live.delegationHash as Hex, directory: BASE_DIRECTORY };
    },
    contractDirectory: async (ledger) => (ledger === "fisco" ? FISCO_DIRECTORY : BASE_DIRECTORY),
    visitorSignUp: async (req) => {
      await wait(900);
      // A secret key made in this browser (the 3-minute walkthrough): only its address arrives, as on the live service.
      if (req.owner) return visitors.signUp({ owner: req.owner, mandate: req.mandate });
      if (!req.credentialId || !req.publicKey) throw new ApiRequestError("sample data supports passkey sign-up only", 400, "service_error");
      return visitors.signUp({ credentialId: req.credentialId, publicKey: req.publicKey, mandate: req.mandate });
    },
    visitorLoginChallenge: async () => {
      throw new ApiRequestError("logging in again needs the live service", 400, "service_error");
    },
    visitorLogin: async () => {
      throw new ApiRequestError("logging in again needs the live service", 400, "service_error");
    },
    draftVisitorMandate: async (text) => {
      await wait(650);
      return sampleVisitorDraft(text);
    },
    visitorReseal: async (visitorId, token, mandate) => {
      await wait(900);
      return visitors.reseal(visitorId, token, mandate);
    },
    visitorSeal: async (visitorId, token, sigs) => {
      await wait(600);
      return visitors.seal(visitorId, token, sigs);
    },

    treasuryEntities: () => D.entities,
    treasury: (entityId) => {
      const v = state.treasury[entityId];
      if (!v) throw notFound("Entity");
      return { ...v, payees: C.treasuryPayees[entityId] ?? [], asset: C.treasuryAssets[entityId] ?? null };
    },
    signBoardProposal: async (entityId, proposalId, directorId) => {
      await wait(700);
      const v = state.treasury[entityId];
      const p = v?.proposals.find((x) => x.id === proposalId);
      if (!v || !p) throw notFound("Proposal");
      if (!p.signatures.some((s) => s.directorId === directorId)) p.signatures.push({ directorId, signedAt: new Date().toISOString() });
      if (p.signatures.length >= v.entity.threshold) {
        p.status = "executed";
        p.tx = fiscoTx(`prop:${p.id}`);
      }
      return p;
    },

    tx: async (ledger, hash) => {
      await wait(150);
      const r = state.receipts.find((x) => x.txHash?.toLowerCase() === hash.toLowerCase());
      return {
        ledger: ledger === "anvil" ? "anvil-bench" : ledger === "fisco" ? "fisco" : "base-sepolia",
        badge: ledger === "fisco" ? "FISCO BCOS (sample)" : ledger === "anvil" ? "Anvil bench (simulated)" : "Base Sepolia (sample)",
        chainId: ledger === "fisco" ? 20200 : ledger === "anvil" ? 31337 : 84532,
        hash,
        status: r ? (r.outcome === "reverted" ? "reverted" : r.outcome === "confirmed" ? "success" : "pending") : "unknown",
        blockNumber: r ? "1204580" : null,
        from: r ? D.YING_WALLET : null,
        to: r ? D.THKD_TOKEN : null,
        toName: r ? "DelegationManager" : null,
        gasUsed: r ? "182400" : null,
        call: r ? { contract: "DelegationManager", fn: "redeemDelegations", args: ["(sample)"] } : null,
        events: [],
        note: "Sample data: fixtures mode does not read a ledger.",
        revert: r?.outcome === "reverted" && r.revertError ? { name: r.revertError, message: `${r.revertError} (sample)` } : null,
        revertSource: r?.outcome === "reverted" ? (ledger === "fisco" ? "native receipt (exact revert data as executed)" : "eth_call replay") : null,
      };
    },

    registry: () => state.registry,
    privateMandate: (agentId) => ({ ...D.privateMandate, agentId }),
    setHalted: async (agentId, halted) => {
      await wait(800);
      const a = state.registry.find((x) => x.agentId === agentId);
      if (!a) throw notFound("Agent");
      a.status = halted ? "paused" : "active";
    },

    challengeSession: () => D.challengeSession,
    challengeAttempts: () => state.attempts,
    submitAttempt: async (req) => {
      await wait(900);
      const decision = simulateDecision(req.text, { bypass: req.bypass, guest: true });
      const stop = decision.scales.find((s) => s.status === "stopped" || s.status === "escalated");
      const attempt: ChallengeAttempt = {
        id: `att-${Date.now()}`,
        at: new Date().toISOString(),
        handle: req.handle?.trim() || "guest",
        family: attackFamily(req.text, req.bypass),
        stoppedAt: stop?.scale ?? null,
        outcome: stop?.revert ? "reverted" : stop?.status === "escalated" ? "escalated" : "refused",
        error: stop?.error ?? null,
        revert: stop?.revert ?? null,
      };
      state.attempts.unshift(attempt);
      return { attempt, decision, receipt: null };
    },

    city: () => citySnapshot,
    cityFeed: () => citySnapshot.feed,
    evidence: () => D.evidence,
    proof: () => sampleProof(),
    ping: async () => {
      // No service is contacted in sample mode; the round trip measured here is the page's own work.
      const at = new Date().toISOString();
      const t0 = performance.now();
      const body = structuredClone(SAMPLE_HEALTH_BODY);
      return { ok: true, status: 200, ms: Math.max(0, Math.round(performance.now() - t0)), at, url: "sample:/v1/health", body };
    },

    insights: () => {
      if (visitor()) throw notFound("Spending insights for this visitor");
      return C.insights;
    },
    coverage: () => {
      if (visitor()) throw notFound("Coverage for this visitor");
      return C.coverageFrom(state.escrows);
    },
    escrows: () => ({ escrows: visitor() ? [] : state.escrows, contract: C.ESCROW_CONTRACT, block: "31884517" }),
    releaseEscrow: async (escrowId) => {
      await wait(800);
      const e = state.escrows.find((x) => x.escrowId === escrowId);
      if (!e) throw notFound("Escrow");
      if (e.state !== "held") throw new ApiRequestError(`escrow is ${e.state}`, 400, "service_error");
      Object.assign(e, { state: "released", canRelease: false, canRefundNow: false });
      const receipt = newReceipt({
        summary: `Escrow ${escrowId} released to ${e.payee.label}`,
        tier: "T3",
        outcome: "confirmed",
        payeeName: e.payee.label,
        amount: e.amount,
        category: "tuition",
        explanation: `${e.releaseAttester.label} attested the condition; the escrow paid ${e.payee.label}. The agent cannot move escrowed funds.`,
        aigc: null,
      });
      return { escrow: clone(e), receipt };
    },
    refundEscrow: async (escrowId) => {
      await wait(800);
      const e = state.escrows.find((x) => x.escrowId === escrowId);
      if (!e) throw notFound("Escrow");
      if (e.state !== "held") throw new ApiRequestError(`escrow is ${e.state}`, 400, "service_error");
      if (!e.canRefundNow) throw new ApiRequestError(`too early: refundable after ${e.refundAfter}`, 400, "service_error", "TooEarly");
      Object.assign(e, { state: "refunded", canRelease: false, canRefundNow: false });
      const receipt = newReceipt({
        summary: `Escrow ${escrowId} refunded to you`,
        tier: "T3",
        outcome: "confirmed",
        payeeName: "Your account",
        amount: e.amount,
        category: "tuition",
        explanation: `The escrow was not released before ${e.refundAfter}, so it returned to your account.`,
        aigc: null,
      });
      return { escrow: clone(e), receipt };
    },
    credentials: () => (visitor() ? [] : [C.credential]),
    issueCredential: async () => {
      await wait(600);
      return { credential: C.credential, verification: C.verify(C.credential) };
    },
    verifyCredential: async (hash) => {
      await wait(500);
      if (hash.toLowerCase() !== C.credential.id.toLowerCase()) throw notFound("Credential");
      return C.verify(C.credential);
    },
    forecast: (entityId) => {
      const f = C.forecasts[entityId];
      if (!f) throw notFound("Forecast");
      return f;
    },
    runPayroll: async (entityId, req) => {
      await wait(700);
      const v = state.treasury[entityId];
      if (!v) throw notFound("Entity");
      const payee = (C.treasuryPayees[entityId] ?? []).find((p) => p.category === "payroll");
      const asset = C.treasuryAssets[entityId]!;
      if (!payee) throw new ApiRequestError("this principal's mandate has no payroll payee", 400, "service_error");
      const lane = v.lanes.find((l) => l.category === "payroll");
      const left = lane ? BigInt(lane.cap.value) - BigInt(lane.spent.value) : 0n;
      const value = BigInt(req.amount);
      const amount = { value: req.amount, decimals: asset.decimals, symbol: asset.symbol };
      const text = `Pay the ${payee.label} ${formatUnits(value, asset.decimals)} ${asset.unit} for payroll${req.memo ? ` (${req.memo})` : ""}`;
      const refused = !lane || value > left;
      const d = simulateDecision(text);
      const decision = {
        ...d,
        input: { text, language: "en" as const },
        intent: { action: "pay" as const, summary: `Payroll to ${payee.label}`, payeeId: payee.id, payeeName: payee.label, amount, category: "payroll", intentHash: null },
        tier: refused ? ("T4" as const) : ("T1" as const),
        outcome: refused ? ("refused" as const) : ("executed" as const),
        question: null,
        scales: d.scales.map((sc, k) =>
          refused
            ? k < 4
              ? { ...sc, status: "passed" as const, reason: null, error: null }
              : k === 4
                ? { ...sc, status: "stopped" as const, error: "CategoryBudgetExceeded", reason: `Only ${formatUnits(left > 0n ? left : 0n, asset.decimals)} ${asset.symbol} is left in this month's payroll lane.` }
                : { ...sc, status: "skipped" as const, reason: null, error: null, durationMs: null, revert: null }
            : { ...sc, status: "passed" as const, reason: null, error: null },
        ),
        explanation: refused
          ? "This payroll run is larger than the payroll lane has left this month, so the CategoryBudgetEnforcer refuses it. A larger run is a board proposal."
          : "Inside the payroll lane: the treasurer agent sent one coin-free instruction to the staff payroll account sealed in the mandate.",
        aigc: null,
      };
      if (!refused) {
        if (lane) lane.spent = { ...lane.spent, value: (BigInt(lane.spent.value) + value).toString() };
        v.instructions.unshift({
          id: `ins-payroll-${Date.now()}`,
          instructionHash: h(`ins:payroll:${Date.now()}`),
          kind: "payroll",
          payeeName: payee.label,
          amount,
          condition: req.memo ?? "Payroll run",
          status: "executed",
          rejectError: null,
          tx: fiscoTx(`payroll:${Date.now()}`),
          createdAt: new Date().toISOString(),
          anchor: { status: "pending", root: null, baseTx: null },
        });
      }
      return decision;
    },
    askAs: async (principalId, req) => {
      await wait(700);
      const v = state.treasury[principalId];
      if (!v) return simulateDecision(req.text);
      return C.simulateTreasuryAsk(principalId, req.text, { ...v, payees: C.treasuryPayees[principalId] ?? [], asset: C.treasuryAssets[principalId] ?? null });
    },
  };
  return api;
}
