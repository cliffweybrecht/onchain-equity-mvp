# Contributing to Rail Protocol

---

## One Objective Per PR

Each pull request must accomplish exactly one clearly stated objective. Do not bundle unrelated changes. A PR that fixes a script bug and also refactors a contract is two PRs.

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
| `experiment/` | Non-canonical explorations (must be labeled) |

---

## Measurable Acceptance Criteria

Every PR description must include a **Verification** section listing the exact commands a reviewer can run to confirm the change works. If a change cannot be verified by running a command, it must reference a specific transaction hash, block number, or artifact field that proves the claim.

Examples of acceptable verification:

```
npm run compile   # exits 0
npm test          # exits 0, 3 tests passed
node scripts/ops/phase-8.4.C/verify-foo.mjs --tx-hash 0x...   # PASS
```

Examples of unacceptable verification:

```
"Works on my machine"
"Trust me"
"Visually inspected"
```

---

## Contract Changes Require Evidence

Any PR that modifies a Solidity source file must include or reference a chain-grounded evidence artifact proving the modified contract behaves correctly on Base Sepolia. The artifact must:

- Reference a transaction hash from a successful deployment
- Include a decoded event log or storage read confirming the behavior under test
- Pass all assertion fields (`true` throughout)

Evidence artifacts go in `contracts/evidence/phase-X/` where `X` is the current phase.

---

## Trust Boundary Disclosure

If a PR changes who holds admin authority, changes the Safe configuration, transfers ownership, or modifies any access control path, the PR description must include a **Trust Boundary Change** section that explicitly states:

- What authority is being changed
- From whom to whom
- The transaction hash that executed the change (or that the change is pending)

---

## Experiment Labeling

Code that is not part of the canonical stack must be labeled. In source files, add a top-of-file comment:

```solidity
// PARALLEL EXPERIMENT — not part of the canonical Phase 8.4.C stack.
// Do not reference this contract in canonical governance documents.
```

In documentation, use the term "parallel experiment" as defined in `docs/TERMINOLOGY.md`.

---

## No Speculative Abstractions

Do not introduce helpers, utilities, base contracts, or interfaces unless they are used immediately by code in the same PR. Do not add configuration options, feature flags, or error handling for scenarios that cannot currently occur. Three similar lines of code is better than a premature abstraction.

---

## PR Template

All PRs must use the template at `.github/pull_request_template.md`. Do not omit fields. If a field does not apply, write `N/A` with a brief explanation.

---

## Review Requirements

- At least one approving review before merge
- All CI checks must pass (compile, test)
- No unresolved review comments
- PR description must be complete per the template

---

## Commit Message Format

```
<type>(<scope>): <short summary>

<optional body: what changed and why>
```

Types: `feat`, `fix`, `chore`, `docs`, `evidence`, `test`, `refactor`

Keep the summary line under 72 characters. The body is optional but encouraged for non-obvious changes.
