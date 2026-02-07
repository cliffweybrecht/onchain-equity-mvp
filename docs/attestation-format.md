The signature is a 65-byte ECDSA signature serialized as hex (`0x` + 130 hex chars).# Governance Evidence Attestation Format (v1)

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

Default maintainer signing uses Ethereum ECDSA secp256k1 with EIP-191 personal message signing.

Message format:

```
onchain-equity.attestation.v1
manifest.sha256:<digest>
```

Where `<digest>` is the hex (no `0x`) SHA-256 canonical manifest hash.

The signature is a 65-byte ECDSA signature serialized as hex (`0x` + 130 hex chars).

## Attestation JSON (v1)

Minimal example:

```json
{
  "schema": "attestation-v1",
  "type": "manifest-attestation",
  "issuedAt": "2026-02-07T17:00:00.000Z",
  "id": "part-5.4C-1",
  "subject": {
    "type": "json-manifest",
    "path": "manifests/attestation-manifest.json",
    "digest": {
      "alg": "sha256",
      "value": "0x921b2464d977d2e9e297568afad077367f5afd3ffa26b2801790469596b18ed8"
    }
  },
  "signature": {
    "type": "eip191",
    "signer": "0x6C775411e11cAb752Af03C5BBb440618788E13Be",
    "preimage": "onchain-equity.attestation.v1\nmanifest.sha256:921b2464d977d2e9e297568afad077367f5afd3ffa26b2801790469596b18ed8",
    "preimageDigest": {
      "alg": "sha256",
      "value": "0x824548bcf479ed885335b00455889e7c602c904e1e7256d3ceadea58a6dc5c74"
    },
    "value": "0x..."
  }
}

## Tooling

### Verify attestation (verify-attestation.js)

```bash
node scripts/ops/verify-attestation.js \
  --attestation evidence/part-5.4/attestation-manifest.attestation.json

node scripts/ops/verify-attestation.js \
  --attestation evidence/part-5.4/attestation-manifest.attestation.json \
  --expected-signer 0x6C775411e11cAb752Af03C5BBb440618788E13Be


