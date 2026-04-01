# Implementation Checklist — Remediation

Per-step checklist: files in execution order, smallest patch per file, change type (docs-only / script-only / contract logic), commit grouping, and proposed commit messages. No full code is written here; implement the patches then check off.

---

## Commit batches (overview)

| Batch | Scope | Commit message |
|-------|--------|-----------------|
| A | P0 — Vesting comment + deploy prerequisites | See below |
| B | Deployment / preflight invariants | See below |
| C | P1 — createGrant funding doc + script | See below |
| D | P4 — Policy compatibility + deprecation | See below |
| E | P5 — Mint vs policy scope | See below |
| F | P6 — Policy trust boundary | See below |
| G | P3 — CompositePolicy empty-stack guard | See below |
| H | P7 — VestingContract release() balance require | See below |

---

## Step 1 — P0: Vesting comment + deploy prerequisites

**Commit batch:** A (all of step 1 in one commit)

### 1.1 — Files in execution order

| Order | File | Change type | Patch (smallest) |
|-------|------|-------------|------------------|
| 1 | `contracts/VestingContract.sol` | contract (comment only) | Replace the comment block above `release()` (lines 134–136). Remove “set as the admin of EquityToken” and “mint call.” New text: (i) this contract **transfers** from its own balance to the employee; (ii) token admin must **mint to this contract** so it holds sufficient balance for releases; (iii) **this contract’s address must be set to verified** in the IdentityRegistry so `EquityToken.transfer()` succeeds when this contract is the sender. Optionally add a 1–2 line contract-level NatSpec at top of file with same three points. |
| 2 | `docs/deployment-vesting-prerequisites.md` | docs-only | **New file.** Single “Vesting deployment prerequisites” section: (1) Deploy VestingContract; (2) Call `IdentityRegistry.setStatus(vestingContractAddress, 1)`; (3) Mint to `vestingContractAddress` via EquityToken (at least the sum of grant totals or fund as needed). 2–3 sentences per step; contract/function names only. |
| 3 | `README.md` | docs-only | Add one line in “Repository structure” or “Key components” / deployment: “Before using vesting, complete the steps in [Vesting deployment prerequisites](docs/deployment-vesting-prerequisites.md).” |
| 4 | `scripts/deploy-vesting-esm.js` | script-only | After the deploy (e.g. after logging vesting address), add a comment block or single `console.log`: “Post-deploy: set IdentityRegistry.setStatus(vestingAddress, 1) and mint tokens to vestingAddress.” |
| 5 | `scripts/deploy-base-sepolia.js` | script-only | If this file deploys VestingContract: same reminder as above (comment or `console.log`). If it does not deploy vesting, skip. |

**Commit message (batch A):**
```
docs(vesting): fix release() comment and add deployment prerequisites

- Correct NatSpec: release() transfers from contract balance, does not mint
- Document: VestingContract must be verified and funded before use
- Add deployment-vesting-prerequisites.md and README link
- Remind in deploy scripts to set status and mint to vesting address
```

---

## Step 2 — Deployment / preflight invariants

**Commit batch:** B (all of step 2 in one commit)

### 2.1 — Files in execution order

| Order | File | Change type | Patch (smallest) |
|-------|------|-------------|------------------|
| 1 | `docs/deployment-invariants.md` | docs-only | **New file.** Intro + five invariants. For each: **Invariant** (one sentence), **Check** (exact call, e.g. `IdentityRegistry.getStatus(vestingAddress) == 1`), **When** (when to run). (1) Vesting — identity; (2) Vesting — funding; (3) Token — policy set; (4) Composite — non-empty; (5) Transparency anchor — authority (post-P2). Add “Checklist” subsection: before/after deploy and before createGrant, run preflight or verify manually; link to [Vesting prerequisites](docs/deployment-vesting-prerequisites.md). |
| 2 | `scripts/ops/preflight-invariants.mjs` | script-only | **New file (optional).** Accept RPC URL and contract addresses (env or args). Read-only: run each invariant check that has addresses (e.g. registry.getStatus(vesting), token.balanceOf(vesting), policyCount(), etc.). On first failure: log and exit(1). Skip checks whose addresses not provided. Use viem; ~80–100 lines. |
| 3 | `README.md` | docs-only | Add one line (e.g. next to P0 link): “See [Deployment invariants](docs/deployment-invariants.md) for required post-deploy checks and optional preflight script.” |

