import type {
  ApprovalRequest,
  ApprovalResult,
  AskRequest,
  BudgetLane,
  ChallengeAttempt,
  ChallengeAttemptRequest,
  ChallengeSession,
  ChallengeVerdict,
  CityGraph,
  CompileRequest,
  Decision,
  DirectorProposal,
  EvidenceSummary,
  Health,
  Mandate,
  MandateDraft,
  MerkleProof,
  Passport,
  PauseStatus,
  Principal,
  PrivateMandate,
  Receipt,
  RegistryAgent,
  SignatureSubmission,
  SigningRequest,
  TreasuryEntity,
  TreasuryView,
  TxView,
} from "./view";

/** Reads may resolve synchronously (fixtures) so server rendering shows data on first paint. */
export type MaybePromise<T> = T | Promise<T>;

export type DataMode = "live" | "fixtures";

export interface ReceiptPage {
  items: Receipt[];
  nextCursor: string | null;
}

/**
 * Everything the pages need, in view-model shapes. The live adapter implements it against the agent
 * service (docs/api/AGENT_API.md); the fixture adapter against sample data.
 * Signing flows are two-step: request (the service returns digest + typedData), then submit the
 * passkey signature over exactly that digest after the signing-domain guard has checked it.
 */
export interface AgentApi {
  readonly mode: DataMode;
  readonly baseUrl: string;

  health(): MaybePromise<Health>;
  me(): MaybePromise<Principal>;
  passport(agentId: string): MaybePromise<Passport>;

  mandates(): MaybePromise<Mandate[]>;
  mandate(mandateHash: string): MaybePromise<Mandate>;
  compileMandate(req: CompileRequest): Promise<MandateDraft>;
  requestSeal(draft: MandateDraft): Promise<SigningRequest>;
  budgets(): MaybePromise<BudgetLane[]>;

  ask(req: AskRequest): Promise<Decision>;
  /** T0/T1 only: the agent executes the proposal it was allowed to make. */
  execute(proposalId: string): Promise<Receipt>;
  receipts(opts?: { limit?: number }): MaybePromise<ReceiptPage>;
  receipt(receiptId: string): MaybePromise<Receipt>;
  receiptProof(receiptId: string): MaybePromise<MerkleProof>;
  /** Read-only transaction view for ledgers without a public explorer (FISCO, Anvil bench). */
  tx(ledger: string, hash: string): Promise<TxView>;
  /** The receipt whose transaction hash this is, across every principal (our /proof/tx explorer). */
  findReceiptByTx(txHash: string): Promise<Receipt | null>;
  /** Recent receipts of any registered agent (supervisor view). */
  agentReceipts(agentId: string): MaybePromise<Receipt[]>;

  approvals(): MaybePromise<ApprovalRequest[]>;
  approval(id: string): MaybePromise<ApprovalRequest>;
  /** Agent service demo signer: signs a pending approval with the scripted passkey (software P-256 key). */
  demoSign(requestId: string): Promise<ApprovalResult>;
  /** Attack simulation: a hijacked agent pushes a raw redemption to the chain; returns the revert receipt. */
  attack(req: { to: string; amount: string; symbol: string; family: string }): Promise<{ decision: Decision | null; receipt: Receipt | null }>;
  /** Submits the passkey signature for any signing request (approval, seal, pause, resume). */
  submitSignature(requestId: string, sig: SignatureSubmission): Promise<ApprovalResult>;
  declineApproval(id: string): Promise<ApprovalRequest>;

  pauseStatus(): MaybePromise<PauseStatus>;
  requestPause(action: "pause" | "resume"): Promise<SigningRequest>;

  treasuryEntities(): MaybePromise<TreasuryEntity[]>;
  treasury(entityId: string): MaybePromise<TreasuryView>;
  /**
   * Director signature on a board proposal (2 of 3). In the demo the director keys are testnet keys
   * held by the service, so this is an operator route; the UI says so when it is refused.
   */
  signBoardProposal(entityId: string, proposalId: string, directorId: string): Promise<DirectorProposal>;

  registry(): MaybePromise<RegistryAgent[]>;
  privateMandate(agentId: string): MaybePromise<PrivateMandate>;
  setHalted(agentId: string, halted: boolean): Promise<void>;

  challengeSession(): MaybePromise<ChallengeSession>;
  challengeAttempts(): MaybePromise<ChallengeAttempt[]>;
  submitAttempt(req: ChallengeAttemptRequest): Promise<ChallengeVerdict>;

  city(): MaybePromise<CityGraph>;
  evidence(): MaybePromise<EvidenceSummary>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly typedError: string | null = null,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isPromise<T>(v: MaybePromise<T>): v is Promise<T> {
  return typeof (v as Promise<T>)?.then === "function";
}

export const TREASURY_IDS = ["lotus-sz", "lotus-hk"] as const;
export const CONSOLE_PRINCIPAL = "nadia";
