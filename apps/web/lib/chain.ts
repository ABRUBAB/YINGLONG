/**
 * Chain-side helpers the front end computes itself (it never trusts a description of a call it is
 * about to sign): explorer links, ERC-7579 single-execution encoding, calldata decoding, typed data
 * for the fixture signing requests, and Merkle path verification.
 */
import { concatHex, decodeAbiParameters, decodeFunctionData, encodePacked, getAddress, keccak256, toBytes, toFunctionSelector, type Hex } from "viem";
import type { Ledger, MerkleProof, TypedData } from "./api/view";

export const CHAIN_ID: Record<Ledger, number> = {
  "base-sepolia": 84532,
  // FISCO BCOS returns CHAINID 0 inside the EVM; EIP-712 domains on FISCO use 0 (KR-16).
  fisco: 0,
  "anvil-bench": 31337,
};

/** FISCO and the Anvil bench have no public explorer: transactions open on our own /proof/tx page. */
const LOCAL_EXPLORER = "/proof/tx";
const APP_ORIGIN = "https://app.yinglong-agent.tech";

/** Explorer URL for a transaction. Bench (Anvil fork) transactions have no public explorer. */
export function explorerTxUrl(ledger: Ledger, txHash: string | null | undefined, given?: string | null): string | undefined {
  // Links the service builds for our own app open on whichever host serves this page.
  if (given) return given.startsWith(APP_ORIGIN) ? given.slice(APP_ORIGIN.length) : given;
  if (!txHash) return undefined;
  if (ledger === "base-sepolia") return `https://sepolia.basescan.org/tx/${txHash}`;
  return `${LOCAL_EXPLORER}/${ledger === "anvil-bench" ? "anvil" : ledger}/${txHash}`;
}

export function explorerAddressUrl(ledger: Ledger, address: string): string | undefined {
  if (ledger === "base-sepolia") return `https://sepolia.basescan.org/address/${address}`;
  return undefined;
}

/** ERC-7579 single execution as ExecutionLib.encodeSingle: abi.encodePacked(target, value, callData). */
export function encodeSingleExecution(target: Hex, value: bigint, callData: Hex): Hex {
  return encodePacked(["address", "uint256", "bytes"], [target, value, callData]);
}

/**
 * TypeScript port of contracts/src/libraries/PaymentDecoder.sol. The approval page decodes the
 * execution with exactly the three shapes the money enforcers accept, so what the user signs is what
 * the chain will enforce; anything else is undecodable (and the page refuses to sign).
 *  1. ERC-20 transfer(address to, uint256 amount)                       recipient = beneficiary = to
 *  2. ERC-1363 transferAndCall(address to, uint256 amount, bytes data)  recipient = to (a rail contract),
 *     beneficiary = first ABI word of data when present (the escrow payee, the FX desk), else to
 *  3. instruct(address payee, uint256 amount, bytes32 purposeHash, bytes32 conditionHash, uint64 validUntil)
 *     on ConditionalPaymentInstructions (coin-free rail)                recipient = beneficiary = payee
 */
export const SELECTORS = {
  transfer: "0xa9059cbb",
  transferAndCall: "0x4000aea0",
  instruct: toFunctionSelector("instruct(address,uint256,bytes32,bytes32,uint64)"),
} as const;

export const PAYMENT_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transferAndCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "instruct",
    stateMutability: "nonpayable",
    inputs: [
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "purposeHash", type: "bytes32" },
      { name: "conditionHash", type: "bytes32" },
      { name: "validUntil", type: "uint64" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
] as const;

/** ProtectedPayment escrow payload carried in transferAndCall data. */
export const ESCROW_DATA = [
  { name: "payee", type: "address" },
  { name: "conditionId", type: "bytes32" },
  { name: "attester", type: "address" },
  { name: "refundAfter", type: "uint64" },
] as const;

export interface DecodedPayment {
  /** Token or instruction contract (the execution target). */
  asset: Hex;
  /** Address that receives the asset (a rail contract for transferAndCall). */
  recipient: Hex;
  /** Party economically paid: the payee the payee and category rules check. */
  beneficiary: Hex;
  amount: bigint;
  selector: Hex;
  method: "transfer(address,uint256)" | "transferAndCall(address,uint256,bytes)" | "instruct(address,uint256,bytes32,bytes32,uint64)";
  args: Array<{ name: string; type: string; value: string }>;
}

