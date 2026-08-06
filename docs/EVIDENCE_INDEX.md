# Evidence Index — Phase 8.4.C

> This index maps Phase 8.4.C claims to on-chain evidence, evidence files, and reproduction status.
> For the full trust model see [`CANONICAL_SYSTEM.md`](CANONICAL_SYSTEM.md).
> For the test matrix see [`TEST_MATRIX.md`](TEST_MATRIX.md).

---

## Proof-Type Definitions

Claims in this repository are supported by one or more of the following evidence types. These are distinct and must not be conflated.

| Type | Definition |
|------|-----------|
| **On-chain proof** | A transaction receipt from Base Sepolia, pinned to a specific block, with decoded event logs and post-state reads. The data was observed from a live chain and is stored in a committed evidence JSON file. This is the strongest evidence type. |
| **Local automated test** | A test that runs locally in a simulated EVM (e.g., Hardhat EDR network) and passes deterministically. The test proves behavior in simulation, not on the deployed contracts. |
| **Source-code inference** | A claim derived from reading the contract source code without a corresponding automated test or on-chain observation. Subject to the assumption that the deployed bytecode matches the source (verified by CBOR comparison in Phase 8.4.B.B). |
| **Written specification** | A claim stated in a spec document (e.g., `case-specs.json`) that has not yet been executed or tested. The lowest confidence level. |

---

## Evidence Index

All paths are relative to the repository root. Transaction hashes and block numbers are taken directly from committed evidence files. `N/A` means the value does not apply. `not executed` means an evidence directory exists but contains no files. `not located` means no evidence file was found for this claim.

---

### EV-01 — Baseline Mint-on-Claim Release

| Field | Value |
|-------|-------|
| Claim | `release(employee)` on a non-revoked, fully-vested grant mints exactly the vested amount to the employee |
| Status | **Proven** |
| Contract / function | `VestingContract.release` → `EquityToken.mint` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/0-baseline-release-proof/`](../contracts/evidence/phase-8.4.C/0-baseline-release-proof/) |
| Transaction hash | `0x865dbdc9c64ddc6b7850e1c9fd76a5e6c3affda32aa50e1232accf778bc95248` |
| Block | `39617596` |
| Evidence files | `release-execution-summary.json`, `release-poststate.json`, `release-log-summary.json`, `release-verification-summary.json`, `release-verify.txt` |
| Builder script | Not located — this case predates the Phase 8.4.C builder conventions |
| Reproduction | Manual — RPC calls are recorded in `release-verification-summary.json` |
| Notes | Beneficiary: `0xd3eD697274ec8Bc9f638CE80fD789a49dA4aD996`. Grant: total=100, duration=60s, start=cliff. Token admin confirmed as VestingContract at block 39617342. |

---

### EV-02 — Revocation Before Cliff

| Field | Value |
|-------|-------|
| Claim | `revokeGrant` when `block.timestamp < cliff` produces `vested=0`, `claimable=0`, `canceled=total` |
| Status | **Proven** |
| Contract / function | `VestingContract.revokeGrant` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/case-1-revoke-before-cliff/`](../contracts/evidence/phase-8.4.C/case-1-revoke-before-cliff/) |
| Transaction hash (revokeGrant) | `0xeb0b879fd2e522a8d4331e553a663f592f94a3f75319f28b42578e036c4fc249` |
| Transaction hash (createGrant) | `0xf2dfbf661641f16c5a81e7f199af289bbc1f67d24b0e4c6f010b4cd46a9ad19c` |
| Evidence files | `case-config.json`, `execution-plan.md`, `post-create-grant.json`, `post-revoke-grant.json`, `prestate.json`, `safe-tx-1-create-grant.json`, `safe-tx-2-revoke-grant.json`, `verification-summary.json` |
| Builder script | `scripts/ops/phase-8.4.C/build-post-create-grant.mjs` (for `post-create-grant.json`) |
| Reproduction | Partial — `post-create-grant.json` is reproducible; `post-revoke-grant.json` has no builder |
| Notes | Beneficiary: `0x7d5A7b3061880c36D69127a4eB8293880b1eD90A`. Grant total=1000, cliff=2027-04-02 (365 days future). `revokedAt=1775098724`, `cliff=1806633636`. Margin before cliff: 365 days. `GrantRevoked` event: `vested=0, claimable=0, canceled=1000`. |

