# Phase 8.4 — Revocation Semantics Specification (Mint-on-Claim Baseline)

## Status

* Phase: 8.4.A (Design Locked)
* Date: 2026-03-18
* Network: base-sepolia
* Dependency: Phase 8.3.B (repo/deployed vesting convergence)

---

## Canonical Baseline

The system operates under the following confirmed constraints:

* Issuance model: **mint-on-claim**
* `EquityToken.admin == VestingContract`
* Claim path uses: `token.mint(address,uint256)`
* Canonical issuance event: `Transfer(0x0 -> beneficiary, amount)`
* Vesting math and claim flow are converged and must not be redesigned

---

## Revocation Definition

Revocation is defined as:

> Permanent cancellation of the **unvested portion** of a grant as of the revocation timestamp.

Revocation does NOT:

* Burn tokens
* Reverse previously minted/released tokens
* Modify the issuance model
* Modify vesting math
* Introduce suspension or pause states

---

## Economic Semantics

Each grant decomposes into three buckets:

### 1. Released (Already Minted)

* Reflected in `released`
* Not revocable
* Remains valid permanently

### 2. Vested but Unreleased

* Vested at or before revocation timestamp
* Still claimable after revocation
* Not revoked

### 3. Unvested

* Would vest after revocation timestamp
* Permanently canceled
* Never claimable

---

## Accounting Model

### Total Grant

* `totalAmount` remains unchanged
* Represents historical grant size

### Effective Vesting

Let `V(t)` be existing vesting function.

* If not revoked:

  * `effectiveVested(t) = V(t)`
* If revoked:

  * `effectiveVested(t) = V(revokedAt)`

Equivalent:

* Use `min(t, revokedAt)` in vesting calculations

### Released

* Unchanged by revocation
* Only updated through claim

### Claimable

```
claimable = effectiveVested - released
```

Post-revocation:

* Does not increase
* May remain > 0 until fully claimed

### Canceled Amount (Derived)

```
canceled = totalAmount - V(revokedAt)
```

---

## Storage Changes (Minimal)

Per grant:

* `bool revoked`
* `uint256 revokedAt`

No additional mutable accounting fields allowed.

---

## Read Path Rule

All vesting calculations must use:

```
effectiveTime = revoked ? min(queryTime, revokedAt) : queryTime
```

This ensures:

* Vesting stops at revocation
* No change to vesting formula
* Deterministic behavior

---

## Revocation Action

### Function Behavior

* Requires admin authorization
* Fails if already revoked
* Sets:

  * `revoked = true`
  * `revokedAt = block.timestamp`
* Emits revocation event

### Important Constraints

* No backdating
* No forward scheduling
* No token mint/burn
* No mutation of `totalAmount` or `released`

---

## Event Specification

Revocation event MUST include snapshot values:

```
GrantRevoked(
  grantId,
  beneficiary,
  revokedAt,
  vestedAtRevocation,
  releasedAtRevocation,
  canceledUnvestedAmount
)
```

These values must satisfy:

* `vestedAtRevocation = V(revokedAt)`
* `releasedAtRevocation = released`
* `canceledUnvestedAmount = totalAmount - vestedAtRevocation`

---

## Invariants

1. Total grant is immutable
2. Issuance remains mint-on-claim
3. Released tokens are never clawed back
4. Vesting is frozen at revocation timestamp
5. Claimable never increases after revocation
6. Revocation is irreversible (MVP scope)
7. State transitions are fully reconstructible

---

## Edge Case Rules

* Revocation before vesting → all canceled
* Partial vesting → partial preserved
* Fully vested → no economic change
* Fully released → no economic change
* Multiple revocations → not allowed
* Claim vs revoke ordering → block order determines outcome

---

## Evidence Requirements (Phase 8.4)

Each revocation must produce:

* Revocation intent artifact
* Prestate snapshot
* Transaction receipt
* Poststate snapshot
* Revocation summary
* Convergence note (mint-on-claim unchanged)

---

## Non-Goals

* No clawback
* No burn logic
* No backdating
* No unrevoke
* No vesting redesign
* No issuance model changes

---

## Canonical Statement

> Revocation permanently stops future vesting at the revocation timestamp, preserves all previously vested and released amounts, cancels only the unvested remainder, and leaves the mint-on-claim issuance model unchanged.