export class UndecodableExecution extends Error {
  constructor(readonly selector: string, reason: string) {
    super(`This call cannot be decoded (${reason}); the page will not sign it.`);
    this.name = "UndecodableExecution";
  }
}

export function decodePayment(target: Hex, value: bigint, callData: Hex): DecodedPayment {
  if (value !== 0n) throw new UndecodableExecution("0x", "it sends the native coin");
  if (callData.length < 10) throw new UndecodableExecution("0x", "no function selector");
  const selector = callData.slice(0, 10).toLowerCase() as Hex;
  const asset = getAddress(target) as Hex;
  const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : String(v));
  if (selector === SELECTORS.transfer) {
    if ((callData.length - 2) / 2 !== 68) throw new UndecodableExecution(selector, "transfer calldata must be 68 bytes");
    const d = decodeFunctionData({ abi: PAYMENT_ABI, data: callData });
    const [to, amount] = d.args as readonly [Hex, bigint];
    return {
      asset,
      recipient: getAddress(to) as Hex,
      beneficiary: getAddress(to) as Hex,
      amount,
      selector,
      method: "transfer(address,uint256)",
      args: [
        { name: "to", type: "address", value: getAddress(to) },
        { name: "amount", type: "uint256", value: str(amount) },
      ],
    };
  }
  if (selector === SELECTORS.transferAndCall) {
    const d = decodeFunctionData({ abi: PAYMENT_ABI, data: callData });
    const [to, amount, data] = d.args as readonly [Hex, bigint, Hex];
    let beneficiary = getAddress(to) as Hex;
    const args = [
      { name: "to", type: "address", value: getAddress(to) },
      { name: "amount", type: "uint256", value: str(amount) },
    ];
    if ((data.length - 2) / 2 >= 32) {
      const word = BigInt(`0x${data.slice(2, 66)}`);
      if (word >> 160n !== 0n) throw new UndecodableExecution(selector, "dirty beneficiary word");
      beneficiary = getAddress(`0x${data.slice(26, 66)}`) as Hex;
      args.push({ name: "data.beneficiary", type: "address", value: beneficiary });
      if ((data.length - 2) / 2 === 128) {
        try {
          const [, conditionId, attester, refundAfter] = decodeAbiParameters(ESCROW_DATA, data);
          args.push(
            { name: "data.conditionId", type: "bytes32", value: conditionId },
            { name: "data.attester", type: "address", value: attester },
            { name: "data.refundAfter", type: "uint64", value: str(refundAfter) },
          );
        } catch {
          /* not an escrow payload: beneficiary only */
        }
      }
    }
    return { asset, recipient: getAddress(to) as Hex, beneficiary, amount, selector, method: "transferAndCall(address,uint256,bytes)", args };
  }
  if (selector === SELECTORS.instruct) {
    if ((callData.length - 2) / 2 !== 164) throw new UndecodableExecution(selector, "instruct calldata must be 164 bytes");
    const d = decodeFunctionData({ abi: PAYMENT_ABI, data: callData });
    const [payee, amount, purposeHash, conditionHash, validUntil] = d.args as readonly [Hex, bigint, Hex, Hex, bigint];
    return {
      asset,
      recipient: getAddress(payee) as Hex,
      beneficiary: getAddress(payee) as Hex,
      amount,
      selector,
      method: "instruct(address,uint256,bytes32,bytes32,uint64)",
      args: [
        { name: "payee", type: "address", value: getAddress(payee) },
        { name: "amount", type: "uint256", value: str(amount) },
        { name: "purposeHash", type: "bytes32", value: purposeHash },
        { name: "conditionHash", type: "bytes32", value: conditionHash },
        { name: "validUntil", type: "uint64", value: str(validUntil) },
      ],
    };
  }
  throw new UndecodableExecution(selector, `unknown selector ${selector}`);
}

/** CoSignEnforcer executionHash: keccak256(abi.encodePacked(target, value, callData)). */
export function executionHash(target: Hex, value: bigint, callData: Hex): Hex {
  return keccak256(encodeSingleExecution(target, value, callData));
}

/* ------------------------------------------------------------------ typed data (fixture signing requests) */

export const DELEGATION_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3";

export const DELEGATION_TYPES = {
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
};

