# Governance Evidence Attestation Format (v1)

This document defines a stable, auditor-friendly attestation format for signing governance evidence manifests.

## Purpose

An attestation cryptographically binds:
1) A specific evidence manifest file (e.g., Part 5.3 manifest)
2) Its deterministic canonical hash
3) A signer identity (initially a maintainer EOA; later a Safe/multisig)

This enables third-party verification that:
- The manifest has not changed since signing
- The signature was produced by the expected signer
- The evidence bundle remains reproducible and auditable

## Canonical Hashing

The signed hash is computed as:

- Input: the JSON object parsed from the manifest file
- Canonicalization: recursively sort object keys; preserve array order; no whitespace
- Digest: SHA-256 over UTF-8 bytes of the canonical JSON string
- Output: hex string prefixed with `0x`

This ensures deterministic hashing across environments.

## Signature Method

Default maintainer signing uses Ethereum ECDSA secp256k1 with EIP-191 personal message signing:

Message:
`"Governance Evidence Attestation v1\n<hash>"`

Where `<hash>` is the 0x-prefixed SHA-256 canonical manifest hash.

The signature is a 65-byte ECDSA signature serialized as hex (0x + 130 hex chars).

## Attestation JSON (v1)

Minimal example:

```json
{
  "attestationVersion": "v1",
  "statement": "I attest that the referenced manifest hash accurately represents the governance evidence bundle at the time of signing.",
  "createdAt": "2026-02-07T17:20:00.000Z",
  "subject": {
    "type": "governance-evidence-manifest",
    "path": "evidence/part-5.3/manifest.json",
    "hash": {
      "alg": "sha256-canonical-json",
      "value": "0x..."
    }
  },
  "signer": {
    "type": "eoa",
    "address": "0x..."
  },
  "signature": {
    "type": "eip191-personal-sign",
    "message": "Governance Evidence Attestation v1\n0x...",
    "value": "0x..."
  },
  "notes": {
    "repo": "optional",
    "commit": "optional"
  }
}
