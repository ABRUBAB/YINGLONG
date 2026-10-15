// Must match contracts/src/utils/Categories.sol and JurisdictionEnforcer / MandateRegistry profiles.

export const CATEGORY_IDS = {
  rent: 1,
  food: 2,
  tuition: 3,
  transport: 4,
  utilities: 5,
  supplier: 6,
  payroll: 7,
  services: 8,
  treasury: 9,
  other: 10,
} as const;

export type Category = keyof typeof CATEGORY_IDS;
export const CATEGORIES = Object.keys(CATEGORY_IDS) as Category[];

export function categoryName(id: number): Category {
  const hit = (Object.entries(CATEGORY_IDS) as [Category, number][]).find(([, v]) => v === id);
  if (!hit) throw new Error(`unknown category id ${id}`);
  return hit[0];
}

export const PROFILE_IDS = {
  hk: 1,
  international: 2,
  mainland: 3,
} as const;

export type Jurisdiction = keyof typeof PROFILE_IDS;

export const PROFILE_LABELS: Record<Jurisdiction, string> = {
  hk: "Hong Kong",
  international: "International",
  mainland: "Mainland China (coin-free rail)",
};

export function profileName(id: number): Jurisdiction {
  const hit = (Object.entries(PROFILE_IDS) as [Jurisdiction, number][]).find(([, v]) => v === id);
  if (!hit) throw new Error(`unknown profile id ${id}`);
  return hit[0];
}

export const SELECTORS = {
  transfer: "0xa9059cbb",
  transferAndCall: "0x4000aea0",
  instruct: "0xa755512d",
} as const;

export type MethodName = keyof typeof SELECTORS;

export const ROOT_AUTHORITY = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as const;

/** The DelegationManager EIP-712 type strings (MetaMask Delegation Framework v1.3.0, utils/Constants.sol). */
export const DELEGATION_TYPE =
  "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)";
export const CAVEAT_TYPE = "Caveat(address enforcer,bytes terms)";
