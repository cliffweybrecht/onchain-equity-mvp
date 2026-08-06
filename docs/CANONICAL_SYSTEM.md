# Canonical System — Phase 8.4.C

> **Related documents:**
> [`ARCHITECTURE.md`](ARCHITECTURE.md) — contract diagrams and lifecycle flows
> [`EVIDENCE_INDEX.md`](EVIDENCE_INDEX.md) — claim-to-proof index
> [`TEST_MATRIX.md`](TEST_MATRIX.md) — test and coverage matrix
> [`REPOSITORY_PHILOSOPHY.md`](REPOSITORY_PHILOSOPHY.md) — governance and classification model

---

## 1. Purpose and Scope

Phase 8.4.C proves the revocation semantics of a deployed, identity-gated vesting system on Base Sepolia operating under Safe multisig governance. The phase demonstrates that `VestingContract.revokeGrant` and `VestingContract.release` satisfy a conservation invariant — `released_before + claimable + canceled = total` — across five distinct on-chain execution scenarios: a pre-cliff revocation, a mid-vesting revocation, and two atomic ordering variants of `revokeGrant`/`release` composed inside a Safe MultiSend batch, plus a baseline mint-on-claim release proof carried forward from the migration.

A critical behavioral boundary is proven: the `_effectiveTime` function uses a strict greater-than comparison (`queryTime > g.revokedAt`). When `release` follows `revokeGrant` in the same transaction, `queryTime == g.revokedAt`, so the cap does not apply, and both sub-calls compute the same vested amount. This enables `release` to succeed within the same atomic transaction as `revokeGrant`.

