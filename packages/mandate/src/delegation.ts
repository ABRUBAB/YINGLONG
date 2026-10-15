import { concat, encodeAbiParameters, hashTypedData, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { CAVEAT_TYPE, DELEGATION_TYPE, ROOT_AUTHORITY } from "./constants";

export interface Caveat {
  enforcer: Address;
  terms: Hex;
  args: Hex;
}

export interface Delegation {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: bigint;
  signature: Hex;
}

const DELEGATION_TYPEHASH = keccak256(stringToBytes(DELEGATION_TYPE));
const CAVEAT_TYPEHASH = keccak256(stringToBytes(CAVEAT_TYPE));

/** Hash of one caveat, exactly as EncoderLib._getCaveatPacketHash (args are NOT part of the hash). */
export function caveatHash(c: Caveat): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }], [CAVEAT_TYPEHASH, c.enforcer, keccak256(c.terms)]),
  );
}

/** ERC-7710 delegation hash, exactly as DelegationManager.getDelegationHash. This is H for the Hash Ring. */
export function delegationHash(d: Pick<Delegation, "delegate" | "delegator" | "authority" | "caveats" | "salt">): Hex {
  const arrayHash = keccak256(d.caveats.length ? concat(d.caveats.map(caveatHash)) : "0x");
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
      [DELEGATION_TYPEHASH, d.delegate, d.delegator, d.authority as Hex, arrayHash, d.salt],
    ),
  );
}

export function rootDelegation(delegator: Address, delegate: Address, caveats: Caveat[], salt: bigint): Delegation {
  return { delegate, delegator, authority: ROOT_AUTHORITY, caveats, salt, signature: "0x" };
}

/** Typed data the user's passkey signs to seal a delegation (DelegationManager EIP-712 domain). */
export function delegationTypedData(d: Delegation, delegationManager: Address, domainChainId: number) {
  return {
    domain: { name: "DelegationManager", version: "1", chainId: domainChainId, verifyingContract: delegationManager },
    types: {
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
    },
    primaryType: "Delegation" as const,
    message: {
      delegate: d.delegate,
      delegator: d.delegator,
      authority: d.authority,
      caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt: d.salt,
    },
  };
}

/** The 32-byte digest the account's ERC-1271 check receives for a delegation signature. */
export function delegationDigest(d: Delegation, delegationManager: Address, domainChainId: number): Hex {
  return hashTypedData(delegationTypedData(d, delegationManager, domainChainId));
}

/** ABI-encode a permission context (Delegation[] leaf first) for redeemDelegations. */
export function encodePermissionContext(chain: Delegation[]): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "delegate", type: "address" },
          { name: "delegator", type: "address" },
          { name: "authority", type: "bytes32" },
          {
            name: "caveats",
            type: "tuple[]",
            components: [
              { name: "enforcer", type: "address" },
              { name: "terms", type: "bytes" },
              { name: "args", type: "bytes" },
            ],
          },
          { name: "salt", type: "uint256" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    [chain.map((d) => ({ ...d, authority: d.authority as Hex }))],
  );
}
