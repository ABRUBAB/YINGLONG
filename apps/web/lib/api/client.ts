import type {
  ApprovalRequest,
  ApprovalResult,
  AskRequest,
  BudgetLane,
  CashForecast,
  ChallengeAttempt,
  ChallengeAttemptRequest,
  ChallengeSession,
  ChallengeVerdict,
  CityFeed,
  CitySnapshot,
  CompileRequest,
  Coverage,
  Credential,
  CredentialVerification,
  Decision,
  DirectorProposal,
  EscrowActionResult,
  EscrowList,
  EvidenceSummary,
  Health,
  Mandate,
  MandateDraft,
  MerkleProof,
  Passport,
  PauseStatus,
  PayrollRequest,
  Principal,
  PrivateMandate,
  Receipt,
  RegistryAgent,
  SignatureSubmission,
  SigningRequest,
  SpendingInsights,
  TreasuryEntity,
  TreasuryView,
  TxView,
  VisitorDraft,
  VisitorSealResult,
  VisitorSignUp,
} from "./view";
import type { ContractDirectory, RevokeContext } from "../account-ops";

/** Reads may resolve synchronously (fixtures) so server rendering shows data on first paint. */
export type MaybePromise<T> = T | Promise<T>;

export type DataMode = "live" | "fixtures";

export interface ReceiptPage {
  items: Receipt[];
  nextCursor: string | null;
}

/**
 * Everything the pages need, in view-model shapes. The live adapter implements it against the agent
 * service (docs/API.md); the fixture adapter against sample data.
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
  /** Revoke the live mandate: one user operation (MandateRegistry.revoke + DelegationManager.disableDelegation). */
  requestRevoke(): Promise<SigningRequest>;
  /** What a revoke must look like for this principal (account, live mandate, deployment addresses). */
  revokeContext(principalId?: string): Promise<RevokeContext>;
  /** The deployment directory of one ledger (EntryPoint, DelegationManager, MandateRegistry, ...). */
  contractDirectory(ledger: string): Promise<ContractDirectory>;

  /**
   * Visitor sign-up with the visitor's own passkey: the service receives only the public key, deploys an
   * account whose only signer is that passkey, and returns the two messages the passkey must sign.
   */
  visitorSignUp(req: { credentialId?: string; publicKey?: { x: string; y: string }; owner?: string; mandate?: unknown }): Promise<VisitorSignUp>;
  /** Log in again: a one-time login message to sign with the passkey or secret key of an existing account. */
  visitorLoginChallenge(): Promise<{ nonce: string; issuedAt: string; digest: string; chainId: number }>;
  visitorLogin(req: { nonce: string; issuedAt: string; signature: string; credentialId?: string; owner?: string }): Promise<VisitorLogin>;
  /** Say, see, seal: the visitor's own words compiled to caveats and decoded back (nothing is signed). */
  draftVisitorMandate(text: string): Promise<VisitorDraft>;
  /** A sealed visitor's passkey account gets a new mandate (a draft, or the standard one) and two new signing requests. */
  visitorReseal(visitorId: string, token: string, mandate?: unknown): Promise<VisitorSignUp>;
  /** Both WebAuthn signatures; the session token becomes valid only when the service accepts them. */
  visitorSeal(visitorId: string, token: string, sigs: { userOpSignature: string; delegationSignature: string }): Promise<VisitorSealResult>;

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

  /* Capabilities inside the two scenarios (docs/API.md section 3.10). Reads act for the console principal. */
  /** Spent per category against the sealed budgets, month-end forecast, and one labelled paragraph. */
  insights(): MaybePromise<SpendingInsights>;
  /** Which obligations named in the mandate are protected by an escrow, and which are not. */
  coverage(): MaybePromise<Coverage>;
  /** Every ProtectedPayment escrow funded by the console principal's account. */
  escrows(): MaybePromise<EscrowList>;
  /** The release attester (a fictional institution's key held by the service) releases a held escrow. Operator route. */
  releaseEscrow(escrowId: number, evidence?: string): Promise<EscrowActionResult>;
  /** Anyone may return an unreleased escrow after its refund time (operator, or the visitor's own token). */
  refundEscrow(escrowId: number): Promise<EscrowActionResult>;
  /** Payment-reliability credentials issued to the console principal (test credentials of a fictional bank). */
  credentials(): MaybePromise<Credential[]>;
  /** Asks the fictional bank to issue (or return) the credential from on-time rent receipts. */
  issueCredential(): Promise<{ credential: Credential; verification: CredentialVerification }>;
  verifyCredential(credentialHash: string): Promise<CredentialVerification>;
  /** Deterministic cash forecast of a company rail, with a labelled paragraph. */
  forecast(entityId: string, days?: number): MaybePromise<CashForecast>;
  /** Payroll run through the same nine scales as any payment (operator route in the demo). */
  runPayroll(entityId: string, req: PayrollRequest): Promise<Decision>;
  /** A request to another principal's agent, never auto-executed (the treasury's sweep proposals). */
  askAs(principalId: string, req: AskRequest): Promise<Decision>;

  /** Agent City: principals, passport registry, payee books, ledger health and the receipt/anchor feed. */
  city(): MaybePromise<CitySnapshot>;
  /** The polled part of the city: recent receipts across every principal and the anchoring batches. */
  cityFeed(): MaybePromise<CityFeed>;
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

export interface VisitorLogin {
  visitorId: string;
  token: string;
  account: string;
  method: "passkey" | "key";
  credentialId?: string;
  owner?: string;
  publicKey?: { x: string; y: string };
}
