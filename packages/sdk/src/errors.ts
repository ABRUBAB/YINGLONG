import { decodeErrorResult, type Hex } from "viem";
import { YinglongErrorsAbi } from "./abi/YinglongErrors";

export interface DecodedRevert {
  /** Typed error name, e.g. "PayeeNotVerified", or "Error" for string reverts, or "Unknown". */
  name: string;
  args: readonly unknown[];
  /** Human message, e.g. "PayeeNotVerified(0xabc...)" or the framework revert string. */
  message: string;
  raw: Hex;
}

const ERROR_STRING_SELECTOR = "0x08c379a0";

/** Decode revert data from any YINGLONG contract or the MetaMask Delegation Framework. */
export function decodeRevert(data: Hex | undefined): DecodedRevert {
  const raw = (data ?? "0x") as Hex;
  if (!raw || raw === "0x") return { name: "Unknown", args: [], message: "reverted without data", raw };
  if (raw.startsWith(ERROR_STRING_SELECTOR)) {
    try {
      const r = decodeErrorResult({ abi: [{ type: "error", name: "Error", inputs: [{ type: "string", name: "reason" }] }], data: raw });
      const reason = String(r.args?.[0] ?? "");
      return { name: "Error", args: [reason], message: reason, raw };
    } catch {
      /* fall through */
    }
  }
  try {
    const r = decodeErrorResult({ abi: YinglongErrorsAbi, data: raw });
    const args = (r.args ?? []) as readonly unknown[];
    return { name: r.errorName, args, message: `${r.errorName}(${args.map(String).join(", ")})`, raw };
  } catch {
    return { name: "Unknown", args: [], message: `unknown revert ${raw.slice(0, 10)}`, raw };
  }
}

/** Walk a viem error chain and pull out revert data, if any. */
export function revertDataOf(err: unknown): Hex | undefined {
  let e: unknown = err;
  for (let i = 0; i < 8 && e; i++) {
    const anyE = e as { data?: unknown; cause?: unknown; details?: unknown };
    if (typeof anyE.data === "string" && anyE.data.startsWith("0x")) return anyE.data as Hex;
    if (anyE.data && typeof anyE.data === "object" && typeof (anyE.data as { data?: unknown }).data === "string") {
      return (anyE.data as { data: Hex }).data;
    }
    e = anyE.cause;
  }
  return undefined;
}
