# Vesting Invariants (Audit Notes)

This document describes the expected invariants of the Vesting contract and how they are validated in this repository using a deterministic, one-command proof at a pinned Base Sepolia block.

## Scope

- Repo: `~/onchain-equity-mvp/contracts`
- Branch: `main`
- Phase: 6.2 (committed and pushed)
- Proof method: one-command invariants + golden proof
- Chain: Base Sepolia
- Pinned block: `PINNED_BLOCK=37968380`

This is an auditor-facing statement of intent: what must always be true, and what the tests/scripts prove.

---

## Definitions

- Vesting grant: a beneficiary-specific schedule tracked by the Vesting contract.
- Beneficiary: the address receiving vesting according to the schedule.
- Registry/identity gate: whether the beneficiary (and/or claim path) must satisfy identity/compliance conditions.
- Pinned block proof: running read-only verification against a fixed chain state to eliminate nondeterminism.

---

## Invariants

### I1 — Authorization / Access Control
Only authorized accounts can:
- create a grant
- modify grant parameters (if supported)
- revoke/cancel grants (if supported)
- withdraw unallocated funds (if supported)
- change critical configuration (registry pointers, admin roles, etc.)

Unauthorized calls must revert.

---

### I2 — Grant Storage Consistency
A beneficiary has either:
- no grant, or
- exactly one active grant record

Stored grant parameters must be internally consistent.

---

### I3 — Monotonic Vesting
Vested amount must:
- be monotonic non-decreasing
- never exceed total grant

---

### I4 — Claim Safety
A beneficiary must never claim more than:
- vested amount
- minus already claimed amount

No double-claim.
No rounding overflow.
No over-release.

---

### I5 — Accounting Soundness
Relationships such as:

claimed <= vested <= totalGrant

must always hold.

---

### I6 — Compliance / Registry Enforcement
If registry gating is enabled:
- ineligible beneficiaries cannot claim
- eligibility state changes are reflected correctly

---

### I7 — Determinism at Pinned Block

At:

PINNED_BLOCK=37968380

The verification output must be:
- deterministic
- reproducible
- identical across runs
- independent of wall-clock time

---

## One-Command Proof (Phase 6.2)

From the contracts directory:

PINNED_BLOCK=37968380 <INSERT_PHASE_6_2_COMMAND_HERE>

Acceptance:
- Command exits successfully
- Invariants pass
- Golden comparison passes

---

## Public Repo Hygiene

Golden diff artifacts (GOT.*) are ignored via:

evidence/**/GOT.*

These files must never be committed.

---

## Auditor Checklist

1. Run the pinned-block proof.
2. Verify invariants align with vesting math.
3. Verify access control boundaries.
4. Verify compliance gating.
5. Confirm no development artifacts are tracked.
