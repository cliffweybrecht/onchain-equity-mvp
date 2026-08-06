# Rail — Programmable Ownership Infrastructure

Rail is a protocol for issuing and managing ownership instruments on-chain with deterministic vesting, identity gating, and verifiable governance artifacts.

The canonical implementation runs on Base Sepolia (chain ID 84532). All contracts are deployed and evidence artifacts are chain-grounded — every claim in the evidence package traces to a transaction hash that can be verified independently via any Base Sepolia RPC endpoint.

---

## Current Status

**Phase 8.4.C — Active (testnet)**

| Component | Address (Base Sepolia) |
|---|---|
| EquityToken | `0x73b8e67B2bCF9e482aF3b0dEC0548f0e84017c95` |
| VestingContract | `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` |
| IdentityRegistry | `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4` |
| Safe (governance) | `0x1eDc758579C66967C42066e8dDCB690a1651517e` |

This software has not undergone a full external security audit. It is not suitable for production use.

---

## What Is Implemented

The following are **implemented and chain-verified** in Phase 8.4.C:

- **Mint-on-claim vesting** — The VestingContract mints tokens directly to the beneficiary at claim time. No pre-funded token pool is required.
- **Cliff + linear vesting schedule** — `floor(total * elapsed / duration)` with a cliff gating period.
- **Grant revocation** — Admin (Safe) can revoke any grant at any time. Vested-but-unreleased tokens remain claimable; unvested tokens are canceled. Revocation is irreversible per grant slot.
- **Identity gating** — `createGrant` requires `IdentityRegistry.isVerified(employee) == true`.
- **Conservation invariant** — `released_before + claimable + canceled = total` is proven for every revocation case.
- **Atomic revoke + release** — A single Safe MultiSend transaction can execute `revokeGrant` followed by `release` in the same block. The `_effectiveTime` boundary condition (strict `>`) is proven to handle this correctly.
- **Governance via Safe** — All admin operations require a Safe transaction signed by the owner EOA.
- **Chain-grounded evidence** — Phase 8.4.C produces JSON artifacts referencing block hashes, transaction receipts, event logs, and storage reads.

---

## What Is Not Yet Implemented

The following are **not implemented** in the canonical Phase 8.4.C stack:

- Transfer restrictions and compliance policy enforcement
- Emergency freeze / pause controls
- Append-only transparency log with Merkle root commitments
- Checkpoint artifacts and consistency proofs
- External security audit

---

## Repository Map

```
contracts/
  src/                      Solidity source (canonical contracts)
  evidence/                 Chain-grounded proof artifacts, organized by phase
  artifacts/                Hardhat build outputs (gitignored)

scripts/
  ops/                      Operational scripts: build and verify evidence artifacts
  audit/                    Audit verification scripts

docs/                       Protocol documentation
  CANONICAL_SYSTEM.md       Full canonical stack description for Phase 8.4.C
  ARCHITECTURE.md           Trust model, contract topology, admin authority
  TERMINOLOGY.md            Strict definitions used across this repository
  EVIDENCE_INDEX.md         Index of all evidence artifacts by phase
  TEST_MATRIX.md            What is proven, what is not

schemas/                    JSON schemas for artifact validation
deployments/                Deployment records (base-sepolia.json)
keys/                       Public key material only (private keys never committed)
```

---

## Development

Install dependencies:

```sh
npm install
```

Compile contracts:

```sh
npm run compile
```

Run tests:

```sh
npm test
```

Clean build artifacts:

```sh
npm run clean
```

Requires Node.js 20+ and a `BASE_SEPOLIA_RPC_URL` environment variable for scripts that fetch chain state. Copy `.env.example` to `.env` and fill in the values.

---

## Operational Scripts

Scripts in `scripts/ops/` produce or verify chain-grounded evidence artifacts. Each script documents its required arguments in its header comment.

Convenience aliases defined in `package.json`:

```sh
npm run sign:audit-packet
npm run verify:audit-packet-signature
npm run build:transparency-checkpoint-finalization
npm run verify:transparency-checkpoint-finalization
```

---

## Evidence

Phase 8.4.C evidence is in `contracts/evidence/phase-8.4.C/`. It proves:

- **Baseline release** — Tokens vest and release correctly under normal operation.
- **Case 1: Revoke before cliff** — Revocation before the cliff cancels the full grant; claimable is zero.
- **Case 2: Revoke during vesting** — Revocation during the vesting window produces a partial claimable amount. Conservation invariant holds.
- **Break Test A: Release then revoke** — `release` followed by `revokeGrant` in the same MultiSend. The revoke correctly observes the updated `g.released` written by `release`.
- **Break Test B: Revoke then release** — `revokeGrant` followed by `release` in the same MultiSend. The `_effectiveTime` strict `>` boundary allows `release` to observe `vested = 821` (same as `revokeGrant`) and mint the correct amount.

See `docs/EVIDENCE_INDEX.md` for a full artifact index.

---

## Security

See [SECURITY.md](SECURITY.md) for the responsible disclosure policy and maturity disclosure.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for PR discipline, branch conventions, and acceptance criteria requirements.

---

## License

MIT
