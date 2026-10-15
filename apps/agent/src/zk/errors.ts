import { decodeErrorResult, type Hex } from "viem";
import { decodeRevert, type DecodedRevert } from "@yinglong/sdk";

/** Errors of contracts/src/zk (ZKErrors.sol) plus InvalidMandateProof, which the SDK table does not list yet. */
export const ZK_ERRORS_ABI = [
  { type: "error", name: "InvalidMandateProof", inputs: [] },
  {
    type: "error",
    name: "ClaimedTimeOutOfRange",
    inputs: [
      { type: "uint64", name: "claimedTime" },
      { type: "uint256", name: "blockTimestamp" },
    ],
  },
  { type: "error", name: "AmountOutOfRange", inputs: [{ type: "uint256", name: "amount" }] },
  { type: "error", name: "UnknownProofType", inputs: [{ type: "uint8", name: "proofType" }] },
  { type: "error", name: "ProofTypeAlreadyRegistered", inputs: [{ type: "uint8", name: "proofType" }] },
  { type: "error", name: "VerifierHasNoCode", inputs: [{ type: "address", name: "verifier" }] },
  { type: "error", name: "MalformedPublicInputs", inputs: [{ type: "uint256", name: "length" }] },
] as const;

/** Decode a revert from any YINGLONG contract, the Delegation Framework or the ZK contracts. */
export function decodeZkRevert(data: Hex | undefined): DecodedRevert {
  const base = decodeRevert(data);
  if (base.name !== "Unknown" || !data || data === "0x") return base;
  try {
    const r = decodeErrorResult({ abi: ZK_ERRORS_ABI, data });
    const args = (r.args ?? []) as readonly unknown[];
    return { name: r.errorName, args, message: `${r.errorName}(${args.map(String).join(", ")})`, raw: data };
  } catch {
    return base;
  }
}
