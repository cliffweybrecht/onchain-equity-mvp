# Trust & Authority Assumptions

## Attestation Authority
Attestations assert:
- Integrity of referenced artifacts
- Consistency with declared schemas
- Temporal ordering (issuance time)

Attestations do NOT assert:
- Legal authority
- Regulatory approval
- Factual correctness beyond integrity
- Third-party endorsement

## Trust Model
- Trust is local, explicit, and non-transitive
- No decentralized trust claims are made
- No oracle or multi-party consensus is implied

Reviewers are expected to independently evaluate
whether the attestation issuer is an acceptable authority
for their specific use case.

## Key Compromise
If an attestor key is compromised:
- Past attestations remain verifiable
- Trust in future attestations must be reassessed externally
- No on-chain or automated revocation is claimed
