# Part 5.3 — Governance Evidence Hardening & Auditor Readiness

This folder contains a cryptographically verifiable evidence bundle derived from Part 5.2.

## What’s included
- `governance-evidence-bundle-*.json`
  - embeds the original Part 5.2 evidence verbatim
  - adds:
    - sha256 of the source evidence file (raw + canonicalized)
    - observed `chainId` + `blockNumber`
    - on-chain runtime bytecode keccak256 hashes for each contract address
    - explicit invariants section for auditor readability
- `manifest-*.sha256.txt`
  - sha256 checksums for the bundle + the source evidence file

## One-command verification (auditor workflow)

### 1) Install dependencies
```bash
npm ci
```

### 2) Set RPC
```bash
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

### 3) Verify bundle integrity + on-chain bytecode
```bash
node scripts/evidence/verify-evidence.js --manifest evidence/part-5.3/manifest-<TIMESTAMP>.sha256.txt
```

Expected output: `✅ Evidence verified`

## Regenerating a new Part 5.3 bundle from Part 5.2
```bash
node scripts/evidence/enrich-evidence.js \
  --in evidence/part-5.2/governance-selftest-2026-02-07T19-30-49Z.json
```
