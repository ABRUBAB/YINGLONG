/**
 * What a passkey is asked to sign when it acts on the account itself, decoded on this device:
 *
 * - the user operation that publishes a visitor's mandate (PayeeBook, guardians, MandateRegistry);
 * - the root delegation that gives the visitor's agent that mandate (DelegationManager);
 * - the user operation that revokes a mandate (MandateRegistry.revoke + DelegationManager.disableDelegation).
 *
 * Each check is computed here from the typed message, never taken from the service's description. A
 * request that fails any check is not signed. Contract addresses come from the deployment directory the
 * service publishes in /v1/evidence (`contracts`), keyed by ledger.
 */
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  hashStruct,
  isAddressEqual,
  type Hex,
} from "viem";
import type { TypedData } from "./api/view";

/* ------------------------------------------------------------------ ABI fragments (DF v1.3.0 + YINGLONG) */

const CAVEAT = [
  { name: "enforcer", type: "address" },
  { name: "terms", type: "bytes" },
  { name: "args", type: "bytes" },
] as const;

const PUBLISH_PARAMS = {
  name: "_p",
  type: "tuple",
  components: [
    { name: "mandateHash", type: "bytes32" },
    { name: "agent", type: "address" },
    { name: "lineageId", type: "bytes32" },
    { name: "jurisdiction", type: "uint8" },
    { name: "validFrom", type: "uint64" },
    { name: "validUntil", type: "uint64" },
    { name: "salt", type: "uint256" },
    { name: "caveats", type: "tuple[]", components: CAVEAT },
  ],
} as const;

const DELEGATION_ARG = {
  name: "_delegation",
  type: "tuple",
  components: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "tuple[]", components: CAVEAT },
    { name: "salt", type: "uint256" },
    { name: "signature", type: "bytes" },
  ],
} as const;

export const ACCOUNT_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "_mode", type: "bytes32" },
      { name: "_executionCalldata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const MANDATE_REGISTRY_ABI = [
  { type: "function", name: "publish", stateMutability: "nonpayable", inputs: [PUBLISH_PARAMS], outputs: [] },
  { type: "function", name: "supersede", stateMutability: "nonpayable", inputs: [{ name: "_oldMandateHash", type: "bytes32" }, PUBLISH_PARAMS], outputs: [] },
  { type: "function", name: "revoke", stateMutability: "nonpayable", inputs: [{ name: "_mandateHash", type: "bytes32" }], outputs: [] },
] as const;

export const DELEGATION_MANAGER_ABI = [
  { type: "function", name: "disableDelegation", stateMutability: "nonpayable", inputs: [DELEGATION_ARG], outputs: [] },
] as const;

export const PAYEE_BOOK_ABI = [
  {
    type: "function",
    name: "setPayees",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_payeeList", type: "address[]" },
      { name: "_categories", type: "uint32[]" },
      { name: "_labels", type: "bytes32[]" },
    ],
    outputs: [],
  },
] as const;

export const KILL_SWITCH_ABI = [
  {
    type: "function",
    name: "setGuardian",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_guardian", type: "address" },
      { name: "_enabled", type: "bool" },
    ],
    outputs: [],
  },
] as const;

/** ERC-7579 execution modes the DeleGator accepts: CALLTYPE_SINGLE / CALLTYPE_BATCH, EXECTYPE_DEFAULT. */
export const SINGLE_DEFAULT_MODE = `0x${"00".repeat(32)}` as Hex;
export const BATCH_DEFAULT_MODE = `0x01${"00".repeat(31)}` as Hex;
/** DelegationManager ROOT_AUTHORITY. */
export const ROOT_AUTHORITY = `0x${"ff".repeat(32)}` as Hex;

export const DELEGATION_EIP712_TYPES = {
  Delegation: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "Caveat[]" },
    { name: "salt", type: "uint256" },
  ],
  Caveat: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
  ],
} as const;

export const USER_OP_EIP712_TYPES = {
  PackedUserOperation: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "entryPoint", type: "address" },
  ],
} as const;

/* ------------------------------------------------------------------ deployment directory */

export const DIRECTORY_NAMES = ["EntryPoint", "DelegationManager", "MandateRegistry", "PayeeBook", "KillSwitchRegistry"] as const;
export type DirectoryName = (typeof DIRECTORY_NAMES)[number];

/** Contract addresses of one ledger's deployment, by name (from /v1/evidence `contracts`). */
export type ContractDirectory = Partial<Record<DirectoryName, Hex>> & { ledger: string };

export function nameOf(dir: ContractDirectory, address: string): DirectoryName | null {
  for (const n of DIRECTORY_NAMES) {
    const a = dir[n];
    if (a && sameAddress(a, address)) return n;
  }
  return null;
}

