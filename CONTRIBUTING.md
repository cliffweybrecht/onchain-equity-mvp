# Contributing to Rail Protocol

---

## One Objective Per PR

Each pull request must accomplish exactly one clearly stated objective. Do not bundle unrelated changes.

**Wrong:** "fix script + clean up docs"  
**Right:** "fix release amount calculation in build-post-create-grant.mjs"

---

## Branch Naming

| Prefix | Use |
|---|---|
| `chore/` | Repository hygiene, tooling, documentation |
| `feat/` | New capability added to the canonical stack |
| `fix/` | Defect correction in a canonical component |
| `evidence/` | New or updated chain-grounded proof artifacts |
| `docs/` | Documentation-only changes |
| `experiment/` | Non-canonical explorations (must be labeled in source) |

---

## Acceptance Criteria

Every PR description must include an **Acceptance Criteria** section listing verifiable statements that must be true before the PR is merged. Each criterion must be checkable by running a command or inspecting a specific artifact field, contract address, or transaction hash.

Use the PR template at `.github/pull_request_template.md`. Do not omit required sections.

---

## Contract Change Lifecycle

Modifying a Solidity source file and merging the PR does not make that change canonical.

The lifecycle for contract changes is:

1. **Source PR** — modify source, add or update local tests, perform trust-boundary analysis (see below), merge.
2. **Testnet deployment** — deploy the modified contract to Base Sepolia, record the deployment transaction hash.
3. **Evidence PR** — run evidence scripts against the deployed contract, produce chain-grounded artifacts in `contracts/evidence/phase-X/`, merge.
4. **Canonical declaration** — update `deployments/base-sepolia.json` and any affected documentation to reflect the new canonical addresses.

A source PR that passes local compilation and tests is a necessary but not sufficient condition for canonical status.

---

## Trust-Boundary Analysis

Any PR that changes who holds admin authority, modifies the Safe configuration, transfers ownership, or alters any access control path must include a **Security and Trust-Boundary Impact** section in the PR description stating:

- What authority is being changed
- From whom to whom
- Whether a transaction hash exists (or is pending) to prove the change on-chain

This applies to Solidity changes, script changes, and configuration changes that affect admin routing.

---

## Experiment Labeling

Code that is not part of the canonical stack must be labeled. In Solidity source files, add a top-of-file comment:

```solidity
// PARALLEL EXPERIMENT — not part of the canonical Phase 8.4.C stack.
// Do not reference this contract in canonical governance documents.
```

In documentation, use the term "parallel experiment" as defined in `docs/TERMINOLOGY.md`.

---

## Canonical Evidence Integrity

Canonical evidence artifacts in `contracts/evidence/` must never be silently modified. If an artifact must be corrected, open a dedicated PR explaining what was wrong, what the correction is, and include the original artifact in the PR for comparison.

---

## Commit Message Format

```
<type>(<scope>): <short summary>

<optional body: what changed and why>
```

Types: `feat`, `fix`, `chore`, `docs`, `evidence`, `test`, `refactor`

Keep the summary line under 72 characters.

---

## Milestone Awareness

Each PR should state which milestone it belongs to (see the Roadmap in `README.md`). PRs that do not belong to the current active milestone must explicitly justify why they are being merged out of sequence.
