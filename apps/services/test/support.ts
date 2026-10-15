// Test support: a HybridDeleGator smart account with an ECDSA owner (so the test can sign its delegations
// without a passkey), funded with test units, plus helpers to build the root mandate delegation and the
// single-use x402 child the seller expects. Runs against the live Anvil deployment.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { abi } from "@yinglong/sdk";
import { rolePrivateKey, type Role } from "@yinglong/sdk/server";
import { delegationHash, encodePermissionContext, ROOT_AUTHORITY, type Caveat, type Delegation } from "@yinglong/mandate";
import { Ledger } from "../src/chain";

const HYBRID_INIT_ABI = [
  {
    type: "function",
    name: "initialize",
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_keyIds", type: "string[]" },
      { name: "_xValues", type: "uint256[]" },
      { name: "_yValues", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const PROXY_ABI = [{ type: "constructor", inputs: [{ name: "implementation", type: "address" }, { name: "_data", type: "bytes" }], stateMutability: "payable" }] as const;

function proxyBytecode(): Hex {
  const p = resolve(import.meta.dirname, "..", "..", "..", "contracts", "out", "ERC1967Proxy.sol", "ERC1967Proxy.json");
  const art = JSON.parse(readFileSync(p, "utf8")) as { bytecode: { object: string } };
  const obj = art.bytecode.object;
  return (obj.startsWith("0x") ? obj : `0x${obj}`) as Hex;
}

export interface TestAccount {
  address: Address;
  ownerKey: Hex;
  owner: Address;
}

/** Deploy a HybridDeleGator proxy owned by a fresh ECDSA key and return it. */
export async function deployAccount(ledger: Ledger): Promise<TestAccount> {
  const ownerKey = generatePrivateKey();
  const owner = privateKeyToAccount(ownerKey).address;
  const impl = ledger.addr("HybridDeleGatorImpl");
  const initData = encodeFunctionData({ abi: HYBRID_INIT_ABI, functionName: "initialize", args: [owner, [], [], []] });
  const deployer = ledger.wallet("deployer");
  await ledger.ensureGas(ledger.roleAddress("deployer"));
  const hash = await deployer.deployContract({
    abi: PROXY_ABI,
    bytecode: proxyBytecode(),
    args: [impl, initData],
    account: deployer.account!,
    chain: ledger.chain,
    ...ledger.txOpts(),
  } as never);
  const receipt = await ledger.pub.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("account deployment did not return an address");
  return { address: getAddress(receipt.contractAddress), ownerKey, owner };
}

export async function mintTo(ledger: Ledger, token: Address, to: Address, amount: bigint): Promise<void> {
  await ledger.ensureGas(ledger.roleAddress("deployer"));
  await ledger.write("deployer", { address: token, abi: abi.TestUnitsAbi, functionName: "mint", args: [to, amount] });
}

export const balanceOf = (ledger: Ledger, token: Address, who: Address) =>
  ledger.read<bigint>({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

const caveat = (enforcer: Address, terms: Hex): Caveat => ({ enforcer, terms, args: "0x" });
const packAddrs = (a: Address[]): Hex => (a.length ? concat(a.map((x) => encodePacked(["address"], [x]))) : "0x");

/** DelegationManager EIP-712 digest for a delegation (on-chain domain hash: correct on every ledger). */
async function digest(ledger: Ledger, d: Delegation): Promise<Hex> {
  const domainHash = await ledger.read<Hex>({ address: ledger.addr("DelegationManager"), abi: abi.DelegationManagerAbi, functionName: "getDomainHash" });
  return keccak256(concat(["0x1901", domainHash, delegationHash(d)]));
}

async function signAsOwner(ledger: Ledger, account: TestAccount, d: Delegation): Promise<Hex> {
  return (await sign({ hash: await digest(ledger, d), privateKey: account.ownerKey, to: "hex" })) as Hex;
}
async function signAsRole(ledger: Ledger, role: Role, d: Delegation): Promise<Hex> {
  return (await sign({ hash: await digest(ledger, d), privateKey: rolePrivateKey(role), to: "hex" })) as Hex;
}

/**
 * Root mandate delegation account -> agent allowing ERC-20 transfer and transferAndCall on the given tokens.
 * Minimal and realistic enough to isolate the x402 mechanics (the full mandate caveats are tested in Solidity).
 */
export async function buildRoot(ledger: Ledger, account: TestAccount, agentRole: Role, tokens: Address[], salt: bigint): Promise<Delegation> {
  const caveats: Caveat[] = [
    caveat(ledger.addr("AllowedTargetsEnforcer"), packAddrs(tokens)),
    caveat(ledger.addr("AllowedMethodsEnforcer"), concat(["0xa9059cbb", "0x4000aea0"])), // transfer, transferAndCall
  ];
  const d: Delegation = { delegate: ledger.roleAddress(agentRole), delegator: account.address, authority: ROOT_AUTHORITY, caveats, salt, signature: "0x" };
  d.signature = await signAsOwner(ledger, account, d);
  return d;
}

/** The single-use, exact-amount, short-window x402 child agent -> seller (plan section 9.7). */
export async function buildX402Child(
  ledger: Ledger,
  parent: Delegation,
  agentRole: Role,
  seller: Address,
  asset: Address,
  amount: bigint,
  windowSeconds: number,
  salt: bigint,
): Promise<Delegation> {
  const now = await ledger.now();
  const before = now + ledger.span(windowSeconds);
  const caveats: Caveat[] = [
    caveat(ledger.addr("ERC20TransferAmountEnforcer"), encodePacked(["address", "uint256"], [asset, amount])),
    caveat(ledger.addr("LimitedCallsEnforcer"), encodePacked(["uint256"], [1n])),
    caveat(ledger.addr("TimestampEnforcer"), encodePacked(["uint128", "uint128"], [0n, before])),
  ];
  const d: Delegation = { delegate: seller, delegator: ledger.roleAddress(agentRole), authority: delegationHash(parent), caveats, salt, signature: "0x" };
  d.signature = await signAsRole(ledger, agentRole, d);
  return d;
}

export function permissionContext(chain: Delegation[]): Hex {
  return encodePermissionContext(chain);
}

/** Build the x402 PaymentPayload header value for the exact/erc7710 scheme from a 402 challenge. */
export function buildPaymentHeader(challenge: { accepts: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: Record<string, unknown> }[] }, ctx: Hex, delegator: Address, delegationManager: Address): string {
  const accepted = challenge.accepts[0]!;
  const payload = {
    x402Version: 2,
    accepted,
    payload: { delegationManager, permissionContext: ctx, delegator },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodeChallenge(headerB64: string): { accepts: { scheme: string; network: string; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra?: Record<string, unknown> }[]; error?: string } {
  return JSON.parse(Buffer.from(headerB64, "base64").toString("utf8")) as never;
}