/** keccak256("YINGLONG-<ledger name>"): the domain salt of every YinglongEIP712 contract (KR-16). */
export function domainSalt(ledgerName: string): Hex {
  return keccak256(toBytes(`YINGLONG-${ledgerName}`));
}

/** CoSignEnforcer: Approval(bytes32 delegationHash, bytes32 executionHash, uint256 nonce, uint256 expiry). */
export function cosignTypedData(args: {
  chainId: number;
  ledgerName: string;
  verifyingContract: Hex;
  delegationHash: Hex;
  executionCallData: Hex;
  nonce: bigint;
  expiry: bigint;
}): TypedData {
  return {
    domain: { name: "YINGLONG CoSign", version: "1", chainId: args.chainId, verifyingContract: args.verifyingContract, salt: domainSalt(args.ledgerName) },
    types: {
      Approval: [
        { name: "delegationHash", type: "bytes32" },
        { name: "executionHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
      ],
    },
    primaryType: "Approval",
    message: {
      delegationHash: args.delegationHash,
      executionHash: keccak256(args.executionCallData),
      nonce: args.nonce.toString(),
      expiry: args.expiry.toString(),
    },
  };
}

/** KillSwitchRegistry: Trip / Untrip(address account, uint256 nonce, uint256 deadline). */
export function killSwitchTypedData(args: { action: "Trip" | "Untrip"; chainId: number; ledgerName: string; verifyingContract: Hex; account: Hex; nonce: bigint; deadline: bigint }): TypedData {
  return {
    domain: { name: "YINGLONG Kill Switch", version: "1", chainId: args.chainId, verifyingContract: args.verifyingContract, salt: domainSalt(args.ledgerName) },
    types: {
      [args.action]: [
        { name: "account", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: args.action,
    message: { account: args.account, nonce: args.nonce.toString(), deadline: args.deadline.toString() },
  };
}

/* ------------------------------------------------------------------ Merkle paths */

/** Positional parent: keccak256(left || right). */
export function merkleParent(left: Hex, right: Hex): Hex {
  return keccak256(concatHex([left, right]));
}

/** OpenZeppelin MerkleProof convention: keccak256 of the sorted pair. */
export function merkleParentSorted(a: Hex, b: Hex): Hex {
  return BigInt(a) <= BigInt(b) ? merkleParent(a, b) : merkleParent(b, a);
}

export interface MerkleStep {
  level: number;
  sibling: Hex;
  position: "left" | "right" | null;
  result: Hex;
}

/** Recomputes the root from leaf and path; every intermediate node is returned for display. */
export function verifyMerklePath(proof: Pick<MerkleProof, "leaf" | "path" | "root" | "pairing">): { steps: MerkleStep[]; root: Hex; matches: boolean } {
  let node = proof.leaf as Hex;
  const steps: MerkleStep[] = [];
  proof.path.forEach((p, level) => {
    const sib = p.sibling as Hex;
    if (proof.pairing === "sorted" || !p.position) node = merkleParentSorted(node, sib);
    else node = p.position === "left" ? merkleParent(sib, node) : merkleParent(node, sib);
    steps.push({ level: level + 1, sibling: sib, position: proof.pairing === "sorted" ? null : p.position, result: node });
  });
  return { steps, root: node, matches: node.toLowerCase() === proof.root.toLowerCase() };
}

/** Builds a positional Merkle tree (fixtures and tests). Odd levels duplicate the last node. */
export function buildMerkle(leaves: Hex[]): { root: Hex; proofFor: (i: number) => MerkleProof["path"] } {
  const levels: Hex[][] = [leaves.slice()];
  while (levels[levels.length - 1]!.length > 1) {
    const cur = levels[levels.length - 1]!;
    const next: Hex[] = [];
    for (let k = 0; k < cur.length; k += 2) next.push(merkleParent(cur[k]!, cur[k + 1] ?? cur[k]!));
    levels.push(next);
  }
  return {
    root: levels[levels.length - 1]![0]!,
    proofFor(i: number) {
      const path: MerkleProof["path"] = [];
      let idx = i;
      for (let lv = 0; lv < levels.length - 1; lv++) {
        const cur = levels[lv]!;
        const isRight = idx % 2 === 1;
        const sib = isRight ? cur[idx - 1]! : (cur[idx + 1] ?? cur[idx]!);
        path.push({ sibling: sib, position: isRight ? "left" : "right" });
        idx = Math.floor(idx / 2);
      }
      return path;
    },
  };
}
