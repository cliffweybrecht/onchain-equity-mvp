# Process Assumptions

This document enumerates explicit assumptions about how the system is intended
to be used, interpreted, and reviewed. These assumptions are necessary for
correct evaluation of governance, issuance, and verification artifacts.

This document is append-only and does not modify or reinterpret frozen
governance evidence.

---

## Deterministic Execution Environment

All scripts, attestations, and verification tooling assume:

- A deterministic EVM execution environment
- A known chain ID and RPC endpoint
- Stable contract bytecode as recorded in deployment artifacts
- No reliance on off-chain state beyond explicitly referenced inputs

Verification is expected to be reproducible by third parties using the same
inputs and chain state.

---

## Separation of Governance and Product Flows

The system intentionally separates:

- **Governance evidence** (admin rights, policy configuration, invariants)
- **Product activity** (issuance, operational transactions)

Product actions (e.g., issuance) are not governance events and do not alter
governance authority, policy stacks, or admin control.

---

## Issuance vs Balance Semantics

Successful issuance (i.e. execution of a `mint` operation) does **not**
guarantee a corresponding change in `balanceOf()`.

`balanceOf()` reflects the **policy-filtered effective balance** under the
active policy stack (e.g. vesting rules, transfer restrictions, identity
requirements, freeze states).

Newly issued units may be:

- Non-transferable
- Temporarily restricted by policy
- Excluded from `balanceOf()` until policy conditions are satisfied

As a result:

- Issuance success must be verified via transaction receipts and issuance
  artifacts
- `balanceOf()` deltas alone are insufficient to prove issuance correctness

This behavior is intentional and by design.

---

## Evidence Interpretation

Evidence artifacts should be interpreted as follows:

- Transaction receipts prove execution
- Issuance artifacts prove intent, parameters, and on-chain effects
- Governance artifacts prove authority and configuration
- Balance reads reflect *current effective state*, not raw issuance totals

Auditors should not infer system failure solely from the absence of a
`balanceOf()` change following a successful issuance.

---

## No Implicit Guarantees

Unless explicitly stated:

- No guarantee is made that issued units are immediately transferable
- No guarantee is made that issued units are immediately reflected in
  `balanceOf()`
- No guarantee is made regarding economic value or liquidity

All guarantees are scoped to what is explicitly verified on-chain and
documented in artifacts.

---

## Reviewer Assumptions

Reviewers are expected to:

- Evaluate issuance, governance, and balance semantics independently
- Cross-check artifacts against on-chain state
- Avoid extrapolating economic meaning beyond stated guarantees

Failure to apply these assumptions may lead to incorrect conclusions about
system correctness.

---

## Change Policy

This document may be extended for clarity but must not be used to reinterpret
or contradict frozen governance evidence.
