/**
 * Fixtures mode: visitor sign-up with a real passkey, simulated service side. The browser's passkey
 * (or the test's virtual authenticator) signs for real; this simulator builds the same two messages the
 * agent service builds (the publish user operation and the root delegation) and verifies both WebAuthn
 * signatures against the visitor's public key exactly as the HybridDeleGator would, before "sealing".
 * Nothing leaves the browser and every value is SAMPLE DATA.
 */
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, pad, recoverAddress, stringToBytes, toHex, type Hex } from "viem";
import {
  ACCOUNT_ABI,
  BATCH_DEFAULT_MODE,
  DELEGATION_EIP712_TYPES,
  DELEGATION_MANAGER_ABI,
  delegationStructHash,
  KILL_SWITCH_ABI,
  MANDATE_REGISTRY_ABI,
  PAYEE_BOOK_ABI,
  ROOT_AUTHORITY,
  USER_OP_EIP712_TYPES,
  type ContractDirectory,
  type RevokeContext,
} from "../../account-ops";
import { verifyWebAuthnSignature } from "../../passkey/verify";
import { typedDataDigest } from "../../signing-guard";
import { ApiRequestError } from "../client";
import type { BudgetLane, Mandate, Principal, Receipt, TypedData, VisitorSealResult, VisitorSignUp } from "../view";
import { addr, amt, fiscoTx, h, THKD } from "./util";

export const FISCO_DIRECTORY: ContractDirectory = {
  ledger: "fisco",
  EntryPoint: addr("fisco:entry-point"),
  DelegationManager: addr("fisco:delegation-manager"),
  MandateRegistry: addr("fisco:mandate-registry"),
  PayeeBook: addr("fisco:payee-book"),
  KillSwitchRegistry: addr("fisco:kill-switch-registry"),
};

export const BASE_DIRECTORY: ContractDirectory = {
  ledger: "base-sepolia",
  EntryPoint: addr("base:entry-point"),
  DelegationManager: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
  MandateRegistry: addr("base:mandate-registry"),
  PayeeBook: addr("base:payee-book"),
  KillSwitchRegistry: addr("kill-switch-registry"),
};

const FISCO_CHAIN = 20200;
const BADGE = "FISCO BCOS (sample)";

export const VISITOR_SENTENCES = [
  "Pay Arena Cafe and Kowloon Food Mart up to 20 at a time and 100 a day; up to 200 with my passkey.",
  "Pay HBU Bookshop for course materials, up to 300 a day, with my passkey above 20.",
  "Never let the balance drop below 100.",
  "Nothing else.",
];

const RULES = [
  "The agent can only touch tHKD.",
  "It can only call transfer.",
  "It may pay only Arena Cafe, Kowloon Food Mart and HBU Bookshop (your PayeeBook).",
  "Alone it pays at most 20.00 tHKD at a time; up to 200.00 tHKD with your passkey.",
  "Food at most 100.00 tHKD a day; course materials at most 300.00 tHKD a day.",
  "The balance never drops below 100.00 tHKD.",
];

interface DelegationParts {
  delegate: Hex;
  delegator: Hex;
  authority: Hex;
  caveats: { enforcer: Hex; terms: Hex; args: Hex }[];
  salt: bigint;
  signature: Hex;
}

export interface FixtureVisitor {
  id: string;
  token: string;
  credentialId: string;
  x: Hex;
  y: Hex;
  /** Secret-key visitors (sample): the key's address; both seal signatures must recover to it. */
  owner?: Hex;
  account: Hex;
  agentWallet: Hex;
  agentId: string;
  round: number;
  delegation: DelegationParts;
  mandateHash: Hex;
  delegationHash: Hex;
  pending: { opDigest: Hex; delegationDigest: Hex } | null;
  sealedAt: string | null;
  publishTx: Hex | null;
  revoked: boolean;
  paused: boolean;
  receipts: Receipt[];
}

export function visitorIdFor(credentialId: string, x: string, y: string): string {
  return `v-${keccak256(stringToBytes(`${credentialId}:${x.toLowerCase()}:${y.toLowerCase()}`)).slice(2, 12)}`;
}

const derived = (label: string) => getAddress(`0x${keccak256(stringToBytes(label)).slice(26)}`) as Hex;