---

### EV-03 — Revocation During Vesting Window

| Field | Value |
|-------|-------|
| Claim | `revokeGrant` when `cliff <= block.timestamp < start + duration` produces linear vested amount, `claimable = vested − released`, `canceled = total − vested` |
| Status | **Proven** |
| Contract / function | `VestingContract.revokeGrant` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/case-2-revoke-during-vesting/`](../contracts/evidence/phase-8.4.C/case-2-revoke-during-vesting/) |
| Transaction hash (revokeGrant) | `0xa662b94fcfe94ed287717d30510bb5b4726e72f8148b52de8cb1e6544de046c0` |
| Transaction hash (createGrant) | `0xa4f9a145903fee55e6b1e676cd66015d85a497a0b7b0b69f26305b7172ed0449` |
| Transaction hash (setStatus) | `0xc685318b3583206ce78a3f7008a570351a56514acbb9fbbb18f0179fc4f1cf24` |
| Evidence files | `case-config.json`, `execution-plan.md`, `post-create-grant.json`, `post-revoke-grant.json`, `post-set-verified.json`, `prestate.json`, `safe-tx-*.json`, `verification-summary.json` |
| Builder script | `scripts/ops/phase-8.4.C/build-post-create-grant.mjs`, `scripts/ops/phase-8.4.C/build-post-set-verified.mjs` |
| Reproduction | Partial — two artifacts are reproducible; `post-revoke-grant.json` has no builder |
| Notes | Beneficiary: `0x1A0E8fC547DC74d4caEcC506dc605534846B6A06`. Grant total=1000, 365-day vesting. Formula: `floor(1000 × 15634776 / 31536000) = 495`. `GrantRevoked` event: `vested=495, claimable=495, canceled=505`. |

---

### EV-04 — Atomic `release → revokeGrant` (Break Test A)

| Field | Value |
|-------|-------|
| Claim | When `release` precedes `revokeGrant` atomically in the same Safe MultiSend batch, `revokeGrant` reads the `g.released` value written by `release` in the same transaction (EVM intra-transaction SSTORE/SLOAD visibility) |
| Status | **Proven** |
| Contract / function | `VestingContract.release`, `VestingContract.revokeGrant` in single `execTransaction` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/`](../contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/) |
| Transaction hash (multiSend) | `0xd4dbf63ccf5fd1ed58849823dc24d73ddb736151bd1358b0a4b0fa14548f2d5d` |
| Block | `39730618` |
| Evidence files | `case-config.json`, `execution-plan.md`, `multisend-encoding-proof.json`, `post-create-grant.json`, `post-multisend.json`, `post-set-verified.json`, `prestate.json`, `safe-tx-*.json`, `verification-summary.json` |
| Builder script | `scripts/ops/phase-8.4.C/build-post-create-grant.mjs`, `scripts/ops/phase-8.4.C/build-post-set-verified.mjs`. `post-multisend.json` and `verification-summary.json` have no builder (`build-post-multisend.mjs` missing). |
| Reproduction | Partial |
| Notes | Beneficiary: `0xd3eD697274ec8Bc9f638CE80fD789a49dA4aD996`. Sub-call 0: `release(address)` (selector `0x19165587`). Sub-call 1: `revokeGrant(address)` (selector `0x1817c5a7`). `GrantReleased` (log 87) < `GrantRevoked` (log 91). `GrantRevoked.released = 497` (non-zero, written by sub-call 0). Conservation: `497 + 0 + 503 = 1000`. |

---

### EV-05 — Atomic `revokeGrant → release` (Break Test B)

