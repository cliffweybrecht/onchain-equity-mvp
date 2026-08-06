# Rail — Programmable Ownership Infrastructure

Rail is programmable ownership infrastructure built from reusable capabilities: **Identity**, **Authorization**, **Governance**, **Ownership lifecycle**, **Settlement**, **Evidence**, **Auditability**, and **Compliance hooks**. These capabilities compose into ownership primitives. **Equity is the first implemented ownership primitive.**

This repository does not currently support RSUs, options, warrants, SAFEs, convertible notes, fund interests, or any other instrument beyond the equity primitive described here.

---

## Canonical Release

| Property | Value |
|---|---|
| Phase | 8.4.C |
| Reference commit | `5c2e293905748fdd325d4b860fddaaf99980200d` |
| Network | Base Sepolia (chain ID 84532) |
| Status | Experimental testnet implementation — not production-ready |

Canonical contract addresses for Phase 8.4.C:

| Contract | Address |
|---|---|
| EquityToken | `0x73b8e67B2bCF9e482aF3b0dEC0548f0e84017c95` |
| VestingContract | `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` |
| IdentityRegistry | `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4` |
| Safe (governance) | `0x1eDc758579C66967C42066e8dDCB690a1651517e` |

Note: `deployments/base-sepolia.json` currently records the Phase 8.4.B.A stack. Updating it to reflect Phase 8.4.C is tracked as a pending task (Milestone 2).

---

## Roadmap

| # | Milestone | Status |
|---|---|---|
| 1 | Repository Hygiene | In progress |
| 2 | Canonical Deployment Manifest | Not started |
| 3 | Reproducible Local Setup | Not started |
| 4 | Evidence Automation | Not started |
| 5 | Continuous Integration | Not started |
| 6 | Contract Verification & Bytecode Provenance | Not started |
| 7 | Protocol Hardening | Not started |
| 8 | Architecture Decision Records | Not started |
| 9 | Canonical Protocol v1 | Not started |
| 10 | Developer Platform | Not started |
| 11 | Enterprise Product | Not started |
| 12 | Ecosystem Expansion | Not started |

---

## Implementation Scope

### Implemented and proven in canonical Phase 8.4.C

- **Mint-on-claim vesting** — The VestingContract mints tokens directly to the beneficiary at claim time. No pre-funded token pool is required.
- **Cliff + linear vesting schedule** — `floor(total * elapsed / duration)` with a cliff gating period before which no tokens vest.
- **Grant revocation** — Admin (Safe) can revoke any grant at any time. Vested-but-unreleased tokens remain claimable; unvested tokens are canceled. Revocation is irreversible per grant slot.
- **Identity gating** — `createGrant` requires `IdentityRegistry.isVerified(employee) == true`.
- **Conservation invariant** — `released_before + claimable + canceled = total` is proven for every revocation case in the evidence package.
- **Atomic revoke + release** — A single Safe MultiSend transaction can execute `revokeGrant` followed by `release` in the same block. The `_effectiveTime` strict `>` boundary condition is proven to handle this correctly (Break Test B).
- **Atomic release + revoke** — `release` followed by `revokeGrant` in the same MultiSend is proven to correctly observe the updated `g.released` value (Break Test A).
- **Governance via Safe** — All admin operations require a Safe transaction signed by the owner EOA.
- **Chain-grounded evidence** — Phase 8.4.C produces JSON artifacts referencing block hashes, transaction receipts, event logs, and storage reads that can be independently verified.

### Present in the repository but not part of the canonical Phase 8.4.C deployment

- **Compliance policy contracts** — `contracts/policies/` and `contracts/policy/` contain `EmergencyFreezePolicyV1`, `EmergencyFreezePolicyV2`, `CompositePolicy` variants, `MinAmountPolicyV1`, and `ComplianceGatedPolicyV1`. These exist and are Solidity-compilable but are not deployed or connected in the Phase 8.4.C stack.
- **EquityTokenV2** — `contracts/EquityTokenV2.sol` is a parallel experiment that adds policy enforcement hooks to the token. It is not part of the canonical Phase 8.4.C stack.
- **Transparency log infrastructure** — Schemas (`schemas/`), manifests (`manifests/`), and verification scripts (`scripts/audit/`) for an append-only transparency log exist and were used in prior phases. They are not active in Phase 8.4.C.
- **Audit packet system** — Scripts for building and verifying grant audit packets exist in `scripts/`. Operational in prior phases; not formally integrated into Phase 8.4.C evidence generation.
- **Historical evidence** — `evidence/` contains artifacts from phases 3.9 through 8.1. `contracts/evidence/` contains phase-by-phase artifacts up through 8.4.C.

### Not yet implemented

- Transfer restriction enforcement in the canonical stack
- Emergency pause / freeze in the canonical stack
- Continuous integration (Milestone 5)
- External security audit

---

## Settlement Architecture Note