Phase 8.4.C does not claim production readiness, legal compliance, or general-purpose equity infrastructure. See [§10 Repository Boundaries](#10-repository-boundaries).

---

## 2. Release Definition

| Field | Value |
|-------|-------|
| Release name | Phase 8.4.C |
| Source commit | `5c2e293905748fdd325d4b860fddaaf99980200d` |
| Network | Base Sepolia |
| Chain ID | `84532` |
| Release status | Complete — 5 of 8 specified cases proven on-chain; 3 cases specified, not yet executed |
| Scope | Revocation semantics, conservation invariant, `_effectiveTime` boundary, atomic MultiSend ordering |
| Out of scope | Production deployment, formal audit, cases 3–6 execution, policy delegation stack |

---

## 3. Canonical Contracts

All addresses verified against `contracts/evidence/phase-8.4.C/case-specs.json` and `contracts/evidence/phase-8.4.B.B/new-stack-topology.json`.

### IdentityRegistry

| Field | Value |
|-------|-------|
| Source | `contracts/IdentityRegistry.sol` |
| Deployed address | `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4` |
| Administrator | Safe `0x1eDc758579C66967C42066e8dDCB690a1651517e` |
| Role | Maintains verified/unverified/restricted status for all participant wallets |
| Basescan verified | No |

### EquityToken

| Field | Value |
|-------|-------|
| Source | `contracts/EquityToken.sol` |
| Deployed address | `0x73b8e67B2bCF9e482aF3b0dEC0548f0e84017c95` |
| Administrator | VestingContract `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` |
| Role | Non-standard restricted token; mint-on-claim via VestingContract; identity-gated transfer |
| Basescan verified | No |

`observed_token_admin = 0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` — confirmed in `contracts/evidence/phase-8.4.B.B/new-stack-topology.json`.

### VestingContract

| Field | Value |
|-------|-------|
| Source | `contracts/VestingContract.sol` |
| Deployed address | `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` |
| Administrator | Safe `0x1eDc758579C66967C42066e8dDCB690a1651517e` |
| Role | Creates and manages vesting grants; calls `EquityToken.mint` on release |
| Basescan verified | No |

`observed_vesting_admin = 0x1eDc758579C66967C42066e8dDCB690a1651517e` — confirmed in `contracts/evidence/phase-8.4.B.B/new-stack-topology.json`.

### Safe Governance

| Field | Value |
|-------|-------|
| Safe address | `0x1eDc758579C66967C42066e8dDCB690a1651517e` |
| Safe version | 1.4.1 |
| Threshold | 1-of-1 |
| Owner EOA | `0x6C775411e11cAb752Af03C5BBb440618788E13Be` |

Confirmed in `contracts/evidence/phase-8.4.C/safe-payload-proof.json` and `contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/post-set-verified.json`.

### MultiSend Execution Infrastructure

| Field | Value |
|-------|-------|
| Contract | MultiSendCallOnly v1.4.1 |
| Address | `0x9641d764fc13c8B624c04430C7356C1C7C8102e2` |
| Role | Executes atomic batches of `CALL` sub-transactions within Safe execTransaction |
| DELEGATECALL opcode | Absent — confirmed by bytecode inspection (`0xf4` not present) |

Confirmed in `contracts/evidence/phase-8.4.C/safe-payload-proof.json`.

---

## 4. Canonical Execution Model

### Identity Status Model

`IdentityRegistry` stores a `uint8` status per address:

| Status | Meaning |
|--------|---------|
| `0` | Unverified — default |
| `1` | Verified — eligible for minting and transfer |
| `2` | Restricted / Terminated — not eligible |

`isVerified(address)` returns `true` if and only if `_status[address] == 1`. Only the Safe can call `setStatus`.

### Token Behavior

`EquityToken` enforces identity on three operations:

- **`mint(address to, uint256 amount)`** — requires `isVerified(to)`. Called only by VestingContract (the token admin). Emits `Mint` and `Transfer(address(0), to, amount)`.
- **`transfer(address to, uint256 amount)`** — requires `isVerified(msg.sender)` AND `isVerified(to)`. No `approve`/`allowance`/`transferFrom` surface exists.
- **`burn(address from, uint256 amount)`** — admin-only. Does not check `isVerified(from)`. Intended for forfeitures of restricted accounts.

The token does not use a modular transfer-policy interface. Identity enforcement is embedded directly in `EquityToken.sol` via calls to `IdentityRegistry`. `EquityTokenV2`, `ITransferPolicy`, and the `CompositePolicy` stack are parallel experiments not connected to this deployment.

### Mint-on-Claim Vesting

VestingContract does not hold a pre-funded balance. When `release(employee)` is called successfully, it calls `token.mint(employee, unreleased)` directly. Tokens come into existence at claim time. Confirmed in `contracts/evidence/phase-8.4.C/0-baseline-release-proof/`.

### Grant Lifecycle

A grant is created by the Safe calling `createGrant(employee, total, start, cliff, duration)`. Each address can hold at most one grant (`GrantAlreadyExists` reverts on duplicate). Grants are irreversible once created; there is no amendment function.

Linear vesting formula: `floor(total × elapsed / duration)`, where `elapsed = effectiveTime - start`, capped at `duration`.

Nothing vests before the cliff date: if `effectiveTime < cliff`, vested = 0.

### Revocation Behavior

`revokeGrant(employee)` is `onlyAdmin` (Safe only). It:

1. Reads `block.timestamp` as `revocationTime`.
2. Computes `vested = _vestedAmountAt(grant, revocationTime)`.
3. Sets `grant.revoked = true` and `grant.revokedAt = revocationTime`.
4. Emits `GrantRevoked(employee, revokedAt, total, released, vested, claimable, canceled)`.

### Frozen Vesting After Revocation

`_effectiveTime(g, queryTime)` applies a cap: if `g.revoked && queryTime > g.revokedAt`, it returns `g.revokedAt` instead of `queryTime`. Any call to `vestedAmount(employee)` after revocation returns the same frozen value for all future block timestamps.

### `_effectiveTime` Strict-Greater-Than Boundary

When `release` and `revokeGrant` execute in the same block (same `block.timestamp = T`):

- After `revokeGrant` sets `g.revokedAt = T`, a subsequent `release` in the same transaction calls `_effectiveTime(g, T)`.
- Condition: `g.revoked && T > T` = `true && false` = `false`.
- The cap does not apply. `_effectiveTime` returns `T`.
- `release` computes the same vested amount as `revokeGrant` and succeeds.

This behavior is proven in `contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/`.

### Administration

All administrative actions require the Safe owner EOA to sign and submit an `execTransaction`. This includes:

- `IdentityRegistry.setStatus` — verify or restrict any wallet
- `VestingContract.createGrant` — create new grants
- `VestingContract.revokeGrant` — cancel future vesting
- `EquityToken.setAdmin` — change the token's admin (currently VestingContract)
- `VestingContract.setAdmin` — change the vesting admin (currently Safe)
- `IdentityRegistry.setAdmin` — change the registry admin (currently Safe)

### Permissionless `release()`

`VestingContract.release(address employee)` has no caller restriction. Any address may call it for any employee. The employee receives only their vested-but-unreleased tokens. The caller gains nothing directly but controls the timing of the employee's token receipt.

---

## 5. Canonical vs Non-Canonical

### Canonical (Phase 8.4.C)

| Component | Kind |
|-----------|------|
| `contracts/IdentityRegistry.sol` | Contract source |
| `contracts/EquityToken.sol` | Contract source |
| `contracts/VestingContract.sol` | Contract source |
| `contracts/evidence/phase-8.4.C/` | On-chain evidence |
| `scripts/ops/phase-8.4.C/build-post-set-verified.mjs` | Evidence builder |
| `scripts/ops/phase-8.4.C/build-post-create-grant.mjs` | Evidence builder |
| `scripts/ops/grants/find-verified-fresh-beneficiary-v2.mjs` | Operational script |
| `scripts/ops/grants/build-identity-prestate.mjs` | Operational script |
| `scripts/ops/grants/verify-identity-poststate.mjs` | Operational script |

### Active Parallel Experiments

These components represent active research but are not deployed in Phase 8.4.C.

| Component | Purpose |
|-----------|---------|
| `contracts/EquityTokenV2.sol` | Token design with externally composable transfer policy |
| `contracts/policy/ITransferPolicy.sol` | Interface for the policy delegation model |
| `contracts/policy/CompositePolicy.sol`, `V11`, `V111` | Policy aggregation via AND logic |
| `contracts/policy/ComplianceGatedPolicyV1.sol` | Identity-gated policy implementation |
| `contracts/policy/MinAmountPolicyV1.sol` | Minimum transfer amount policy |
| `contracts/policies/EmergencyFreezePolicyV2.sol` | System-wide freeze policy (correct interface) |
| `contracts/audit/TransparencyLogAnchor.sol` | On-chain log-root anchoring |
| `test/governance.selftest.test.js` | Part 5.2 governance test for EquityTokenV2 track |

### Legacy — Retained for Historical Reference

| Component | Reason |
|-----------|--------|
| Phase 8.4.B.A `EquityToken` (`0x2791D08f...`) | Immediately preceding deployment; may hold historical state |
| Phase 8.4.B.A `VestingContract` (`0xf87776c5...`) | Same; recorded in `deployments/base-sepolia.json` |
| `VestingContract_legacy` (`0xEf444C53...`) | Pre-revocation contract; may hold historical grants |
| `archived-tests/` | Superseded Hardhat 2 / Ethers.js governance tests |
| Phase 3–8.4.B evidence in `contracts/evidence/` | Append-only historical audit record |
| `docs/vesting-invariants.md` | References Phase 6.2; documents design intent from that phase |

### Deprecated — Must Not Be Used or Deployed

| Component | Reason |
|-----------|--------|
| `contracts/policies/EmergencyFreezePolicyV1.sol` | Implements `checkTransfer()` instead of `canTransfer()`. Incompatible with `ITransferPolicy`. Any registration in `CompositePolicy` will silently fail. Use `EmergencyFreezePolicyV2` instead. |

### Deployment Manifest — Currently Stale

`deployments/base-sepolia.json` records Phase 8.4.B.A addresses and must not be treated as the canonical address source for Phase 8.4.C. The canonical addresses are in `contracts/evidence/phase-8.4.C/case-specs.json`.

### Unclear

| Component | Status |
|-----------|--------|
| `TransparencyLogAnchor` deployed address | No confirmed address appears in Phase 8.4.C evidence. Phase 7 evidence references anchoring operations, but no 8.4.C anchor transaction has been identified. |

---

## 6. Trust Assumptions

### Who can update identity status

Only the Safe can call `IdentityRegistry.setStatus`. All identity operations in Phase 8.4.C were submitted as `execTransaction` from the Safe owner EOA `0x6C775411e11cAb752Af03C5BBb440618788E13Be`.

### Who can create grants

Only the Safe can call `VestingContract.createGrant`. The Safe is the `VestingContract.admin`.

### Who can revoke grants

Only the Safe can call `VestingContract.revokeGrant`. Revocation is irreversible.

### Who can mint

Only `VestingContract` can call `EquityToken.mint`. VestingContract is the `EquityToken.admin`. Minting occurs only through `release(employee)`. There is no direct minting path from the Safe or from any EOA.

Minting additionally requires that `identityRegistry.isVerified(employee)` returns `true` at the time of the `release` call.

### Who controls the Safe

The Safe has a 1-of-1 threshold. The single owner is `0x6C775411e11cAb752Af03C5BBb440618788E13Be`. Any transaction this EOA signs is valid for Safe execution with no second approval.

### Actions dependent on one privileged key

All administrative actions depend exclusively on the Safe owner EOA. Compromise of that key enables:

- Creation of fraudulent grants for any address
- Revocation of any valid grant
- Setting any address to any identity status
- Rotation of the admin for any of the three contracts to an attacker-controlled address
- Burning tokens from any holder

### On-chain enforcement vs operational trust

| Behavior | Enforcement |
|----------|-------------|
| Only Safe can call `revokeGrant` | On-chain (`onlyAdmin` modifier) |
| Only Safe can call `createGrant` | On-chain (`onlyAdmin` modifier) |
| Only VestingContract can mint | On-chain (`onlyAdmin` modifier on `EquityToken.mint`) |
| Token transfers require verified status | On-chain (embedded `isVerified` check) |
| `release()` may be called by anyone | On-chain (no modifier) |
| Safe owner will not act maliciously | Operationally trusted only — not enforced |
| Safe will not exceed grant commitment | Operationally trusted only — no on-chain supply cap |
| Identity status reflects actual KYC | Operationally trusted only — registry admin controls all status |

---

## 7. Proven Behaviors

All behaviors below are backed by committed on-chain evidence from Base Sepolia (chain ID 84532). Evidence paths are relative to the repository root.

### P1 — Baseline mint-on-claim

`release(employee)` on a non-revoked, fully-vested grant mints exactly the vested amount to the employee.

- Transaction: `0x865dbdc9c64ddc6b7850e1c9fd76a5e6c3affda32aa50e1232accf778bc95248`
- Balance delta: +100 tokens. Supply delta: +100.
- Evidence: [`contracts/evidence/phase-8.4.C/0-baseline-release-proof/`](../contracts/evidence/phase-8.4.C/0-baseline-release-proof/)

### P2 — Revocation before cliff

`revokeGrant` called when `block.timestamp < cliff` produces `vested = 0`, `claimable = 0`, `canceled = total`.

- Transaction (revokeGrant): `0xeb0b879fd2e522a8d4331e553a663f592f94a3f75319f28b42578e036c4fc249`
- `revokedAt = 1775098724`, `cliff = 1806633636`; margin before cliff: 365 days.
- Evidence: [`contracts/evidence/phase-8.4.C/case-1-revoke-before-cliff/`](../contracts/evidence/phase-8.4.C/case-1-revoke-before-cliff/)

### P3 — Revocation during vesting window

`revokeGrant` called when `cliff <= block.timestamp < start + duration` produces a linearly-computed vested amount.

- Transaction (revokeGrant): `0xa662b94fcfe94ed287717d30510bb5b4726e72f8148b52de8cb1e6544de046c0`
- `floor(1000 × 15634776 / 31536000) = 495`. `claimable = 495`, `canceled = 505`.
- Evidence: [`contracts/evidence/phase-8.4.C/case-2-revoke-during-vesting/`](../contracts/evidence/phase-8.4.C/case-2-revoke-during-vesting/)

### P4 — Atomic `release → revokeGrant` ordering (Break Test A)

When `release` precedes `revokeGrant` in the same Safe MultiSend batch, `revokeGrant` reads the `g.released` value written by `release` in the same transaction (EVM intra-transaction SSTORE/SLOAD visibility).

- MultiSend transaction: `0xd4dbf63ccf5fd1ed58849823dc24d73ddb736151bd1358b0a4b0fa14548f2d5d`
- `GrantRevoked.released = 497` (non-zero, reflects prior `release` write).
- Conservation: `497 + 0 + 503 = 1000`.
- Evidence: [`contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/`](../contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/)

### P5 — Atomic `revokeGrant → release` ordering (Break Test B)

When `revokeGrant` precedes `release` in the same Safe MultiSend batch, `_effectiveTime`'s strict-`>` boundary allows `release` to compute the same vested amount and succeed.

- MultiSend transaction: `0xf391190e00b9d805220809428bf90907ab16d0004627702870ea6211ee711c41`
- Both sub-calls computed `vested = 821`. Conservation: `0 + 821 + 179 = 1000`.
- Subsequent `release()` reverts `NothingToRelease()` (selector `0xb10205ed`).
- Evidence: [`contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/)

### P6 — Vesting formula freeze after revocation

`vestedAmount(employee)` returns the same value at any block after revocation because `_effectiveTime` caps `queryTime` at `g.revokedAt`.

- Confirmed in both break-test evidence packages: `at_tx_block` and `at_latest` values are identical.
- Evidence: [`contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/`](../contracts/evidence/phase-8.4.C/break-test-A-release-then-revoke/) and [`contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/`](../contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/)

---

## 8. Unproven Behaviors

The following behaviors are specified in `contracts/evidence/phase-8.4.C/case-specs.json` but have empty evidence directories. Their outcome is inferred from the source code only.

| Case | Specification | Evidence Directory | Status |
|------|-------------|-------------------|--------|
| Case 3 | Revoke after full vesting → `vested = total`, `canceled = 0` | [`case-3-revoke-after-full-vesting/`](../contracts/evidence/phase-8.4.C/case-3-revoke-after-full-vesting/) | Not executed |
| Case 4 | Release claimable amount in a separate transaction after revocation | [`case-4-release-after-revoke/`](../contracts/evidence/phase-8.4.C/case-4-release-after-revoke/) | Not executed |
| Case 5 | Second `revokeGrant` on already-revoked grant reverts `GrantAlreadyRevoked()` | [`case-5-double-revoke/`](../contracts/evidence/phase-8.4.C/case-5-double-revoke/) | Not executed |
| Case 6 | `revokeGrant` from non-admin EOA reverts `NotAdmin()` | [`case-6-non-admin-revoke/`](../contracts/evidence/phase-8.4.C/case-6-non-admin-revoke/) | Not executed |
| — | `release()` on a restricted employee (status=2) reverts `NotVerified()` | — | Source-code inference only |
| — | `burn()` succeeds on a restricted account without identity check | — | Source-code inference only |
| — | Cliff-after-duration behavior: zero vest until cliff, then instant full vest | — | Source-code inference only |

---

## 9. Design Decisions

These are intentional architectural choices, not defects.

| Decision | Rationale as implemented |
|----------|--------------------------|
| Mint-on-claim | VestingContract mints at release time; no pre-funded balance is required |
| Permissionless `release()` | Any address may trigger release on behalf of an employee (keeper pattern) |
| One grant per beneficiary address | Simplifies state model; multiple schedules require separate addresses |
| No ERC-20 `approve`/`transferFrom` | Compliance model requires identity verification on every transfer leg; approval-based flows would require verifying the approved spender |
| Immutable registry reference in EquityToken | No registry-swap path exists; the token's identity source cannot be changed after deployment without admin rotation |
| Direct registry enforcement (not policy delegation) | EquityToken embeds `isVerified` calls rather than delegating to a composable policy contract. The policy delegation model (`EquityTokenV2` + `ITransferPolicy`) is a parallel experiment |
| `_effectiveTime` strict-`>` comparison | Allows `release` to execute in the same transaction as `revokeGrant` without a separate post-revocation release transaction |
| Admin burn without identity check | `burn()` is intended for forfeiture of restricted accounts; requiring `isVerified(from)` would block the primary use case |

---

## 10. Known Limitations

These are factual limitations of the current implementation.

**L1 — Single-owner governance.** The Safe has a 1-of-1 threshold. Compromise of `0x6C775411e11cAb752Af03C5BBb440618788E13Be` grants full control over all three contracts with no second approval.

**L2 — Immediate admin rotation.** `setAdmin` on both `EquityToken` and `VestingContract` takes effect immediately. There is no time lock, pending period, or two-step confirmation.

**L3 — No supply or grant issuance cap.** No on-chain constraint limits the total amount grantable or mintable.

**L4 — One grant per beneficiary address.** Multiple vesting schedules for the same employee require separate wallet addresses. A second `createGrant` for an address with an existing grant reverts.

**L5 — `cliff > start + duration` not validated.** `createGrant` validates `cliff >= start` but not `cliff <= start + duration`. A grant configured with a cliff past the vesting end date will vest zero until the cliff, then vest 100% instantly on the cliff date.

**L6 — Contracts not Basescan-verified.** The source-to-bytecode relationship cannot be confirmed through Basescan's public interface.

**L7 — Deployment manifest is stale.** `deployments/base-sepolia.json` records Phase 8.4.B.A addresses. The canonical Phase 8.4.C addresses are only in evidence files.

**L8 — Evidence builder scripts are incomplete.** `scripts/ops/phase-8.4.C/` contains builders for `post-set-verified.json` and `post-create-grant.json` but no builder for the MultiSend evidence artifacts. Cases 3–6 have no builder scripts.

**L9 — Governance test non-executable.** `test/governance.selftest.test.js` (Part 5.2) is not executed by `npx hardhat test` because the `hardhat-node-test-runner` plugin was dropped from `hardhat.config.ts` at commit `3df1e2c`. This test exercises `EquityTokenV2`, not canonical Phase 8.4.C contracts.

---

## 11. Repository Boundaries

This repository is not currently:

- Production audited by an external security firm
- Deployed on Ethereum mainnet or any production network
- A transfer agent or legal record of equity ownership
- A compliance determination engine — identity status in `IdentityRegistry` does not constitute a legal compliance finding
- A complete cap-table platform — no capitalization table, investor management, or corporate record functionality is implemented
- A full ERC-20 integration layer — `EquityToken` lacks `approve`, `allowance`, and `transferFrom`
- A formal proof of any security property — on-chain evidence proves observed behavior, not absence of vulnerabilities

All contracts are deployed on Base Sepolia (testnet). No mainnet deployment exists.
