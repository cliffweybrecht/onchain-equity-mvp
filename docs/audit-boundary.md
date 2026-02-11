# Audit Boundary Clarification

This document defines the explicit scope and limits of what is claimed as
"audit-ready" within this repository. It exists to prevent over-interpretation
of evidence and to clearly separate verified facts from non-claims.

This document is append-only and does not modify or reinterpret frozen
governance evidence.

---

## Meaning of "Audit-Ready"

Within this repository, "audit-ready" means:

- Evidence artifacts are immutable once frozen
- Verification procedures are deterministic and offline-reproducible
- Artifacts can be independently validated against on-chain state
- Governance authority, policy configuration, and invariants are provable

---

## What "Audit-Ready" Does NOT Mean

"Audit-ready" does **not** imply:

- Regulatory approval
- Legal compliance
- Economic soundness
- Absence of risk
- Correctness of off-chain processes
- Completeness of documentation beyond recorded artifacts

---

## Scope of Audit Claims

Audit claims are strictly limited to:

- What is recorded in committed evidence artifacts
- What can be independently verified on-chain
- What is explicitly stated in documentation

No claims are made about intent, diligence, or correctness beyond these bounds.

---

## Out-of-Scope Areas

The following are explicitly outside the audit boundary:

- Off-chain business logic
- Human decision-making processes
- Key custody procedures
- Operational security practices
- Economic assumptions or token valuation
- User behavior or misuse

---

## Issuance and Balance Semantics

Issuance success and observable balance changes are intentionally decoupled.

Reviewers should refer to `docs/process-assumptions.md` for clarification on
issuance semantics and the policy-filtered nature of `balanceOf()`.

---

## Interpretation Guidance for Reviewers

Reviewers are expected to:

- Evaluate governance, issuance, and balance behavior independently
- Cross-reference documentation when behavior appears non-intuitive
- Avoid inferring system failure from behavior that is consistent with stated assumptions
- Treat absence of evidence as absence of claim, not proof of deficiency

Failure to apply this guidance may result in incorrect audit conclusions.

---

## Change Policy

This document may be extended for clarity but must not be used to expand,
reinterpret, or contradict frozen governance evidence.
