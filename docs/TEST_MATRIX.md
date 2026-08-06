# Test Matrix — Phase 8.4.C

> For claim-to-proof mapping see [`EVIDENCE_INDEX.md`](EVIDENCE_INDEX.md).
> For the trust model and design decisions see [`CANONICAL_SYSTEM.md`](CANONICAL_SYSTEM.md).

---

## Confidence Scale

| Level | Meaning |
|-------|---------|
| **High** | On-chain proof exists — transaction receipt, decoded events, pinned post-state reads on Base Sepolia |
| **Medium** | Local automated test exists and passes, or on-chain proof exists for a structurally equivalent case |
| **Low** | Source-code inference only — the behavior follows from reading the code but has not been executed or tested |
| **None** | No test, no on-chain proof, no confirmed inference — behavior is specified but entirely unverified |

**Source-code inference is not automated-test coverage.** A claim that passes source-code review is classified as Low, not Medium or High.

---

## Canonical Relevance Key

| Value | Meaning |
|-------|---------|
| **Canonical** | Tested against Phase 8.4.C deployed contracts (`EquityToken`, `VestingContract`, `IdentityRegistry`) |
| **Experiment** | Relevant only to a parallel experiment (e.g., EquityTokenV2 track) |
| **Both** | Relevant to both tracks |

---

## Matrix

### Identity

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| Set status 0→1 (verify) | `IdentityRegistry.setStatus` | None | None | Yes — embedded in Cases 2, Break-A, Break-B setup | [`case-2`](../contracts/evidence/phase-8.4.C/case-2-revoke-during-vesting/post-set-verified.json), [`break-A`](../contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/post-set-verified.json), [`break-B`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/post-set-verified.json) | None | High | Set status 1→2 (restrict); set status 2→0; non-admin setStatus revert | Canonical |
| `isVerified` returns true for status=1 | `IdentityRegistry.isVerified` | None | None | Yes — `isVerified_read` in post-set-verified artifacts | Same as above | None | High | isVerified for status=0; isVerified for status=2 | Canonical |
| Non-admin `setStatus` reverts | `IdentityRegistry.setStatus` (onlyAdmin) | None | None | No | — | None | Low (source inference) | Needs on-chain `eth_call` or tx proof | Canonical |
| Admin rotation (`setAdmin`) | `IdentityRegistry.setAdmin` | None | None | No | — | None | Low (source inference) | Zero-address guard; non-admin rotation revert | Canonical |

---

### Token — Minting

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| `mint` to verified address succeeds | `EquityToken.mint` (via `VestingContract.release`) | None | None | Yes | [`0-baseline`](../contracts/evidence/phase-8.4.C/0-baseline-release-proof/), all PROVEN cases | None | High | Direct mint call; mint to unverified (should revert) | Canonical |
| `mint` to unverified address reverts | `EquityToken.mint` | None | None | No | — | None | Low (source inference) | Needs dedicated proof | Canonical |
| `mint` from non-admin reverts | `EquityToken.mint` (onlyAdmin) | None | None | No | — | None | Low (source inference) | Any EOA calling `mint` directly | Canonical |
| Balance delta equals minted amount | `EquityToken.balanceOf` | None | None | Yes | All PROVEN cases — `beneficiary_balance_delta_eq_*` checks | None | High | — | Canonical |
| Total supply delta equals minted amount | `EquityToken.totalSupply` | None | None | Yes | All PROVEN cases — `totalSupply_delta_eq_*` checks | None | High | — | Canonical |

---

### Token — Transfer

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| Verified-to-verified transfer succeeds | `EquityToken.transfer` | None | None | No | — | None | Low (source inference) | Needs on-chain proof with two verified wallets | Canonical |
| Transfer from unverified sender reverts | `EquityToken.transfer` | None | None | No | — | None | Low (source inference) | — | Canonical |
| Transfer to unverified recipient reverts | `EquityToken.transfer` | None | None | No | — | None | Low (source inference) | — | Canonical |
| No `approve`/`allowance`/`transferFrom` | `EquityToken` ABI | None | None | Source confirmed | Source: `contracts/EquityToken.sol` | N/A | Low (source inference) | — | Canonical |

---

### Token — Burn

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| Admin burn succeeds without identity check | `EquityToken.burn` (onlyAdmin) | None | None | No | — | None | Low (source inference) | Dedicated burn tx; burn from restricted account | Canonical |
| Non-admin burn reverts | `EquityToken.burn` | None | None | No | — | None | Low (source inference) | — | Canonical |
| Supply decreases on burn | `EquityToken.totalSupply` | None | None | No | — | None | Low (source inference) | — | Canonical |