Phase 8.4.C settlement uses **mint-on-claim**: the VestingContract holds the `admin` role on EquityToken and mints tokens directly to the beneficiary when `release(employee)` is called.

Mint-on-claim is an accepted MVP implementation. It is not a permanent architectural commitment. Settlement will be revisited during **Milestone 9 — Canonical Protocol v1**. The open architecture question is generalized ownership settlement — not simply switching from mint-on-claim to escrow.

---

## Repository Map

| Directory / File | Purpose | Classification | Manual Editing | Special Rules |
|---|---|---|---|---|
| `contracts/src/` | Canonical and experimental Solidity source | source | Yes | Changes require trust-boundary analysis; source changes are not canonical until chain-grounded evidence is produced |
| `contracts/evidence/` | Chain-grounded proof artifacts, organized by phase | canonical evidence | No | Generated by `scripts/ops/`; never manually edited |
| `contracts/policies/` | Emergency freeze policy contracts (not in Phase 8.4.C deployment) | source (non-canonical) | Yes | Must be labeled as non-canonical |
| `contracts/policy/` | Composite policy and interface contracts (not in Phase 8.4.C deployment) | source (non-canonical) | Yes | Must be labeled as non-canonical |
| `contracts/manifests/` | Transparency log manifests (prior phases) | historical artifact | No | Audit continuity; do not modify |
| `contracts/schemas/` | JSON schemas used by evidence scripts | source | Yes | Changes require corresponding script updates |
| `scripts/ops/` | Evidence artifact generation scripts | source | Yes | |
| `scripts/audit/` | Artifact verification scripts | source | Yes | |
| `scripts/demo/` | Demo flow scripts | source | Yes | Not canonical operational tooling |
| `scripts/deploy/` | Deployment scripts for prior phases | historical artifact | No | Do not re-run without explicit phase decision |
| `scripts/lib/` | Shared library modules | source | Yes | |
| `scripts/` (root-level `.js`) | Operational scripts from prior phases | historical artifact | No | Retained for audit continuity |
| `docs/` | Protocol documentation | documentation | Yes | Must accurately reflect canonical state |
| `schemas/` | JSON schemas for transparency log and audit packets | source | Yes | |
| `manifests/` | Transparency log manifests (root-level, prior phases) | historical artifact | No | |
| `evidence/` | Historical evidence artifacts (phases 3.9–8.1) | historical artifact | No | Gitignore controls subset; do not modify tracked artifacts |
| `deployments/` | Deployment records (`base-sepolia.json` tracked) | deployment state | With governance evidence | Address updates require a chain-grounded evidence artifact |
| `test/` | Test suite | source | Yes | |
| `archived/` | Legacy contracts from prior phases | historical artifact | No | Gitignored; retained locally for reference |
| `archived-tests/` | Historical test files | historical artifact | No | Retained for audit continuity |
| `keys/` | Public key material only | configuration | Public keys only | Private keys are never committed; `.gitignore` enforces this |
| `artifacts/` | Hardhat build output | generated output | Never | Gitignored |
| `cache/` | Hardhat build cache | generated output | Never | Gitignored |
| `node_modules/` | npm dependencies | generated output | Never | Gitignored |
| `.github/` | GitHub configuration | configuration | Yes | |
| `hardhat.config.ts` | Hardhat build and network configuration | configuration | Yes | Changes affect compilation and deployment targets |
| `package.json` | npm manifest | configuration | Yes | |
| `tsconfig.json` | TypeScript configuration | configuration | Yes | |
| `regulator-packet-v1.1.json` | Regulator packet (Phase 7 era) | historical artifact | No | Retained for audit continuity |
| `regulator-packet-v1.3.json` | Regulator packet (Phase 7 era) | historical artifact | No | Retained for audit continuity |

---

## Development

Install dependencies (uses the lockfile; does not update it):

```sh
npm ci
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

The repository has no pinned Node.js version requirement. Node.js 22 is the current development environment. The package uses ES module syntax (`"type": "module"` in `package.json`).

Network-dependent operational scripts (in `scripts/ops/`) require a `BASE_SEPOLIA_RPC_URL` environment variable. Set it in a `.env` file (which is gitignored). Optionally set `PRIVATE_KEY` for scripts that submit transactions.

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
- **Break Test A: Release then revoke** — `release` then `revokeGrant` in the same MultiSend. Revoke correctly observes the `g.released` value written by `release`.
- **Break Test B: Revoke then release** — `revokeGrant` then `release` in the same MultiSend. The `_effectiveTime` strict `>` boundary allows `release` to observe the same `vested` as `revokeGrant` and mint the correct amount.

See `docs/EVIDENCE_INDEX.md` for a full artifact index.

---

## Security

See [SECURITY.md](SECURITY.md) for the responsible disclosure policy and maturity disclosure.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for PR discipline, branch conventions, and contribution lifecycle.

---

## License

MIT