function delegationFor(v: { account: Hex; agentWallet: Hex; id: string }, round: number): DelegationParts {
  return {
    delegate: v.agentWallet,
    delegator: v.account,
    authority: ROOT_AUTHORITY,
    caveats: RULES.map((_, i) => ({ enforcer: addr(`fisco:enforcer:${i}`), terms: h(`visitor:${v.id}:${round}:terms:${i}`), args: "0x" as Hex })),
    salt: BigInt(round),
    signature: "0x",
  };
}

function userOp(account: Hex, nonce: bigint, callData: Hex): TypedData {
  return {
    domain: { name: "HybridDeleGator", version: "1", chainId: FISCO_CHAIN, verifyingContract: account },
    types: structuredClone(USER_OP_EIP712_TYPES) as unknown as TypedData["types"],
    primaryType: "PackedUserOperation",
    message: {
      sender: account,
      nonce: nonce.toString(),
      initCode: "0x",
      callData,
      accountGasLimits: pad(toHex((1_500_000n << 128n) | 2_000_000n), { size: 32 }),
      preVerificationGas: "60000",
      gasFees: pad("0x00", { size: 32 }),
      paymasterAndData: "0x",
      entryPoint: FISCO_DIRECTORY.EntryPoint!,
    },
  };
}

function batch(calls: { to: Hex; data: Hex }[]): Hex {
  const exec = encodeAbiParameters(
    [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
    [calls.map((c) => ({ target: c.to, value: 0n, callData: c.data }))],
  );
  return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [BATCH_DEFAULT_MODE, exec] });
}