---

### Grant Creation

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| `createGrant` stores correct fields | `VestingContract.createGrant` | None | None | Yes | Multiple `post-create-grant.json` artifacts — `grants_read.decoded` matches event | None | High | — | Canonical |
| `GrantCreated` event emitted with correct params | `VestingContract.createGrant` | None | None | Yes | Same as above — `grant_created_log.decoded` | None | High | — | Canonical |
| Duplicate grant reverts `GrantAlreadyExists` | `VestingContract.createGrant` | None | None | No | — | None | Low (source inference) | Needs dedicated proof | Canonical |
| Non-admin `createGrant` reverts `NotAdmin` | `VestingContract.createGrant` | None | None | No | — | None | Low (source inference) | Needs dedicated proof | Canonical |
| `cliff >= start` validated | `VestingContract.createGrant` | None | None | No | — | None | Low (source inference) | — | Canonical |
| `cliff <= start + duration` NOT validated | `VestingContract.createGrant` | None | None | No | — | None | Low (source inference) | Known limitation — not enforced on-chain | Canonical |

---

### Vesting Calculation

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| Pre-cliff: `vestedAmount = 0` | `VestingContract._vestedAmountAt` | None | None | Yes (implied) | Case-1: revoked at `revokedAt < cliff`, `vested=0` | None | High | Direct `vestedAmount` call before cliff | Canonical |
| Linear vesting: `floor(total × elapsed / duration)` | `VestingContract._vestedAmountAt` | None | None | Yes | [`case-2`](../contracts/evidence/phase-8.4.C/case-2-revoke-during-vesting/verification-summary.json) — arithmetic verified; [`break-B`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/verification-summary.json) — formula proof | None | High | Multiple elapsed values | Canonical |
| Full vesting at `elapsed >= duration` | `VestingContract._vestedAmountAt` | None | None | No | Case-3 (not executed) | None | Low (source inference) | EV-09 — not yet executed | Canonical |
| Formula freeze after revocation | `VestingContract._effectiveTime` | None | None | Yes | Break-A, Break-B `vestedAmount_after_execution` checks | None | High | — | Canonical |
| `_effectiveTime` strict-`>` boundary | `VestingContract._effectiveTime` | None | None | Yes | [`break-test-B`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/verification-summary.json) — `effective_time_proof` | None | High | — | Canonical |

---

### Release

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| `release` mints vested amount to employee | `VestingContract.release` | None | None | Yes | [`0-baseline`](../contracts/evidence/phase-8.4.C/0-baseline-release-proof/), Break-B | None | High | — | Canonical |
| `release` reverts `NothingToRelease` when `unreleased=0` | `VestingContract.release` | None | None | Yes (eth_call) | [`break-test-B verification-summary`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/verification-summary.json) — `later_release_reverts_NothingToRelease` | None | High | — | Canonical |
| `release` reverts `NotVerified` for restricted employee | `VestingContract.release` | None | None | No | — | None | Low (source inference) | Needs dedicated proof | Canonical |
| `release` reverts `GrantDoesNotExist` for unknown address | `VestingContract.release` | None | None | No | — | None | Low (source inference) | Needs dedicated proof | Canonical |
| `release` may be called by any address | `VestingContract.release` (no modifier) | None | None | Yes (implied) | Break-A, Break-B — caller is not the employee in some runs | None | High | — | Canonical |
| `g.released` updated before `mint` (CEI order) | `VestingContract.release` | None | None | Yes (implied) | Break-A: `GrantRevoked.released = 497` after `release` ran in sub-call 0 | None | High | — | Canonical |

---

### Revocation

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| Revoke before cliff: `vested=0, canceled=total` | `VestingContract.revokeGrant` | None | None | Yes | [`case-1`](../contracts/evidence/phase-8.4.C/case-1-revoke-before-cliff/) | None | High | — | Canonical |
| Revoke during vesting: linear partial vest | `VestingContract.revokeGrant` | None | None | Yes | [`case-2`](../contracts/evidence/phase-8.4.C/case-2-revoke-during-vesting/) | None | High | — | Canonical |
| Revoke after full vesting: `vested=total, canceled=0` | `VestingContract.revokeGrant` | None | None | No | [`case-3`](../contracts/evidence/phase-8.4.C/case-3-revoke-after-full-vesting/) — empty | None | None | EV-09 — not yet executed | Canonical |
| Double revoke reverts `GrantAlreadyRevoked` | `VestingContract.revokeGrant` | None | None | No | [`case-5`](../contracts/evidence/phase-8.4.C/case-5-double-revoke/) — empty | None | None | EV-11 — not yet executed | Canonical |
| Non-admin revoke reverts `NotAdmin` | `VestingContract.revokeGrant` | None | None | No | [`case-6`](../contracts/evidence/phase-8.4.C/case-6-non-admin-revoke/) — empty | None | None | EV-12 — not yet executed | Canonical |
| Revoke on non-existent grant reverts `GrantDoesNotExist` | `VestingContract.revokeGrant` | None | None | No | — | None | Low (source inference) | — | Canonical |

