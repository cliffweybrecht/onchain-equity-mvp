## Objective

<!-- One sentence. What does this PR accomplish? -->

## Architectural Rationale

<!-- Why is this the right approach? What alternatives were considered and rejected? How does this fit the current milestone? -->

## Scope

<!-- List every file changed. For each file, one line explaining what changed and why. -->

## Out of Scope

<!-- Explicitly list related work that was intentionally deferred. This prevents scope creep and informs future PRs. -->

## Acceptance Criteria

<!-- Numbered list of verifiable statements that must be true for this PR to be mergeable. Each criterion must be testable — either by running a command or by inspecting a specific artifact field or contract address. -->

## Verification Performed

<!-- Exact commands run and their complete output. Must be reproducible by any reviewer. -->

```sh
npm ci
npm run clean
npm run compile
npm test
```

## Security and Trust-Boundary Impact

<!-- Does this PR change who holds admin authority, modify the Safe configuration, alter access control paths, or affect key material? If yes: state what changed, from whom to whom, and the transaction hash (or note that one is pending). Write "None" if not applicable. -->

## Generated or Canonical Artifacts Affected

<!-- Does this PR add, modify, or delete any artifact in contracts/evidence/, manifests/, or evidence/? If yes, explain why and how the artifact was regenerated. Canonical evidence must never be silently modified. Write "None" if not applicable. -->

## Rollback Plan

<!-- How is this PR reversed if problems are discovered post-merge? For documentation-only PRs, this is a revert commit. For contract changes, state whether a new deployment is required. -->

## Future Work Unlocked

<!-- What PRs or milestones does this PR unblock? What decisions does it leave open intentionally? -->

---

## Checklist

- [ ] This PR has exactly one objective
- [ ] No unrelated work is included
- [ ] This PR belongs to the current milestone (or explicitly states why it does not)
- [ ] Documentation matches actual behavior — nothing is claimed that is not implemented
- [ ] No secrets, private keys, or credentials are committed
- [ ] Canonical evidence artifacts were not silently modified