| Field | Value |
|-------|-------|
| Claim | When `revokeGrant` precedes `release` atomically in the same Safe MultiSend batch, `_effectiveTime`'s strict-`>` boundary (`queryTime > g.revokedAt`) evaluates false when `queryTime == g.revokedAt`, so `release` computes the same vested amount and succeeds |
| Status | **Proven** |
| Contract / function | `VestingContract.revokeGrant`, `VestingContract.release`, `VestingContract._effectiveTime` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/) |
| Transaction hash (multiSend) | `0xf391190e00b9d805220809428bf90907ab16d0004627702870ea6211ee711c41` |
| Block | `44849588` |
| Evidence files | `case-config.json`, `execution-plan.md`, `multisend-encoding-proof.json`, `post-create-grant.json`, `post-multisend.json`, `post-set-verified.json`, `prestate.json`, `safe-tx-*.json`, `verification-summary.json` |
| Builder script | Same partial availability as Break Test A. `build-post-multisend.mjs` missing. |
| Reproduction | Partial |
| Notes | Beneficiary: `0x2237d846D3EE2Baf268FF2a91C5971F5E594E1B1`. Sub-call 0: `revokeGrant(address)` (log index 87). Sub-call 1: `release(address)` (log index 90). `GrantRevoked.released = 0` (release had not run yet). Both computed `vested = 821`. Conservation: `0 + 821 + 179 = 1000`. Subsequent `release()` reverts `NothingToRelease()` (selector `0xb10205ed`). |

---

### EV-06 — Conservation Invariant

| Field | Value |
|-------|-------|
| Claim | For every revocation: `released_before + claimable + canceled = total` |
| Status | **Proven** (for Cases 1, 2, Break A, Break B) |
| Contract / function | Derived from `GrantRevoked` event fields |
| Evidence directory | Multiple — see cases above |
| Transaction hashes | See EV-02 through EV-05 |
| Evidence files | `verification-summary.json` in each case directory |
| Notes | Case 1: `0 + 0 + 1000 = 1000`. Case 2: `0 + 495 + 505 = 1000`. Break-A: `497 + 0 + 503 = 1000`. Break-B: `0 + 821 + 179 = 1000`. All four pass. Case 3 (full vesting) not yet executed. |

---

### EV-07 — Vesting Formula Freeze After Revocation

| Field | Value |
|-------|-------|
| Claim | `vestedAmount(employee)` returns the identical value at the revocation block and at any later block |
| Status | **Proven** |
| Contract / function | `VestingContract.vestedAmount`, `VestingContract._effectiveTime` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/`](../contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/) and [`contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/) |
| Transaction hashes | Break-A: `0xd4dbf63c…`, Break-B: `0xf391190e…` |
| Evidence files | `verification-summary.json` → `checks.vestedAmount_after_execution_eq_*` |
| Notes | Break-A: `vestedAmount` at tx block = 497, at latest = 497. Break-B: `vestedAmount` at tx block = 821, at latest = 821. The `_effectiveTime` cap freezes the formula permanently at `revokedAt`. |

---

### EV-08 — Later `release()` Reverts `NothingToRelease`

| Field | Value |
|-------|-------|
| Claim | After a grant is fully released (released = vested), a subsequent call to `release(employee)` reverts with `NothingToRelease()` |
| Status | **Proven** |
| Contract / function | `VestingContract.release` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/) |
| Transaction hash | N/A — demonstrated via `eth_call` at latest block (no on-chain tx needed) |
| Evidence files | `verification-summary.json` → `checks.later_release_reverts_NothingToRelease` |
| Notes | `eth_call` result: `REVERTS`. Revert data: `0xb10205ed` = `keccak256("NothingToRelease()")[0:4]`. Confirmed in `selector-proof.json`. |

---

### EV-09 — Revocation After Full Vesting

