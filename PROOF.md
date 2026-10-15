# PROOF

Generated at 2026-10-15T23:30:00.607Z (commit `1da0e0e`). Test units only; no monetary value.

| What it proves | Ledger | Transaction |
|---|---|---|
| Mandate sealed and published with its full caveat array (fisco) | fisco | `0xc0e294dd54638c004a05d34e17f4df802f22af4e0e1e5ecc34c0dfbf0d2d4bc9` |
| Allowed payment inside the mandate (T1) | - | not yet recorded |
| Payment approved on the user's passkey (T2) | FISCO BCOS (team-run consortium ledger) | [`0x4a6d4c185b...`](https://app.yinglong-agent.tech/proof/tx/fisco/0x4a6d4c185be114a6208ae6048828b2c13e52fd9061189609d7033c46f93bc8d8) |
| Attack reverted on-chain: PayeeNotVerified | FISCO BCOS (team-run consortium ledger) | [`0xf95e545d34...`](https://app.yinglong-agent.tech/proof/tx/fisco/0xf95e545d34e041df9f568e23749bdc8d52649db52cf989985a3baaa1e9f63546) |
| Board resolution executed by 2 of 3 directors (T3) | FISCO BCOS (team-run consortium ledger) | [`0x50ac49e1c7...`](https://app.yinglong-agent.tech/proof/tx/fisco/0x50ac49e1c7447286d3214932a9d8b707d1839f63dbfd300be021c845ad910eea) |
| One-tap pause signed by the principal and relayed (T3) | FISCO BCOS (team-run consortium ledger) | [`0xf8351130e3...`](https://app.yinglong-agent.tech/proof/tx/fisco/0xf8351130e374ac7f05c0c7f17d55ce35b4d906984c5eb838edb3f026e06473cd) |
| Velocity breach trips the circuit breaker | - | not yet recorded |
| Company payment on the coin-free rail (FISCO) | FISCO BCOS (team-run consortium ledger) | [`0x4a6d4c185b...`](https://app.yinglong-agent.tech/proof/tx/fisco/0x4a6d4c185be114a6208ae6048828b2c13e52fd9061189609d7033c46f93bc8d8) |
| Private mandate: payment verified by a zero-knowledge proof at redemption (hidden cap and payees) | FISCO BCOS (team-run consortium ledger) | [`0xab553f9cb9...`](https://api.yinglong-agent.tech/v1/tx/fisco/0xab553f9cb9ba3b3652d954104c5b784d93f2cbca77e39bce9d912a9e1bac6d0f) |
| Private mandate: forged proof reverts InvalidMandateProof() | FISCO BCOS (team-run consortium ledger) | [`0x119f8389e9...`](https://api.yinglong-agent.tech/v1/tx/fisco/0x119f8389e965ecdfda9b90bfc621d71697bbb20746e41565aa1800c4dd9ce19e) |
| Private mandate: replayed proof reverts NonceAlreadyUsed(2) | FISCO BCOS (team-run consortium ledger) | [`0x96374ae5fc...`](https://api.yinglong-agent.tech/v1/tx/fisco/0x96374ae5fc4768a4bc4f5f15b3299c43038f63f5d84e6a0278c9575c1ffc75c3) |
| One-tap pause, passkey signature relayed (fisco) | fisco | `0x0a95302cffbd30984e70ee998c83c47dc8279350f0186720e9ce470dce958a9d` |

Verify any mandate yourself (Python, independent of our TypeScript):

```bash
uvx --from 'git+https://github.com/ABRUBAB/YINGLONG#subdirectory=tools/verify-py' yinglong verify nadia --chain anvil --offline
```

Judge's Challenge: https://app.yinglong-agent.tech/challenge