**Commit message (batch B):**
```
docs(ops): add deployment invariants and optional preflight script

- Add docs/deployment-invariants.md with five formal invariants
- Add scripts/ops/preflight-invariants.mjs for read-only checks
- Link from README to deployment invariants
```

---

## Step 3 — P1: createGrant funding doc + script

**Commit batch:** C (all of step 3 in one commit)

### 3.1 — Files in execution order

| Order | File | Change type | Patch (smallest) |
|-------|------|-------------|------------------|
| 1 | `docs/deployment-vesting-prerequisites.md` | docs-only | Add subsection **“Funding before createGrant”**: “Before or immediately after each createGrant, the token admin must ensure VestingContract holds at least the new grant’s total (or the sum of all grant totals). Otherwise release() will revert with insufficient balance.” One short paragraph. |
| 2 | `scripts/ops/grants/create-grant.mjs` | script-only | After grant args are set (total, vesting, registry) and before encoding/sending tx: resolve token address (from VestingContract.token() or --token / TOKEN env). Read `token.balanceOf(vesting)`. If `balance < total`, `console.warn` or `die` with message e.g. “Insufficient vesting contract balance: need at least <total>, have <balance>.” Run check even when --no-send. ~15–25 lines. If token not resolvable from vesting, document in prereqs and only add check when TOKEN is set. |

**Commit message (batch C):**
```
docs(vesting): require funding before createGrant; add script check

- Add Funding before createGrant to deployment-vesting-prerequisites
- In create-grant.mjs, check vesting balance >= grant total; warn or exit
```

---

## Step 4 — P4: Policy compatibility + deprecation

**Commit batch:** D (all of step 4 in one commit)

### 4.1 — Files in execution order

| Order | File | Change type | Patch (smallest) |
|-------|------|-------------|------------------|
| 1 | `docs/policy-compatibility.md` | docs-only | **New file.** (a) EquityTokenV2 and CompositePolicy use 4-arg `canTransfer(token, from, to, amount)`. (b) Compatible: ComplianceGatedPolicyV1, MinAmountPolicyV1, EmergencyFreezePolicyV2, CompositePolicy, CompositePolicyV111. (c) Not compatible: EmergencyFreezePolicyV1 (checkTransfer), CompositePolicyV11 (3-arg); use V2/V111 instead. One page or less. |
| 2 | `contracts/policies/EmergencyFreezePolicyV1.sol` | contract (comment only) | After SPDX and pragma, add NatSpec/comment: “@notice Not compatible with EquityTokenV2 or as child of CompositePolicy (uses 3-arg checkTransfer). Use EmergencyFreezePolicyV2 for token integration.” |
| 3 | `contracts/policy/CompositePolicyV11.sol` | contract (comment only) | Same style: “@notice Not compatible with EquityTokenV2 (3-arg canTransfer). Use CompositePolicyV111 for token integration.” |
| 4 | `README.md` | docs-only | Optional: in compliance/architecture section add “See [Policy compatibility](docs/policy-compatibility.md) for 4-arg vs 3-arg and which policies to use with EquityTokenV2.” |

**Commit message (batch D):**
```
docs(policy): add compatibility doc; deprecate 3-arg policies for token use

- Add docs/policy-compatibility.md (4-arg vs 3-arg, compatible list)
- Add deprecation notices to EmergencyFreezePolicyV1 and CompositePolicyV11
- Optional README link to policy-compatibility
```

---

## Step 5 — P5: Mint vs policy scope

**Commit batch:** E (all of step 5 in one commit)

### 5.1 — Files in execution order

| Order | File | Change type | Patch (smallest) |
|-------|------|-------------|------------------|
| 1 | `README.md` or `docs/process-assumptions.md` | docs-only | Add one short paragraph: “EquityTokenV2 mint is admin-only and is not gated by the transfer policy; the policy applies only to transfers. Issuers must ensure mints are only to compliant recipients (e.g. verified addresses or the vesting contract).” Place in token/compliance section or as “Mint vs transfer policy” subsection in process-assumptions. |

