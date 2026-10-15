import { concat, keccak256, type Hex } from "viem";

/**
 * Merkle tree with sorted (commutative) pair hashing, the OpenZeppelin MerkleProof convention, so proofs
 * verify with AccountabilityLedger.verifyReceipt. Leaves are receipt hashes (already 32-byte hashes,
 * used as-is). An odd node is carried up unchanged.
 */
function hashPair(a: Hex, b: Hex): Hex {
  return a.toLowerCase() < b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export interface MerkleTree {
  root: Hex;
  layers: Hex[][];
}

export function buildMerkle(leaves: Hex[]): MerkleTree {
  if (leaves.length === 0) throw new Error("empty tree");
  const layers: Hex[][] = [leaves.map((l) => l.toLowerCase() as Hex)];
  while (layers[layers.length - 1]!.length > 1) {
    const prev = layers[layers.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i]!, prev[i + 1]!) : prev[i]!);
    layers.push(next);
  }
  return { root: layers[layers.length - 1]![0]!, layers };
}

export function merkleProof(tree: MerkleTree, index: number): Hex[] {
  const proof: Hex[] = [];
  let i = index;
  for (let l = 0; l < tree.layers.length - 1; l++) {
    const layer = tree.layers[l]!;
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < layer.length) proof.push(layer[sibling]!);
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyMerkle(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let h = leaf.toLowerCase() as Hex;
  for (const p of proof) h = hashPair(h, p);
  return h.toLowerCase() === root.toLowerCase();
}