| Field | Value |
|-------|-------|
| Claim | `revokeGrant` when `block.timestamp >= start + duration` produces `vested = total`, `canceled = 0` |
| Status | **Specified only** |
| Contract / function | `VestingContract.revokeGrant` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/case-3-revoke-after-full-vesting/`](../contracts/evidence/phase-8.4.C/case-3-revoke-after-full-vesting/) — empty |
| Transaction hash | not executed |
| Evidence files | None committed |
| Builder script | None |
| Reproduction | Not achievable from current scripts |
| Notes | Specified in `case-specs.json`. Source-code inference: when `elapsed >= duration`, `_vestedAmountAt` returns `g.total`; therefore `canceled = 0`. Not proven on-chain. |

---

### EV-10 — Release After Revocation (Separate Transaction)

| Field | Value |
|-------|-------|
| Claim | `release(employee)` in a separate, later transaction (not same block as revocation) successfully mints the frozen claimable amount |
| Status | **Specified only** |
| Contract / function | `VestingContract.release` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/case-4-release-after-revoke/`](../contracts/evidence/phase-8.4.C/case-4-release-after-revoke/) — empty |
| Transaction hash | not executed |
| Evidence files | None committed |
| Builder script | None |
| Reproduction | Not achievable from current scripts |
| Notes | Specified in `case-specs.json`. The Break Tests (EV-04, EV-05) prove release in the same block as revocation. This case proves a later-block release — distinct because `block.timestamp` differs. Source-code inference supports success: `_effectiveTime` caps correctly, `g.released < vested` at time of revocation. |

---

### EV-11 — Double Revocation Reverts

| Field | Value |
|-------|-------|
| Claim | A second call to `revokeGrant(employee)` on an already-revoked grant reverts with `GrantAlreadyRevoked()` |
| Status | **Specified only** |
| Contract / function | `VestingContract.revokeGrant` |
| Evidence directory | [`contracts/evidence/phase-8.4.C/case-5-double-revoke/`](../contracts/evidence/phase-8.4.C/case-5-double-revoke/) — empty |
| Transaction hash | not executed |
| Evidence files | None committed |
| Builder script | None |
| Reproduction | Not achievable from current scripts |
| Notes | Specified in `case-specs.json`. Source-code inference: `if (g.revoked) revert GrantAlreadyRevoked()` is the second check in `revokeGrant`. Selector: `keccak256("GrantAlreadyRevoked()")[0:4]` — not yet confirmed by `eth_call`. |

---

### EV-12 — Non-Admin Revocation Reverts

| Field | Value |
|-------|-------|
| Claim | `revokeGrant(employee)` called from any address other than `VestingContract.admin` reverts with `NotAdmin()` |
| Status | **Specified only** |
| Contract / function | `VestingContract.revokeGrant` (onlyAdmin modifier) |
| Evidence directory | [`contracts/evidence/phase-8.4.C/case-6-non-admin-revoke/`](../contracts/evidence/phase-8.4.C/case-6-non-admin-revoke/) — empty |
| Transaction hash | not executed |
| Evidence files | None committed |
| Builder script | None |
| Reproduction | Not achievable from current scripts |
| Notes | Specified in `case-specs.json`. Could be demonstrated by `eth_call` without a funded grant. Source-code inference: `onlyAdmin` modifier reverts `NotAdmin()` if `msg.sender != admin`. |

---

## Summary Table

| ID | Claim | Proof Type | Status |
|----|-------|-----------|--------|
| EV-01 | Baseline mint-on-claim | On-chain proof | **Proven** |
| EV-02 | Revoke before cliff | On-chain proof | **Proven** |
| EV-03 | Revoke during vesting | On-chain proof | **Proven** |
| EV-04 | Atomic release → revokeGrant | On-chain proof | **Proven** |
| EV-05 | Atomic revokeGrant → release | On-chain proof | **Proven** |
| EV-06 | Conservation invariant | On-chain proof (derived) | **Proven** (4 of 8 cases) |
| EV-07 | Vesting formula freeze | On-chain proof | **Proven** |
| EV-08 | Later release reverts NothingToRelease | On-chain proof (eth_call) | **Proven** |
| EV-09 | Revoke after full vesting | Specified only | Not executed |
| EV-10 | Release after revoke (separate tx) | Specified only | Not executed |
| EV-11 | Double revoke reverts | Specified only | Not executed |
| EV-12 | Non-admin revoke reverts | Specified only | Not executed |