**Commit message (batch E):**
```
docs(token): clarify mint is not gated by transfer policy

- State that policy applies only to transfers; mint is admin-only
- Issuers must mint only to compliant recipients
```

---

## Step 6 — P6: Policy trust boundary

**Commit batch:** F (all of step 6 in one commit)

### 6.1 — Files in execution order

| Order | File | Change type | Patch (smallest) |
|-------|------|-------------|------------------|
| 1 | `docs/process-assumptions.md` or `docs/threat-model.md` or `docs/policy-compatibility.md` | docs-only | Add subsection **“Policy as trust boundary”**: (i) Token admin can replace policy with any contract via setTransferPolicy(). (ii) Malicious/buggy policy can block transfers, allow disallowed transfers, or do state changes/reentrancy; token does not enforce view-only. (iii) Recommend: admin is multisig; only set audited, view-only policies. (iv) Replacing with untrusted or state-changing policy is a governance/trust violation. 3–5 sentences. Prefer policy-compatibility.md if it exists (step 4). |
| 2 | `docs/governance-invariants.md` or `docs/break-glass-runbook.md` | docs-only | Optional: one bullet or step: “Policy replacement: must be approved by [X]; only deploy view-only, audited policies; verify policy address and 4-arg interface before setTransferPolicy.” |
| 3 | `contracts/EquityTokenV2.sol` | contract (comment only) | Optional: above `transferPolicy` or in contract doc, add one line: “Transfer policy is a trust boundary; only set audited, view-only policies.” |
| 4 | `contracts/policy/ITransferPolicy.sol` | contract (comment only) | Optional: add “Implementations should be view-only; policy replacement is a trust boundary.” |

**Commit message (batch F):**
```
docs(policy): document policy as trust boundary and replacement risk

- Add Policy as trust boundary subsection (who can replace, consequences)
- Recommend multisig and view-only audited policies
- Optional: governance runbook bullet, NatSpec on token and interface
```

---

## Step 7 — P3: CompositePolicy empty-stack guard

**Commit batch:** G (single commit; contract logic)

### 7.1 — Files in execution order

| Order | File | Change type | Patch (smallest) |
|-------|------|-------------|------------------|
| 1 | `contracts/policy/CompositePolicy.sol` | contract logic | In constructor, after `require(_admin != address(0), "ZeroAdmin");`, add: `require(initialPolicies.length > 0, "EmptyPolicyStack");`. Remove or update the comment “Empty stack is allowed (AND over empty set => true)” so empty stack is no longer implied valid. |

**Commit message (batch G):**
```
fix(policy): require non-empty policy stack in CompositePolicy

- Add require(initialPolicies.length > 0, "EmptyPolicyStack") in constructor
- Prevents accidental deploy with no compliance enforcement
```

---

## Step 8 — P7: VestingContract release() balance require

**Commit batch:** H (single commit; contract logic)

### 8.1 — Files in execution order

| Order | File | Change type | Patch (smallest) |
|-------|------|-------------|------------------|
| 1 | `contracts/VestingContract.sol` | contract logic | In `release()`, after `g.released = vested;` and before `token.transfer(employee, unreleased);`, add: `require(token.balanceOf(address(this)) >= unreleased, "InsufficientVestingContractBalance");`. No other changes. |

**Commit message (batch H):**
```
fix(vesting): require sufficient balance in release() with clear revert

- Add require before transfer for clearer diagnostics when underfunded
- Revert reason: InsufficientVestingContractBalance
```

---

## Checklist summary

| Step | Batch | Files (count) | Types | Commit together? |
|------|--------|---------------|--------|-------------------|
| 1 | A | 5 | contract comment, docs, script | Yes — batch A |
| 2 | B | 3 | docs, script | Yes — batch B |
| 3 | C | 2 | docs, script | Yes — batch C |
| 4 | D | 4 | docs, contract comments | Yes — batch D |
| 5 | E | 1 | docs | Yes — batch E |
| 6 | F | 2–4 | docs, optional contract comments | Yes — batch F |
| 7 | G | 1 | contract logic | Yes — batch G |
| 8 | H | 1 | contract logic | Yes — batch H |

**Execution order:** Complete all edits for step 1 → commit batch A → step 2 → commit batch B → … → step 8 → commit batch H. Do not mix steps across commits; keep each batch self-contained so history stays one-fix-per-commit.
