# Attestation Audit Workflow

This document describes the end-to-end workflow for generating, indexing, and verifying governance and tooling attestations in this repository.  
The goal is to provide a **deterministic, tamper-evident, auditor-friendly** verification path that can be executed with a single command.

---

## Overview

The attestation system consists of:

- Individual **attestation files** (`attestation-v1`) that bind a SHA-256 digest to a specific subject file.
- A centralized **attestation index** (`manifests/attestation-index.json`) that enumerates all attestations.
- A **canonical index attestation** that makes the index itself tamper-evident.
- A one-command **verification tool** that validates the entire chain.

All artifacts are append-only. Historical attestations are never rewritten or deleted.

---

## Attestation Format

All attestations use schema `attestation-v1` and include:

- `type` — logical attestation type (e.g. `manifest-attestation`, `file-attestation`, `index-attestation`)
- `issuedAt` — ISO-8601 timestamp
- `id` — stable identifier
- `subject`:
  - `path` — file being attested
  - `digest.alg` — `sha256`
  - `digest.value` — hex-encoded SHA-256 of the subject file bytes

---

## Attestation Index

`manifests/attestation-index.json` serves as the authoritative list of all attestations.

Properties:

- Append-only
- Deterministic ordering
- Human-reviewable
- Machine-verifiable

Each entry includes:

```json
{
  "type": "<attestation-type>",
  "path": "<path-to-attestation-json>"
}
