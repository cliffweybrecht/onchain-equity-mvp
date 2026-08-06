# Evidence Index — Phase 8.4.C

Index of chain-grounded proof artifacts for the canonical Phase 8.4.C deployment on Base Sepolia (chain ID 84532).

All evidence is in `contracts/evidence/phase-8.4.C/`. Every artifact references transaction hashes that can be independently verified via any Base Sepolia RPC endpoint.

For definitions of *canonical*, *chain-grounded*, *conservation invariant*, and *effective time*, see [`docs/TERMINOLOGY.md`](TERMINOLOGY.md).

---

## Canonical Stack

| Contract | Address |
|---|---|
| EquityToken | `0x73b8e67B2bCF9e482aF3b0dEC0548f0e84017c95` |
| VestingContract | `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` |
| IdentityRegistry | `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4` |
| Safe | `0x1eDc758579C66967C42066e8dDCB690a1651517e` |

---

## Case Status Summary

| Case | Claim | Status |
|---|---|---|
| Baseline | `release()` mints correct vested amount on a non-revoked grant | Proven |
| Case 1 | `revokeGrant` before cliff: `vested=0`, `claimable=0`, `canceled=total` | Proven |
| Case 2 | `revokeGrant` during vesting: linear formula, conservation invariant holds | Proven |
| Break Test A | `release → revokeGrant` in same MultiSend: revoke observes `g.released` written by release | Proven |
| Break Test B | `revokeGrant → release` in same MultiSend: `_effectiveTime` strict `>` allows release to see same vested amount | Proven |
| Case 3 | `revokeGrant` after full vesting: `vested=total`, `canceled=0` | Not executed |
| Case 4 | `release()` after revocation: claimable amount minted correctly | Not executed |
| Case 5 | Double `revokeGrant` reverts with `GrantAlreadyRevoked()` | Not executed |
| Case 6 | Non-admin `revokeGrant` reverts with `NotAdmin()` | Not executed |

Cases 3–6 have reserved directories under `contracts/evidence/phase-8.4.C/` but contain no artifacts as of the Phase 8.4.C canonical release commit (`5c2e293905748fdd325d4b860fddaaf99980200d`).

---

## Proven Cases

### Baseline — Mint-on-Claim Release

| Field | Value |
|---|---|
| Evidence directory | `contracts/evidence/phase-8.4.C/0-baseline-release-proof/` |
| Transaction hash | `0x865dbdc9c64ddc6b7850e1c9fd76a5e6c3affda32aa50e1232accf778bc95248` |
| Block | `39617596` |
| Key artifact | `release-verification-summary.json` |
| Claim proven | `release(employee)` on a non-revoked grant mints `vestedAmount − released` tokens directly to the beneficiary |

---

### Case 1 — Revoke Before Cliff

| Field | Value |
|---|---|
| Evidence directory | `contracts/evidence/phase-8.4.C/case-1-revoke-before-cliff/` |
| Transaction hash (createGrant) | `0xf2dfbf661641f16c5a81e7f199af289bbc1f67d24b0e4c6f010b4cd46a9ad19c` |
| Transaction hash (revokeGrant) | `0xeb0b879fd2e522a8d4331e553a663f592f94a3f75319f28b42578e036c4fc249` |
| Key artifact | `verification-summary.json` |
| Claim proven | `revokedAt < cliff` → `GrantRevoked` emits `vested=0, claimable=0, canceled=1000`; no tokens minted |
| Grant params | total=1000, cliff ~365 days after grant creation |

---

### Case 2 — Revoke During Vesting

| Field | Value |
|---|---|
| Evidence directory | `contracts/evidence/phase-8.4.C/case-2-revoke-during-vesting/` |
| Transaction hash (createGrant) | `0xa4f9a145903fee55e6b1e676cd66015d85a497a0b7b0b69f26305b7172ed0449` |
| Transaction hash (revokeGrant) | `0xa662b94fcfe94ed287717d30510bb5b4726e72f8148b52de8cb1e6544de046c0` |
| Transaction hash (setStatus) | `0xc685318b3583206ce78a3f7008a570351a56514acbb9fbbb18f0179fc4f1cf24` |
| Key artifact | `verification-summary.json` |
| Claim proven | `cliff ≤ revokedAt < end` → `vested=495`, `claimable=495`, `canceled=505`; conservation: `0+495+505=1000` |
| Formula | `floor(1000 × 15634776 / 31536000) = 495` |

---

### Break Test A — Atomic `release → revokeGrant`

| Field | Value |
|---|---|
| Evidence directory | `contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/` |
| Transaction hash (multiSend) | `0xd4dbf63ccf5fd1ed58849823dc24d73ddb736151bd1358b0a4b0fa14548f2d5d` |
| Key artifact | `verification-summary.json` |
| Claim proven | When `release` precedes `revokeGrant` in the same atomic MultiSend transaction, `revokeGrant` correctly reads `g.released` (written by `release`) via intra-transaction SLOAD. Conservation invariant holds. |
| Sub-call order | sc0: `release(address)` (selector `0x19165587`), sc1: `revokeGrant(address)` (selector `0x1817c5a7`) |

---

### Break Test B — Atomic `revokeGrant → release`

| Field | Value |
|---|---|
| Evidence directory | `contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/` |
| Transaction hash (multiSend) | `0xf391190e00b9d805220809428bf90907ab16d0004627702870ea6211ee711c41` |
| Block | `44849588` |
| Key artifact | `verification-summary.json` |
| Claim proven | When `revokeGrant` precedes `release` in the same atomic MultiSend, the `_effectiveTime` strict `>` condition evaluates `revokedAt > revokedAt = false`, so the cap does not apply. `release` computes the same `vested=821` as `revokeGrant` and mints 821 tokens. Conservation: `0+821+179=1000`. |
| Sub-call order | sc0: `revokeGrant(address)` (selector `0x1817c5a7`), sc1: `release(address)` (selector `0x19165587`) |

---

## Not-Yet-Executed Cases

The following cases are specified in `contracts/evidence/phase-8.4.C/case-specs.json` and have reserved evidence directories, but no artifacts have been produced.

| Case | Expected behavior |
|---|---|
| Case 3 — Revoke after full vesting | `revokedAt ≥ start + duration` → `vested=total`, `claimable=total−released`, `canceled=0` |
| Case 4 — Release after revocation | Separate `release()` call after revocation mints `claimable`; subsequent call reverts `NothingToRelease()` |
| Case 5 — Double revoke | Second `revokeGrant` on an already-revoked grant reverts `GrantAlreadyRevoked()` |
| Case 6 — Non-admin revoke | `revokeGrant` from a non-admin address reverts `NotAdmin()` |
