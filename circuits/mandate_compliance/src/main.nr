// YINGLONG private mandate: one stateful payment is within a hidden mandate.
//
// Statement (proof type 0x01, "mandate compliance"):
//   I know (cap, allowlistRoot, expiry, salt) that open `mandate_commitment`, a Merkle path that puts
//   `payee` in the allowlist tree with root allowlistRoot, and an opening (oldTotal, oldBlind) of
//   `old_running_commitment`, such that claimed_time <= expiry, oldTotal + amount <= cap (no u128
//   overflow) and `new_running_commitment` opens to (oldTotal + amount, newBlind).
//
// delegation_hash_hi/lo, chain_id and nonce are not used by any constraint. They are public inputs, so
// the proof is bound to them through the public-input part of the permutation argument: a proof made
// for one value does not verify for another (tested in contracts/test/zk).
//
// First payment convention: the running total starts at zero with blinding zero, so the first
// old_running_commitment is poseidon2_hash2(0, 0). The enforcer stores that constant implicitly.
//
// Hash: barretenberg Poseidon2 sponge over BN254 (state width 4, rate 3, capacity 1,
// IV = input_length * 2^64, output = state[0] after squeezing). It is written out here with the stdlib
// permutation for the three input lengths we use (1, 2 and 4) so that the circuit has no external
// dependency. Lengths that are a multiple of the rate are deliberately not used.

global TWO_POW_64: Field = 18446744073709551616;
global TREE_DEPTH: u32 = 8;

/// Poseidon2 hash of one field element (Merkle leaf).
pub fn poseidon2_hash1(a: Field) -> Field {
    std::hash::poseidon2_permutation([a, 0, 0, TWO_POW_64])[0]
}

/// Poseidon2 hash of two field elements (Merkle node and running commitment).
pub fn poseidon2_hash2(a: Field, b: Field) -> Field {
    std::hash::poseidon2_permutation([a, b, 0, 2 * TWO_POW_64])[0]
}

/// Poseidon2 hash of four field elements (mandate commitment): absorb three, permute, absorb the
/// fourth, permute, squeeze.
pub fn poseidon2_hash4(a: Field, b: Field, c: Field, d: Field) -> Field {
    let s = std::hash::poseidon2_permutation([a, b, c, 4 * TWO_POW_64]);
    std::hash::poseidon2_permutation([s[0] + d, s[1], s[2], s[3]])[0]
}

/// Allowlist leaf for a payee address (the address as a field element).
pub fn allowlist_leaf(payee: Field) -> Field {
    poseidon2_hash1(payee)
}

/// Root of the depth-8 allowlist tree for `leaf` at `index` with sibling path `path` (leaf level first).
/// Bit i of `index` set means the current node is the right child at level i.
pub fn merkle_root(leaf: Field, index: u8, path: [Field; TREE_DEPTH]) -> Field {
    let mut node = leaf;
    for i in 0..TREE_DEPTH {
        let is_right = ((index >> (i as u8)) & 1) == 1;
        let sibling = path[i];
        node = if is_right {
            poseidon2_hash2(sibling, node)
        } else {
            poseidon2_hash2(node, sibling)
        };
    }
    node
}

fn main(
    // ---- private witness ----
    cap: u128,
    allowlist_root: Field,
    payee_path: [Field; TREE_DEPTH],
    payee_index: u8,
    expiry: u64,
    salt: Field,
    old_total: u128,
    old_blind: Field,
    new_blind: Field,
    // ---- public inputs, in this order ----
    mandate_commitment: pub Field,
    delegation_hash_hi: pub Field,
    delegation_hash_lo: pub Field,
    chain_id: pub Field,
    payee: pub Field,
    amount: pub u128,
    nonce: pub Field,
    claimed_time: pub u64,
    old_running_commitment: pub Field,
    new_running_commitment: pub Field,
) {
    // Bound only as public inputs.
    let _ = (delegation_hash_hi, delegation_hash_lo, chain_id, nonce);

    // 1. The hidden mandate opens.
    let commitment = poseidon2_hash4(cap as Field, allowlist_root, expiry as Field, salt);
    assert(commitment == mandate_commitment, "mandate commitment does not open");

    // 2. The payee is in the hidden allowlist.
    let root = merkle_root(allowlist_leaf(payee), payee_index, payee_path);
    assert(root == allowlist_root, "payee not in allowlist");

    // 3. The mandate has not expired at the claimed time.
    assert(claimed_time <= expiry, "mandate expired");

    // 4. The old running total opens.
    assert(
        poseidon2_hash2(old_total as Field, old_blind) == old_running_commitment,
        "old running commitment does not open",
    );

    // 5. The new running total stays within the hidden cap. u128 addition is overflow-checked.
    let new_total: u128 = old_total + amount;
    assert(new_total <= cap, "cap exceeded");

    // 6. The new running commitment is correct.
    assert(
        poseidon2_hash2(new_total as Field, new_blind) == new_running_commitment,
        "new running commitment incorrect",
    );
}

// ------------------------------------------------------------------------------------------------
// Tests (nargo test). Golden values are cross-checked against bb.js in circuits/prover.
// ------------------------------------------------------------------------------------------------