/* ------------------------------------------------------------------ helpers */

export interface Check {
  label: string;
  ok: boolean;
}

export interface Call {
  target: Hex;
  value: bigint;
  data: Hex;
}

export interface DescribedCall extends Call {
  contract: string;
  fn: string | null;
  words: string;
  known: boolean;
}

const short = (h: string, a = 6, b = 4) => (h.length > a + b + 3 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);

export function sameAddress(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  try {
    return isAddressEqual(getAddress(a), getAddress(b));
  } catch {
    return false;
  }
}

const sameHex = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

const asBigInt = (v: unknown): bigint | null => {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" || (typeof v === "string" && v !== "")) return BigInt(v);
  } catch {
    /* not an integer */
  }
  return null;
};

/** The account's execute(mode, executionCalldata), split into calls. Throws on anything else. */
export function decodeExecuteCallData(callData: Hex): { mode: "single" | "batch"; calls: Call[] } {
  const { functionName, args } = decodeFunctionData({ abi: ACCOUNT_ABI, data: callData });
  if (functionName !== "execute") throw new Error("not an execute call");
  const [mode, exec] = args as readonly [Hex, Hex];
  if (sameHex(mode, SINGLE_DEFAULT_MODE)) {
    const hex = exec.slice(2);
    if (hex.length < 104) throw new Error("single execution is too short");
    return {
      mode: "single",
      calls: [{ target: getAddress(`0x${hex.slice(0, 40)}`) as Hex, value: BigInt(`0x${hex.slice(40, 104)}`), data: `0x${hex.slice(104)}` as Hex }],
    };
  }
  if (sameHex(mode, BATCH_DEFAULT_MODE)) {
    const [list] = decodeAbiParameters(
      [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
      exec,
    );
    return { mode: "batch", calls: list.map((c) => ({ target: getAddress(c.target) as Hex, value: c.value, data: c.callData as Hex })) };
  }
  throw new Error(`execution mode ${short(mode, 10, 4)} is not a default single or batch call`);
}

/** EIP-712 struct hash of a delegation, exactly DelegationManager.getDelegationHash (args and signature excluded). */
export function delegationStructHash(d: { delegate: string; delegator: string; authority: string; caveats: readonly { enforcer: string; terms: string }[]; salt: unknown }): Hex {
  return hashStruct({
    types: DELEGATION_EIP712_TYPES,
    primaryType: "Delegation",
    data: {
      delegate: getAddress(d.delegate),
      delegator: getAddress(d.delegator),
      authority: d.authority as Hex,
      caveats: d.caveats.map((c) => ({ enforcer: getAddress(c.enforcer), terms: c.terms as Hex })),
      salt: asBigInt(d.salt) ?? 0n,
    },
  });
}

/** One call in plain words, decoded with the fragments above. Unknown calls are reported as such. */
export function describeCall(c: Call, dir: ContractDirectory): DescribedCall {
  const contract = nameOf(dir, c.target);
  const base = { ...c, contract: contract ?? short(c.target, 8, 6), fn: null as string | null, known: false };
  const tryDecode = <A extends readonly unknown[]>(abi: A) => {
    try {
      return decodeFunctionData({ abi: abi as never, data: c.data }) as { functionName: string; args: readonly unknown[] };
    } catch {
      return null;
    }
  };
  if (contract === "MandateRegistry") {
    const d = tryDecode(MANDATE_REGISTRY_ABI);
    if (d?.functionName === "publish") {
      const p = d.args[0] as { mandateHash: Hex; agent: Hex; caveats: readonly unknown[] };
      return { ...base, fn: "publish", known: true, words: `Publish mandate ${short(p.mandateHash)} for agent wallet ${short(p.agent)} with ${p.caveats.length} rules` };
    }
    if (d?.functionName === "supersede") {
      const p = d.args[1] as { mandateHash: Hex; caveats: readonly unknown[] };
      return { ...base, fn: "supersede", known: true, words: `Replace mandate ${short(d.args[0] as string)} with ${short(p.mandateHash)} (${p.caveats.length} rules)` };
    }
    if (d?.functionName === "revoke") return { ...base, fn: "revoke", known: true, words: `Retire mandate ${short(d.args[0] as string)}` };
  }
  if (contract === "DelegationManager") {
    const d = tryDecode(DELEGATION_MANAGER_ABI);
    if (d?.functionName === "disableDelegation") {
      const del = d.args[0] as { delegate: Hex; delegator: Hex };
      return { ...base, fn: "disableDelegation", known: true, words: `Disable the delegation from ${short(del.delegator)} to agent wallet ${short(del.delegate)}` };
    }
  }
  if (contract === "PayeeBook") {
    const d = tryDecode(PAYEE_BOOK_ABI);
    if (d?.functionName === "setPayees") {
      const n = (d.args[0] as readonly unknown[]).length;
      return { ...base, fn: "setPayees", known: true, words: `Write ${n} payee${n === 1 ? "" : "s"} into your PayeeBook` };
    }
  }
  if (contract === "KillSwitchRegistry") {
    const d = tryDecode(KILL_SWITCH_ABI);
    if (d?.functionName === "setGuardian") {
      const [g, on] = d.args as readonly [Hex, boolean];
      return { ...base, fn: "setGuardian", known: true, words: on ? `Let guardian ${short(g)} pause your agent (pause only, never spend)` : `Remove guardian ${short(g)}` };
    }
  }
  return { ...base, words: `Unrecognised call ${c.data.slice(0, 10)} to ${base.contract}` };
}

/* ------------------------------------------------------------------ sign-up: publish user operation */

export interface SignUpFacts {
  account: string;
  agentWallet: string;
  mandateHash: string;
  delegationHash: string;
}

export interface Review {
  ok: boolean;
  lines: string[];
  checks: Check[];
}

function msg(td: TypedData): Record<string, unknown> {
  return td.message as Record<string, unknown>;
}

/** Caveats (enforcer, terms) published by a publish/supersede call, for comparison with the delegation. */
function publishedCaveats(calls: Call[], dir: ContractDirectory): { mandateHash: Hex; agent: Hex; caveats: { enforcer: string; terms: string }[] } | null {
  for (const c of calls) {
    if (nameOf(dir, c.target) !== "MandateRegistry") continue;
    try {
      const d = decodeFunctionData({ abi: MANDATE_REGISTRY_ABI, data: c.data });
      const p = (d.functionName === "publish" ? d.args[0] : d.functionName === "supersede" ? d.args[1] : null) as {
        mandateHash: Hex;
        agent: Hex;
        caveats: readonly { enforcer: Hex; terms: Hex }[];
      } | null;
      if (p) return { mandateHash: p.mandateHash, agent: p.agent, caveats: p.caveats.map((x) => ({ enforcer: x.enforcer, terms: x.terms })) };
    } catch {
      /* not a registry call we know */
    }
  }
  return null;
}

/** The user operation that publishes the visitor's mandate (step "publish"). */
export function reviewPublishOp(td: TypedData, facts: SignUpFacts, dir: ContractDirectory): Review & { calls: DescribedCall[]; published: ReturnType<typeof publishedCaveats> } {
  const m = msg(td);
  const checks: Check[] = [];
  checks.push({ label: "It is a user operation of your own account", ok: td.primaryType === "PackedUserOperation" && sameAddress(td.domain.verifyingContract, facts.account) && sameAddress(m.sender, facts.account) });
  checks.push({ label: "No account code is deployed with it", ok: m.initCode === "0x" || m.initCode === "" });
  if (dir.EntryPoint) checks.push({ label: "The EntryPoint is the deployment's", ok: sameAddress(m.entryPoint, dir.EntryPoint) });
  let calls: DescribedCall[] = [];
  let published: ReturnType<typeof publishedCaveats> = null;
  try {
    const exec = decodeExecuteCallData(m.callData as Hex);
    calls = exec.calls.map((c) => describeCall(c, dir));
    published = publishedCaveats(exec.calls, dir);
  } catch (e) {
    checks.push({ label: `The call data decodes: ${(e as Error).message}`, ok: false });
  }
  if (calls.length) {
    checks.push({ label: "Every call is one this page recognises", ok: calls.every((c) => c.known) });
    checks.push({ label: "No call sends value", ok: calls.every((c) => c.value === 0n) });
    checks.push({
      label: "It publishes exactly this mandate for your own agent",
      ok: Boolean(published && sameHex(published.mandateHash, facts.mandateHash) && sameAddress(published.agent, facts.agentWallet)),
    });
  }
  return { ok: checks.every((c) => c.ok), lines: calls.map((c) => c.words), checks, calls, published };
}

/** The root delegation that gives the agent the mandate (step "delegation"). */
export function reviewDelegation(
  td: TypedData,
  facts: SignUpFacts,
  dir: ContractDirectory,
  published: { caveats: { enforcer: string; terms: string }[] } | null,
): Review {
  const m = msg(td);
  const caveats = Array.isArray(m.caveats) ? (m.caveats as { enforcer: string; terms: string }[]) : [];
  const checks: Check[] = [];
  checks.push({ label: "It is a delegation in the DelegationManager's domain", ok: td.primaryType === "Delegation" && (!dir.DelegationManager || sameAddress(td.domain.verifyingContract, dir.DelegationManager)) });
  checks.push({ label: "From your account to your own agent wallet", ok: sameAddress(m.delegator, facts.account) && sameAddress(m.delegate, facts.agentWallet) });
  checks.push({ label: "A root delegation (nobody re-delegates it to you)", ok: sameHex(m.authority, ROOT_AUTHORITY) });
  let hash: Hex | null = null;
  try {
    hash = delegationStructHash({ delegate: String(m.delegate), delegator: String(m.delegator), authority: String(m.authority), caveats, salt: m.salt });
  } catch {
    hash = null;
  }
  checks.push({ label: "Its hash, recomputed here, is the delegation hash of the mandate shown", ok: Boolean(hash && sameHex(hash, facts.delegationHash)) });
  if (published) {
    const same =
      published.caveats.length === caveats.length &&
      published.caveats.every((c, i) => sameAddress(c.enforcer, caveats[i]?.enforcer) && sameHex(c.terms, caveats[i]?.terms));
    checks.push({ label: "Its rules are exactly the rules being published", ok: same });
  }
  const lines = [`${caveats.length} rules, each enforced by a caveat contract on chain`, `Delegation hash ${hash ? short(hash, 10, 8) : "not computable"}`];
  return { ok: checks.every((c) => c.ok), lines, checks };
}

/* ------------------------------------------------------------------ revoke */

export interface RevokeContext {
  principalId: string;
  account: Hex;
  ledger: string;
  mandateHash: Hex;
  delegationHash: Hex;
  directory: ContractDirectory;
}

/**
 * A revoke must be one user operation of the principal's own account whose call data is execute(batch)
 * with exactly two calls: MandateRegistry.revoke(the live mandate hash) and
 * DelegationManager.disableDelegation(the delegation whose hash is the live delegation hash).
 */
export function reviewRevoke(td: TypedData, ctx: RevokeContext): Review & { calls: DescribedCall[] } {
  const m = msg(td);
  const checks: Check[] = [];
  const domainName = typeof td.domain.name === "string" ? td.domain.name : "";
  checks.push({
    label: "A user operation of your own account",
    ok: td.primaryType === "PackedUserOperation" && /^(HybridDeleGator|MultiSigDeleGator)$/.test(domainName) && sameAddress(td.domain.verifyingContract, ctx.account) && sameAddress(m.sender, ctx.account),
  });
  checks.push({ label: "No account code is deployed with it", ok: m.initCode === "0x" || m.initCode === "" });
  if (ctx.directory.EntryPoint) checks.push({ label: "The EntryPoint is the deployment's", ok: sameAddress(m.entryPoint, ctx.directory.EntryPoint) });
  let calls: DescribedCall[] = [];
  let raw: Call[] = [];
  try {
    raw = decodeExecuteCallData(m.callData as Hex).calls;
    calls = raw.map((c) => describeCall(c, ctx.directory));
  } catch (e) {
    checks.push({ label: `The call data decodes: ${(e as Error).message}`, ok: false });
  }
  const dir = ctx.directory;
  const known = Boolean(dir.MandateRegistry && dir.DelegationManager);
  checks.push({ label: "The deployment's MandateRegistry and DelegationManager addresses are known here", ok: known });
  checks.push({ label: "Exactly two calls, no value sent", ok: raw.length === 2 && raw.every((c) => c.value === 0n) });
  const [first, second] = raw;
  const expectedRevoke = encodeFunctionData({ abi: MANDATE_REGISTRY_ABI, functionName: "revoke", args: [ctx.mandateHash] });
  checks.push({
    label: "Call 1 retires your live mandate in the MandateRegistry",
    ok: Boolean(known && first && sameAddress(first.target, dir.MandateRegistry) && sameHex(first.data, expectedRevoke)),
  });
  let disableOk = false;
  if (known && second && sameAddress(second.target, dir.DelegationManager)) {
    try {
      const d = decodeFunctionData({ abi: DELEGATION_MANAGER_ABI, data: second.data });
      const del = d.args[0] as { delegate: Hex; delegator: Hex; authority: Hex; caveats: readonly { enforcer: Hex; terms: Hex }[]; salt: bigint };
      disableOk = d.functionName === "disableDelegation" && sameAddress(del.delegator, ctx.account) && sameHex(delegationStructHash(del), ctx.delegationHash);
    } catch {
      disableOk = false;
    }
  }
  checks.push({ label: "Call 2 disables exactly your mandate's delegation in the DelegationManager", ok: disableOk });
  return { ok: checks.every((c) => c.ok), lines: calls.map((c) => c.words), checks, calls };
}
