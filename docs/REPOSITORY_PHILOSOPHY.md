# Repository Philosophy

> See [`CANONICAL_SYSTEM.md`](CANONICAL_SYSTEM.md) for the current canonical release definition.

---

## 1. Canonicality

One set of contracts, one deployment, and one evidence package constitute the canonical architecture for any given release. The canonical release is identified by:

- a named phase (e.g., Phase 8.4.C)
- a source commit
- a deployed network and chain ID
- a set of confirmed on-chain addresses
- a documented trust model

Only what is defined in [`CANONICAL_SYSTEM.md`](CANONICAL_SYSTEM.md) and confirmed in `contracts/evidence/phase-<release>/case-specs.json` is canonical. Being deployed does not make a contract canonical. Being in the repository does not make a contract canonical.

---

## 2. Historical Preservation

Old deployments, evidence packages, and implementation generations are not deleted. They are retained because:

1. **Audit continuity.** External reviewers and future team members need to trace how the system evolved. Deleting prior evidence would create gaps in the record.

2. **On-chain immutability.** Contracts deployed to Base Sepolia (or any public network) cannot be removed. Keeping their source and evidence in the repository allows those deployments to remain interpretable.

3. **Evidence integrity.** Evidence JSON files are append-only records of what was observed on-chain at a specific block. Rewriting or removing them to make a prior phase appear current would corrupt the audit trail.