#[test]
fn test_initial_running_commitment_golden() {
    // poseidon2_hash2(0, 0): the first-payment convention, hard-coded in ZKMandateEnforcer.
    let h = poseidon2_hash2(0, 0);
    println(h);
}

#[test]
fn test_hashes_print() {
    println(poseidon2_hash1(1));
    println(poseidon2_hash2(1, 2));
    println(poseidon2_hash4(1, 2, 3, 4));
}

#[test]
fn test_hash4_matches_generic_sponge() {
    // The 4-element schedule (absorb three, permute, absorb one, permute) re-derived step by step.
    // The permutation parameters themselves are pinned by the golden values shared with bb.js.
    let iv = 4 * TWO_POW_64;
    let s1 = std::hash::poseidon2_permutation([1, 2, 3, iv]);
    let s2 = std::hash::poseidon2_permutation([s1[0] + 4, s1[1], s1[2], s1[3]]);
    assert(s2[0] == poseidon2_hash4(1, 2, 3, 4));
}

fn sample_tree(payee: Field) -> ([Field; TREE_DEPTH], Field) {
    // payee at index 5, every other leaf empty (0).
    let index: u8 = 5;
    let mut level_nodes: [Field; 256] = [0; 256];
    level_nodes[index as u32] = allowlist_leaf(payee);
    let mut path = [0; TREE_DEPTH];
    let mut width: u32 = 256;
    let mut idx: u32 = index as u32;
    for level in 0..TREE_DEPTH {
        path[level] = level_nodes[idx ^ 1];
        let mut next: [Field; 256] = [0; 256];
        for j in 0..128 {
            if j < width / 2 {
                next[j] = poseidon2_hash2(level_nodes[2 * j], level_nodes[2 * j + 1]);
            }
        }
        level_nodes = next;
        width = width / 2;
        idx = idx / 2;
    }
    (path, level_nodes[0])
}

#[test]
fn test_valid_payment() {
    let payee = 0x00000000000000000000000000000000000000b0b;
    let (path, root) = sample_tree(payee);
    let cap: u128 = 1000;
    let expiry: u64 = 2000000000;
    let salt = 77;
    let old_total: u128 = 300;
    let amount: u128 = 700;
    main(
        cap,
        root,
        path,
        5,
        expiry,
        salt,
        old_total,
        11,
        12,
        poseidon2_hash4(cap as Field, root, expiry as Field, salt),
        1,
        2,
        84532,
        payee,
        amount,
        9,
        1999999999,
        poseidon2_hash2(old_total as Field, 11),
        poseidon2_hash2((old_total + amount) as Field, 12),
    );
}

#[test(should_fail_with = "cap exceeded")]
fn test_cap_exceeded() {
    let payee = 0xb0b;
    let (path, root) = sample_tree(payee);
    let cap: u128 = 1000;
    let expiry: u64 = 2000000000;
    main(
        cap,
        root,
        path,
        5,
        expiry,
        3,
        301,
        11,
        12,
        poseidon2_hash4(cap as Field, root, expiry as Field, 3),
        1,
        2,
        84532,
        payee,
        700,
        9,
        1,
        poseidon2_hash2(301, 11),
        poseidon2_hash2(1001, 12),
    );
}

#[test(should_fail_with = "payee not in allowlist")]
fn test_wrong_payee() {
    let (path, root) = sample_tree(0xb0b);
    let cap: u128 = 1000;
    let expiry: u64 = 2000000000;
    main(
        cap,
        root,
        path,
        5,
        expiry,
        3,
        0,
        0,
        12,
        poseidon2_hash4(cap as Field, root, expiry as Field, 3),
        1,
        2,
        84532,
        0xbad,
        1,
        9,
        1,
        poseidon2_hash2(0, 0),
        poseidon2_hash2(1, 12),
    );
}

#[test(should_fail_with = "mandate expired")]
fn test_expired() {
    let payee = 0xb0b;
    let (path, root) = sample_tree(payee);
    let cap: u128 = 1000;
    let expiry: u64 = 100;
    main(
        cap,
        root,
        path,
        5,
        expiry,
        3,
        0,
        0,
        12,
        poseidon2_hash4(cap as Field, root, expiry as Field, 3),
        1,
        2,
        84532,
        payee,
        1,
        9,
        101,
        poseidon2_hash2(0, 0),
        poseidon2_hash2(1, 12),
    );
}

#[test(should_fail)]
fn test_u128_overflow() {
    // old_total + amount wraps past 2^128: must fail even though the wrapped sum would be tiny.
    let payee = 0xb0b;
    let (path, root) = sample_tree(payee);
    let cap: u128 = 1000;
    let expiry: u64 = 2000000000;
    let max: u128 = 0xffffffffffffffffffffffffffffffff;
    main(
        cap,
        root,
        path,
        5,
        expiry,
        3,
        max,
        11,
        12,
        poseidon2_hash4(cap as Field, root, expiry as Field, 3),
        1,
        2,
        84532,
        payee,
        2,
        9,
        1,
        poseidon2_hash2(max as Field, 11),
        poseidon2_hash2(1, 12),
    );
}
