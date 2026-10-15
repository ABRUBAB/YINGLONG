"""yinglong-verify: the independent Python implementation of YINGLONG round-trip mandate verification.

It re-implements, without importing any YINGLONG TypeScript, the canonical mandate hash, the mandate
compiler's caveat bytes, the ERC-7710 delegation hash (MetaMask Delegation Framework v1.3.0 EncoderLib),
the decompiler's English sentences, the Hash Ring geometry, the accountability receipt EIP-712 hash and the
sorted-pair Merkle proofs, then checks them against what the ledgers actually hold.
"""

__version__ = "0.1.0"