---

### Atomic MultiSend Ordering

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| Ordering A: `release → revokeGrant` — `revokeGrant` sees updated `g.released` | `VestingContract.release`, `VestingContract.revokeGrant` | None | None | Yes | [`break-test-A`](../contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/) | None | High | — | Canonical |
| Ordering B: `revokeGrant → release` — `_effectiveTime` allows release to succeed | `VestingContract.revokeGrant`, `VestingContract.release`, `VestingContract._effectiveTime` | None | None | Yes | [`break-test-B`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/) | None | High | — | Canonical |
| Both orderings satisfy conservation invariant | Derived from `GrantRevoked` event fields | None | None | Yes | Both break-test directories | None | High | — | Canonical |

---

### Release After Revocation (Separate Transaction)

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| `release` in a later block (after revocation) mints frozen claimable amount | `VestingContract.release` | None | None | No | [`case-4`](../contracts/evidence/phase-8.4.C/case-4-release-after-revoke/) — empty | None | None | EV-10 — not yet executed | Canonical |

---

### Administration

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| `EquityToken.setAdmin` changes admin immediately | `EquityToken.setAdmin` | None | None | No | — | None | Low (source inference) | Zero-address guard; non-admin rotation revert | Canonical |
| `VestingContract.setAdmin` changes admin immediately | `VestingContract.setAdmin` | None | None | No | — | None | Low (source inference) | Zero-address guard; non-admin rotation revert | Canonical |
| Token admin is VestingContract on Phase 8.4.C stack | `EquityToken.admin` | None | None | Yes | [`new-stack-topology.json`](../contracts/evidence/phase-8.4.B.B/new-stack-topology.json) — `observed_token_admin` | None | High | — | Canonical |

---

### Supply and Issuance Limits

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| No on-chain grant issuance cap | `VestingContract.createGrant` | None | None | Yes (by absence) | Source: no cap check in `createGrant` | N/A | High | — | Canonical |
| No on-chain total supply cap | `EquityToken.mint` | None | None | Yes (by absence) | Source: no cap check in `mint` | N/A | High | — | Canonical |
| Supply overcommitment prevention | None — not enforced | None | None | No | — | None | None | Not in scope for Phase 8.4.C | Canonical |

---

### One-Grant-Per-Address Constraint

| Feature / Invariant | Canonical Contract / Function | Unit Test | Integration Test | On-Chain Proof | Evidence Directory | Negative Test | Confidence | Missing Cases | Canonical Relevance |
|---------------------|-------------------------------|-----------|-----------------|---------------|-------------------|---------------|-----------|---------------|-------------------|
| Second `createGrant` for same address reverts `GrantAlreadyExists` | `VestingContract.createGrant` | None | None | No | — | None | Low (source inference) | Needs dedicated proof | Canonical |

---

## Coverage Summary

| Category | High Confidence | Medium | Low | None |
|----------|----------------|--------|-----|------|
| Identity | 2 | 0 | 2 | 0 |
| Token — Mint | 3 | 0 | 2 | 0 |
| Token — Transfer | 0 | 0 | 4 | 0 |
| Token — Burn | 0 | 0 | 3 | 0 |
| Grant Creation | 2 | 0 | 4 | 0 |
| Vesting Calculation | 4 | 0 | 1 | 0 |
| Release | 4 | 0 | 2 | 0 |
| Revocation | 2 | 0 | 1 | 3 |
| Atomic Ordering | 3 | 0 | 0 | 0 |
| Release After Revocation (separate tx) | 0 | 0 | 0 | 1 |
| Administration | 1 | 0 | 2 | 0 |
| Supply / Issuance Limits | 2 | 0 | 0 | 1 |
| One-Grant Constraint | 0 | 0 | 1 | 0 |
| **Totals** | **23** | **0** | **22** | **5** |

The 23 High-confidence items are all backed by committed on-chain evidence. The 22 Low-confidence items are backed by source-code inference only. The 5 None items correspond to unexecuted cases (EV-09 through EV-12) and supply cap enforcement (not implemented).