export function createFixtureVisitors() {
  const visitors = new Map<string, FixtureVisitor>();

  function build(credentialId: string, x: Hex, y: Hex, token: string, owner?: Hex): FixtureVisitor {
    const id = visitorIdFor(credentialId, x, y);
    const account = derived(`yinglong:visitor:${id}:account`);
    const agentWallet = derived(`yinglong:visitor:${id}:agent`);
    const v: FixtureVisitor = {
      id,
      token,
      credentialId,
      x,
      y,
      owner,
      account,
      agentWallet,
      agentId: String(9000 + (parseInt(id.slice(2, 6), 16) % 900)),
      round: 1,
      delegation: delegationFor({ account, agentWallet, id }, 1),
      mandateHash: h(`visitor:${id}:mandate:1`),
      delegationHash: "0x",
      pending: null,
      sealedAt: null,
      publishTx: null,
      revoked: false,
      paused: false,
      receipts: [],
    };
    v.delegationHash = delegationStructHash(v.delegation);
    return v;
  }

  function publishCalls(v: FixtureVisitor) {
    const d = FISCO_DIRECTORY;
    const now = BigInt(Math.floor(Date.now() / 1000));
    return [
      {
        to: d.PayeeBook!,
        data: encodeFunctionData({
          abi: PAYEE_BOOK_ABI,
          functionName: "setPayees",
          args: [[derived("arena-cafe"), derived("kowloon-food-mart"), derived("hbu-bookshop")], [1, 1, 3], [h("label:arena"), h("label:kfm"), h("label:hbu")]],
        }),
      },
      { to: d.KillSwitchRegistry!, data: encodeFunctionData({ abi: KILL_SWITCH_ABI, functionName: "setGuardian", args: [addr("fisco:guardian"), true] }) },
      {
        to: d.MandateRegistry!,
        data: encodeFunctionData({
          abi: MANDATE_REGISTRY_ABI,
          functionName: "publish",
          args: [
            {
              mandateHash: v.mandateHash,
              agent: v.agentWallet,
              lineageId: keccak256(stringToBytes("visitor")),
              jurisdiction: 0,
              validFrom: now - 60n,
              validUntil: now + 30n * 86400n,
              salt: v.delegation.salt,
              caveats: v.delegation.caveats,
            },
          ],
        }),
      },
    ];
  }

  function delegationTypedData(v: FixtureVisitor): TypedData {
    return {
      domain: { name: "DelegationManager", version: "1", chainId: FISCO_CHAIN, verifyingContract: FISCO_DIRECTORY.DelegationManager! },
      types: structuredClone(DELEGATION_EIP712_TYPES) as unknown as TypedData["types"],
      primaryType: "Delegation",
      message: {
        delegate: v.delegation.delegate,
        delegator: v.delegation.delegator,
        authority: v.delegation.authority,
        caveats: v.delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
        salt: v.delegation.salt.toString(),
      },
    };
  }

  function receipt(v: FixtureVisitor, partial: Partial<Receipt> & Pick<Receipt, "summary" | "tier" | "outcome" | "explanation">): Receipt {
    const id = h(`visitor:${v.id}:receipt:${v.receipts.length}:${Date.now()}`);
    const r: Receipt = {
      receiptId: id,
      receiptHash: h(`receipt-hash:${id}`),
      chainId: FISCO_CHAIN,
      ledger: "fisco",
      ledgerBadge: BADGE,
      agentId: v.agentId,
      mandateHash: v.mandateHash,
      delegationHash: v.delegationHash,
      intentHash: h(`intent:${id}`),
      txHash: h(`tx:fisco:${id}`),
      explorerUrl: null,
      revertError: null,
      aigc: null,
      timestamp: new Date().toISOString(),
      prevReceiptHash: (v.receipts[0]?.receiptHash ?? h("genesis")) as Hex,
      anchor: null,
      payeeName: null,
      amount: null,
      category: null,
      ...partial,
    };
    v.receipts.unshift(r);
    return r;
  }

  async function mustVerify(v: FixtureVisitor, digest: Hex, signature: string, what: string) {
    let ok = false;
    try {
      ok = v.owner
        ? (await recoverAddress({ hash: digest, signature: signature as Hex })).toLowerCase() === v.owner.toLowerCase()
        : await verifyWebAuthnSignature(digest, signature as Hex, v.x, v.y);
    } catch {
      ok = false;
    }
    if (!ok) throw new ApiRequestError(`the ${what} signature does not verify for this account's passkey`, 400, "service_error");
  }

  return {
    get(id: string) {
      return visitors.get(id) ?? null;
    },

    /** After a reload the in-memory simulator is empty; the stored session rebuilds the sealed visitor. */
    restore(s: { visitorId: string; token: string; credentialId: string; publicKey?: { x: string; y: string }; method?: "passkey" | "key"; owner?: string }): FixtureVisitor | null {
      const known = visitors.get(s.visitorId);
      if (known) return known;
      // A secret-key visitor (sample): rebuilt from the key's address alone.
      if (s.method === "key" && s.owner && /^0x[0-9a-fA-F]{40}$/.test(s.owner)) {
        const k = build(`key:${s.owner.toLowerCase()}`, "0x", "0x", s.token, s.owner as Hex);
        if (k.id !== s.visitorId) return null;
        k.sealedAt = new Date().toISOString();
        k.publishTx = fiscoTx(`visitor:${k.id}:publish:1`).txHash as Hex;
        receipt(k, { summary: "Mandate sealed with your secret key", tier: "T3", outcome: "confirmed", txHash: k.publishTx, explanation: "Mandate sealed (secret key): published on-chain with its full rule set." });
        visitors.set(k.id, k);
        return k;
      }
      if (!s.publicKey) return null;
      const v = build(s.credentialId, s.publicKey.x as Hex, s.publicKey.y as Hex, s.token);
      if (v.id !== s.visitorId) return null;
      v.sealedAt = new Date().toISOString();
      v.publishTx = fiscoTx(`visitor:${v.id}:publish:1`).txHash as Hex;
      receipt(v, { summary: "Mandate sealed with your passkey", tier: "T3", outcome: "confirmed", txHash: v.publishTx, explanation: "Mandate sealed (passkey (WebAuthn)): published on-chain with its full rule set." });
      visitors.set(v.id, v);
      return v;
    },

    signUp(req: { credentialId?: string; publicKey?: { x: string; y: string }; owner?: string; mandate?: unknown }): VisitorSignUp {
      // Secret-key sign-up (sample): only the key's address arrives; the seal must carry two signatures that recover to it.
      const owner = req.owner ? (req.owner as Hex) : undefined;
      if (owner && !/^0x[0-9a-fA-F]{40}$/.test(owner)) throw new ApiRequestError("owner must be a 20-byte 0x address", 400, "service_error");
      const credentialId = owner ? `key:${owner.toLowerCase()}` : (req.credentialId ?? "");
      const publicKey = owner ? { x: "0x", y: "0x" } : (req.publicKey ?? { x: "", y: "" });
      if (!owner && !/^[A-Za-z0-9_-]{16,512}$/.test(credentialId)) throw new ApiRequestError("credentialId must be the passkey's raw id in base64url", 400, "service_error");
      if (!owner && (!/^0x[0-9a-fA-F]{64}$/.test(publicKey.x) || !/^0x[0-9a-fA-F]{64}$/.test(publicKey.y))) {
        throw new ApiRequestError("publicKey.x and publicKey.y must be 32-byte hex coordinates", 400, "service_error");
      }
      const token = h(`visitor-token:${credentialId}:${Date.now()}:${Math.random()}`).slice(2, 34);
      const prev = visitors.get(visitorIdFor(credentialId, publicKey.x, publicKey.y));
      const v = prev ?? build(credentialId, publicKey.x as Hex, publicKey.y as Hex, token, owner);
      if (prev) {
        // Same passkey again (after a revoke): same visitor id, a new mandate and a new token.
        v.round += 1;
        v.token = token;
        v.delegation = delegationFor(v, v.round);
        v.delegationHash = delegationStructHash(v.delegation);
        v.mandateHash = h(`visitor:${v.id}:mandate:${v.round}`);
        v.sealedAt = null;
      }
      const op = userOp(v.account, BigInt(v.round - 1), batch(publishCalls(v)));
      const del = delegationTypedData(v);
      v.pending = { opDigest: typedDataDigest(op), delegationDigest: typedDataDigest(del) };
      visitors.set(v.id, v);
      return {
        visitorId: v.id,
        token: v.token,
        account: v.account,
        did: `did:pkh:eip155:${FISCO_CHAIN}:${v.account.toLowerCase()}`,
        ledger: "fisco",
        ledgerBadge: BADGE,
        agent: { label: "Ying", wallet: v.agentWallet, agentId: v.agentId, identityCode: `YL-TEST-V${v.id.slice(2, 8).toUpperCase()}` },
        // A drafted mandate (sample) keeps the sentences the visitor saw; the sample caveats stay the standard ones.
        mandate: {
          title: owner ? "Your mandate (sealed with your secret key)" : req.mandate ? "Your own mandate (sealed with your passkey)" : "Your mandate (sealed with your passkey)",
          sentences: (req.mandate as { decoded?: string[] } | undefined)?.decoded ?? VISITOR_SENTENCES,
          mandateHash: v.mandateHash,
          delegationHash: v.delegationHash,
        },
        requests: [
          { kind: "seal", step: "publish", title: "Publish your mandate", digest: v.pending.opDigest, typedData: op },
          { kind: "seal", step: "delegation", title: "Give your agent this mandate", digest: v.pending.delegationDigest, typedData: del },
        ],
      };
    },

    reseal(visitorId: string, token: string, mandate?: unknown): VisitorSignUp {
      const v = visitors.get(visitorId);
      if (!v || v.token !== token) throw new ApiRequestError("unknown visitor or wrong session token", 400, "service_error");
      return this.signUp({ credentialId: v.credentialId, publicKey: { x: v.x, y: v.y }, mandate });
    },

    async seal(visitorId: string, token: string, sigs: { userOpSignature: string; delegationSignature: string }): Promise<VisitorSealResult> {
      const v = visitors.get(visitorId);
      if (!v || v.token !== token) throw new ApiRequestError("unknown visitor or wrong session token", 400, "service_error");
      if (!v.pending) throw new ApiRequestError("this sign-up expired; start again", 400, "service_error");
      await mustVerify(v, v.pending.delegationDigest, sigs.delegationSignature, "delegation");
      await mustVerify(v, v.pending.opDigest, sigs.userOpSignature, "user operation");
      v.pending = null;
      v.revoked = false;
      v.sealedAt = new Date().toISOString();
      v.publishTx = fiscoTx(`visitor:${v.id}:publish:${v.round}`).txHash as Hex;
      receipt(v, {
        summary: "Mandate sealed with your passkey",
        tier: "T3",
        outcome: "confirmed",
        txHash: v.publishTx,
        explanation: "Mandate sealed (passkey (WebAuthn)): published on-chain with its full rule set; your agent may act only inside it.",
      });
      return { principal: this.principal(v), mandateHash: v.mandateHash, publishTx: v.publishTx, ledger: "fisco", ledgerBadge: BADGE };
    },

    verify: mustVerify,

    principal(v: FixtureVisitor): Principal {
      return {
        id: v.id,
        kind: "person",
        did: `did:pkh:eip155:${FISCO_CHAIN}:${v.account.toLowerCase()}`,
        displayName: `Visitor ${v.id.slice(2, 6).toUpperCase()}`,
        account: v.account,
        ledger: "fisco",
        ledgerBadge: BADGE,
        agentId: v.agentId,
        agentName: "Ying",
        jurisdiction: "hk",
        signer: v.owner ? "secret key (secp256k1, kept in this browser)" : "passkey (WebAuthn)",
        paused: v.paused,
        passkeys: v.owner ? [] : [{ keyId: v.credentialId, label: "This passkey" }],
      };
    },

    mandate(v: FixtureVisitor): Mandate {
      return {
        id: `mandate-${v.id}-${v.round}`,
        mandateHash: v.mandateHash,
        delegationHash: v.delegationHash,
        version: v.round,
        status: v.revoked ? "revoked" : "live",
        jurisdiction: "hk",
        title: "Your mandate (sealed with your passkey)",
        ownerName: `Visitor ${v.id.slice(2, 6).toUpperCase()}`,
        agentId: v.agentId,
        rules: RULES.map((sentence, i) => ({
          id: `visitor-rule-${i}`,
          sentence,
          enforcer: ["AllowedTargetsEnforcer", "AllowedMethodsEnforcer", "VerifiedPayeeEnforcer", "CoSignEnforcer", "CategoryBudgetEnforcer", "ReserveFloorEnforcer"][i] ?? "Enforcer",
          enforcerAddress: v.delegation.caveats[i]!.enforcer,
          params: {},
          tierCeiling: null,
        })),
        decodedSentences: RULES,
        roundTrip: [{ id: "decode", label: "On-chain caveats decode back to the same sentences", passed: true }],
        validity: { notBefore: v.sealedAt ?? new Date().toISOString(), notAfter: new Date(Date.now() + 30 * 86_400_000).toISOString() },
        sealedAt: v.sealedAt,
        published: v.publishTx ? [{ ledger: "fisco", chainId: FISCO_CHAIN, txHash: v.publishTx, blockNumber: null, explorerUrl: null, badge: BADGE }] : [],
        supersedes: null,
        sourceText: VISITOR_SENTENCES.join(" "),
        serviceHashRing: null,
      };
    },

    budgets(): BudgetLane[] {
      const lane = (id: string, label: string, cap: string): BudgetLane => ({
        id,
        category: id,
        label,
        cap: amt(cap, THKD),
        spent: amt("0", THKD),
        period: "day",
        periodEnd: null,
        floor: null,
        breachForecastDays: null,
        enforcer: "CategoryBudgetEnforcer",
      });
      return [lane("food", "Food", "100"), lane("tuition", "Course materials", "300"), lane("services", "Services", "2")];
    },

    revokeContext(v: FixtureVisitor): RevokeContext {
      return { principalId: v.id, account: v.account, ledger: "fisco", mandateHash: v.mandateHash, delegationHash: v.delegationHash, directory: FISCO_DIRECTORY };
    },

    killSwitch: FISCO_DIRECTORY.KillSwitchRegistry!,
    chainId: FISCO_CHAIN,

    applyRevoke(v: FixtureVisitor) {
      v.revoked = true;
      receipt(v, {
        summary: "Revoked the mandate",
        tier: "T3",
        outcome: "confirmed",
        explanation: "Revoked the mandate and disabled its delegation (sample: confirmed in one user operation).",
      });
    },

    applyPause(v: FixtureVisitor, paused: boolean) {
      v.paused = paused;
      receipt(v, {
        summary: paused ? "Paused the agent (kill switch)" : "Resumed the agent",
        tier: "T3",
        outcome: "confirmed",
        explanation: paused ? "Paused every delegation of this account." : "Resumed the agent.",
      });
    },
  };
}

/** The revoke user operation for a context: execute(batch) with revoke + disableDelegation. */
export function revokeTypedData(ctx: RevokeContext, delegation: DelegationParts, accountKind: "person" | "company" = "person"): TypedData {
  const calls = [
    { to: ctx.directory.MandateRegistry!, data: encodeFunctionData({ abi: MANDATE_REGISTRY_ABI, functionName: "revoke", args: [ctx.mandateHash] }) },
    {
      to: ctx.directory.DelegationManager!,
      data: encodeFunctionData({ abi: DELEGATION_MANAGER_ABI, functionName: "disableDelegation", args: [delegation] }),
    },
  ];
  const td = userOp(ctx.account, 7n, batch(calls));
  return {
    ...td,
    domain: { ...td.domain, name: accountKind === "company" ? "MultiSigDeleGator" : "HybridDeleGator", chainId: ctx.ledger === "fisco" ? FISCO_CHAIN : 84532 },
    message: { ...td.message, entryPoint: ctx.directory.EntryPoint! },
  };
}
