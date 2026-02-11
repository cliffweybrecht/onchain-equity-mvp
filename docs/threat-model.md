# Threat Model — Governance Evidence & Attestations

## In-Scope Threats
The system explicitly defends against:
- Post-hoc modification of governance evidence
- Silent mutation of committed artifacts
- Undetectable alteration of attestation payloads
- Non-deterministic verification outcomes
- Inconsistent evidence across reviewers

## Out-of-Scope Threats
The system does NOT defend against:
- Malicious initial omission of artifacts
- Compromise of the attestor’s private keys
- Malicious or negligent human operators
- Incorrect interpretation of evidence by reviewers
- External oracle correctness or real-world truth claims

## Adversary Model
Assumes a competent, adversarial reviewer with:
- Full read access to the repository
- Ability to execute verification tooling offline
- No trusted prior relationship with maintainers

No trust is assumed beyond cryptographic verification.
