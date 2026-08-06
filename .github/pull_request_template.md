## Objective

<!-- One sentence. What does this PR accomplish? -->

## Motivation

<!-- Why is this change needed? What problem does it solve? -->

## Scope

<!-- List every file changed. For each file, one line explaining what changed and why. -->

## Classification

<!-- Check one -->
- [ ] canonical — modifies the active canonical stack (Phase 8.4.C or successor)
- [ ] parallel experiment — non-canonical exploration (must be labeled in source)
- [ ] chore — repository hygiene, tooling, documentation
- [ ] evidence — new or updated chain-grounded proof artifacts

## Verification

<!-- Exact commands a reviewer can run to confirm this works. Must be runnable. -->

```sh
# Example:
npm run compile   # exits 0
npm test          # exits 0
```

## Trust Boundary Change

<!-- If this PR changes admin authority, Safe configuration, or access control: describe what changed, from whom, to whom, and the transaction hash. Write N/A if not applicable. -->

## Evidence Artifacts

<!-- If this PR modifies a Solidity contract: reference the chain-grounded artifact proving the new behavior. Include the transaction hash and the artifact file path. Write N/A if not applicable. -->

## Breaking Changes

<!-- Does this change break any existing script, artifact format, or operational procedure? If yes, describe the impact and migration path. Write N/A if not applicable. -->

## Checklist

- [ ] Branch name follows the convention in `CONTRIBUTING.md`
- [ ] Commit message follows `<type>(<scope>): <summary>` format
- [ ] One objective only — no bundled unrelated changes
- [ ] Verification section is runnable (not "trust me")
- [ ] Parallel experiment code is labeled in source if applicable
- [ ] No speculative abstractions or dead code added
- [ ] `npm run compile` and `npm test` pass locally
