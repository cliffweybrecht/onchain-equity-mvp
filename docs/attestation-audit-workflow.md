# Attestation Audit Workflow (One-Command Proof)
This repo provides:
- A deterministic attestation format and JSON schema
- A signer (for maintainers) and a verifier (for auditors) requiring no private keys
- A single append-only index listing all attestations to be checked
- A batch verifier that fail-fast verifies every attestation referenced by the index
- A machine-readable verification summary written to `evidence/part-5.5/`

## Files of interest
- Attestation format spec: `docs/attestation-format.md`
- Attestation schema: `schemas/attestation-v1.schema.json`
- Single-attestation verifier: `scripts/ops/verify-attestation.js`
- Attestation index (append-only): `manifests/attestation-index.json`
- Batch verifier (verify all): `scripts/ops/verify-all-attestations.js`
- Batch evidence outputs: `evidence/part-5.5/`

## Auditor quick start (no private keys required)
From repo root:
```bash
node scripts/ops/verify-all-attestations.js
```

[Add any additional sections here - expected output, troubleshooting, etc.]
