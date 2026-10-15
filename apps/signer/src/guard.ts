import { decodeAbiParameters, decodeFunctionData, getAddress, slice, size, type Address, type Hex } from "viem";
import { abi, type Deployment } from "@yinglong/sdk";
import { SELECTORS } from "@yinglong/mandate";

/**
 * The signer's guard. The agent key may sign exactly one kind of transaction: DelegationManager
 * .redeemDelegations, with single-call default-mode executions, leaf delegate = this agent, and an
 * execution that is a payment shape YINGLONG understands on an asset of this deployment. Everything else
 * (approvals, arbitrary calls, raw transfers from the agent's own balance, contract deployments) is refused.
 */
export interface GuardInput {
  deployment: Deployment;
  agent: Address;
  to: Address;
  data: Hex;
  value: bigint;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
  executions?: { target: Address; selector: Hex }[];
}

const SINGLE_DEFAULT = "0x0000000000000000000000000000000000000000000000000000000000000000";

const DELEGATION_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "tuple[]", components: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }, { name: "args", type: "bytes" }] },
    { name: "salt", type: "uint256" },
    { name: "signature", type: "bytes" },
  ],
} as const;

export function guardRedemption(x: GuardInput): GuardResult {
  const d = x.deployment.contracts;
  if (getAddress(x.to) !== getAddress(d.DelegationManager.address)) return { ok: false, reason: "target is not the DelegationManager" };
  if (x.value !== 0n) return { ok: false, reason: "native value not allowed" };
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: abi.DelegationManagerAbi, data: x.data });
  } catch {
    return { ok: false, reason: "calldata does not decode" };
  }
  if (decoded.functionName !== "redeemDelegations") return { ok: false, reason: `function ${decoded.functionName} is not allowed` };
  const [contexts, modes, executions] = decoded.args as readonly [readonly Hex[], readonly Hex[], readonly Hex[]];
  if (contexts.length !== modes.length || modes.length !== executions.length || contexts.length === 0 || contexts.length > 8) {
    return { ok: false, reason: "bad batch shape" };
  }
  const assets = new Set([d.TestHKD.address, d.TestUSD.address, d.ConditionalPaymentInstructions.address].map((a) => a.toLowerCase()));
  for (const extra of (process.env.SIGNER_EXTRA_ASSETS ?? "").split(",").filter(Boolean)) assets.add(extra.toLowerCase());
  const allowedSelectors = new Set(Object.values(SELECTORS));
  const out: { target: Address; selector: Hex }[] = [];
  for (let i = 0; i < contexts.length; i++) {
    if (modes[i]!.toLowerCase() !== SINGLE_DEFAULT) return { ok: false, reason: "only single-call default mode is allowed" };
    const [chain] = decodeAbiParameters([DELEGATION_TUPLE], contexts[i]!);
    if (chain.length === 0) return { ok: false, reason: "self-authorised execution is not allowed" };
    if (getAddress(chain[0]!.delegate) !== getAddress(x.agent)) return { ok: false, reason: "leaf delegate is not this agent" };
    const exec = executions[i]!;
    if (size(exec) < 56) return { ok: false, reason: "execution too short" };
    const target = getAddress(slice(exec, 0, 20));
    const value = BigInt(slice(exec, 20, 52));
    const selector = slice(exec, 52, 56);
    if (value !== 0n) return { ok: false, reason: "execution carries native value" };
    if (!assets.has(target.toLowerCase())) return { ok: false, reason: `execution target ${target} is not a YINGLONG asset` };
    if (!allowedSelectors.has(selector as (typeof SELECTORS)[keyof typeof SELECTORS])) return { ok: false, reason: `selector ${selector} is not a payment` };
    out.push({ target, selector });
  }
  return { ok: true, executions: out };
}