Historical components are classified in [`CANONICAL_SYSTEM.md §5`](CANONICAL_SYSTEM.md#5-canonical-vs-non-canonical) as "Legacy" and carry an explanation of why they remain.

---

## 3. Parallel Experiments

This repository contains components that are not canonical but are actively being developed alongside the canonical system. These parallel experiments exist because:

1. **Architectural exploration is incremental.** The modular transfer-policy architecture (`EquityTokenV2`, `ITransferPolicy`, `CompositePolicy`) represents a different design point than the embedded-check model in canonical `EquityToken`. Both have tradeoffs that have not yet been resolved by a formal architecture decision.

2. **Experimentation in-tree keeps context.** Moving experiments to a separate repository loses the history of how they relate to the canonical system. Keeping them in-tree with explicit classification maintains the relationship.

3. **Experiments inform future promotions.** A parallel experiment may become the next canonical architecture if it satisfies the criteria in [§5 Promotion Criteria](#5-promotion-criteria).

Parallel experiments are classified in [`CANONICAL_SYSTEM.md §5`](CANONICAL_SYSTEM.md#5-canonical-vs-non-canonical). They must not be described or treated as canonical in any document, script, or evidence artifact until they are formally promoted.

---

## 4. Separation of Concerns

The repository maintains a clear separation between what the system *does* and what it *might do*:

- Source code describes what is implemented
- Evidence describes what was observed on-chain
- Test coverage describes what has been automatically verified locally
- Specifications describe what is intended but not yet proven

Documents that blur these categories — presenting intended behavior as proven, or source-code inference as on-chain evidence — are considered incorrect and should be corrected.

---

## 5. Promotion Criteria

For a parallel experiment to become canonical, it must satisfy all of the following:

1. **Explicit architecture decision.** A written decision record explaining why the experiment is promoted and what the superseded architecture's deprecation plan is.

2. **Passing automated tests.** `npx hardhat test` (or the equivalent test command for that release) passes without modification of existing tests. New tests covering the promoted architecture pass.

3. **Canonical deployment.** Contracts are deployed to the target network. Deployment addresses are confirmed by independent on-chain reads.

4. **Updated deployment manifest.** `deployments/base-sepolia.json` (or the appropriate network manifest) is updated to the new addresses. Old addresses are retained with a `_legacy` or `_superseded` annotation.

5. **Bytecode provenance.** Compiled local artifacts match deployed bytecode at all bytes except the CBOR metadata suffix. A written comparison confirms this.

6. **Evidence package.** A complete evidence directory for the new phase is committed, following the structure of `contracts/evidence/phase-8.4.C/`. All specified cases are proven or explicitly deferred with a stated reason.

7. **Security review.** The promoted architecture has been reviewed for known vulnerability classes — access control, reentrancy, arithmetic, calldata encoding, event integrity — by at least one person other than the primary implementor, or by an automated tool with documented output.

8. **Documentation update.** `CANONICAL_SYSTEM.md`, `ARCHITECTURE.md`, `EVIDENCE_INDEX.md`, and `TEST_MATRIX.md` are updated for the new canonical release.

9. **Deprecation plan for the superseded generation.** The previous canonical contracts are reclassified as legacy. If they hold live state (grants, balances), a migration or sunset plan is documented.

---

## 6. Append-Only Evidence Philosophy

Committed evidence files record what was observed on-chain at a specific block and time. They must not be:

- modified to reflect different on-chain state retroactively
- deleted to remove prior phases from the record
- replaced with simulated or locally computed values labeled as on-chain observations
- updated with new addresses to make a prior phase appear current

When a new canonical stack is deployed, new evidence is created in a new directory. Prior evidence remains unchanged. The only permitted modification to a committed evidence file is correction of a transcription error in metadata fields (e.g., a wrong ISO date string) when the correction is explicitly noted in the commit message.

---

## 7. Reproducibility Philosophy

The long-term standard for this repository is that any reviewer starting from a clean checkout can independently verify any proven claim by running documented commands against the specified commit. This standard has not yet been fully achieved. The current state is:

| Reproducibility level | Status |
|-----------------------|--------|
| Compile contracts from source | Achieved — `npx hardhat compile` |
| Run local simulation tests | Partially achieved — `test/governance.selftest.test.js` is non-executable due to missing plugin configuration |
| Reproduce evidence builder output | Partially achieved — `build-post-set-verified.mjs` and `build-post-create-grant.mjs` exist; MultiSend evidence builder missing |
| Verify on-chain proofs from evidence JSON | Achievable manually using the RPC calls in evidence files; no automated verifier script exists |
| Deterministic end-to-end verification | Not yet achieved |

For any component claiming to be reproducible, the criterion is: can a reviewer who has never seen this repository execute the verification steps and arrive at the same result from a clean checkout? Where this standard is not met, the limitation is documented in [`CANONICAL_SYSTEM.md §9`](CANONICAL_SYSTEM.md#9-known-limitations).

---

## 8. Deployment Philosophy

- Each network has one canonical deployment manifest (e.g., `deployments/base-sepolia.json`).
- Historical deployments remain recorded in the manifest with explicit phase labels (e.g., `VestingContract_legacy`).
- A contract address is not canonical merely because it was deployed. An address becomes canonical when it is recorded in both the deployment manifest and the `CANONICAL_SYSTEM.md` release definition for a specific phase.
- The canonical-system document and the deployment manifest must agree. When they conflict, [`CANONICAL_SYSTEM.md`](CANONICAL_SYSTEM.md) is the authoritative source until the manifest is corrected. As of Phase 8.4.C, `deployments/base-sepolia.json` is stale and records Phase 8.4.B.A addresses.

---

## 9. Documentation Hierarchy

When information conflicts across repository documents, the resolution order is:

1. **[`CANONICAL_SYSTEM.md`](CANONICAL_SYSTEM.md)** — defines the authoritative current release. Addresses, roles, and trust model here supersede all other documents.
2. **`deployments/base-sepolia.json`** (or network-equivalent) — the machine-readable deployment manifest. Should agree with `CANONICAL_SYSTEM.md`. When it does not, the manifest is stale.
3. **Contract source** (`contracts/*.sol`) — defines the behavior of the deployed code. Local source may differ from deployed bytecode in the CBOR metadata suffix only.
4. **[`EVIDENCE_INDEX.md`](EVIDENCE_INDEX.md) and `contracts/evidence/phase-*/`** — describes what was observed on-chain. Evidence supersedes documentation claims about what the contracts *do*.
5. **[`TEST_MATRIX.md`](TEST_MATRIX.md)** — describes what has been automatically verified.
6. **Historical phase documentation** (`contracts/evidence/phase-3.*` through prior phases, earlier docs) — records earlier states. Does not supersede current canonical release definition.
7. **Experimental notes and parallel experiment documentation** — describes non-canonical tracks. Does not apply to the canonical system.

**Handling contradictions:** When a contradiction is found between documents at the same level, the evidence (on-chain observations) takes precedence over stated intent. The discovery of a contradiction should be recorded in a GitHub issue and resolved by updating the lower-priority document to match the higher-priority source of truth.
