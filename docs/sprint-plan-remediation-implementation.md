# Implementation Sprint Plan — Remediation

This sprint covers items to be done **now** from the remediation plan: P0, deployment/preflight invariants, P1 (doc + script), P4, P5, P6, P3, P7. P2 (TransparencyLogAnchor) and future aggregate vesting reserve are out of scope for this sprint.

For each item: (1) classification, (2) exact files to edit, (3) smallest safe patch, (4) implementation complexity, (5) dependencies.

---

## Sprint overview

| # | Item | Class | Complexity | Deps |
|---|------|--------|------------|------|
| 1 | P0 — Vesting comment + deploy prerequisites | docs + contract (comment) | Low | — |
| 2 | Deployment / preflight invariants | docs + script | Medium | 1 |
| 3 | P1 — Doc + script check (createGrant funding) | docs + script | Low | 1 |
| 4 | P4 — Policy compatibility + deprecation | docs + contract (comment) | Low | — |
| 5 | P5 — Mint vs policy scope | docs | Low | — |
| 6 | P6 — Policy trust boundary | docs | Low | 4 |
| 7 | P3 — CompositePolicy empty-stack guard | contract | Low | — |
| 8 | P7 — VestingContract release() balance require | contract | Low | — |

**Recommended sprint order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (dependencies respected; docs/script first, then contracts).

---

## Dependency graph

```
P0 (1) ──┬──► Deployment invariants (2)
         └──► P1 doc (3)
Deployment invariants (2) ──► (optional: P1 script can call same checks)
P4 (4) ──► P6 (6)  [P6 can reference P4 for "which policies are safe"]
P5 (5), P3 (7), P7 (8) — no dependencies
```

---

## 1. P0 — VestingContract wrong comment + deploy prerequisites

### Class
- **Docs:** New runbook + README link.
- **Contract:** Comment-only change in VestingContract.

### Exact files to edit
- `contracts/VestingContract.sol`
- `docs/deployment-vesting-prerequisites.md` (new file)
- `README.md`
- `scripts/deploy-vesting-esm.js`
- `scripts/deploy-base-sepolia.js` (if present and it deploys vesting)

### Smallest safe patch
- **VestingContract.sol:** Replace the comment block above `release()` (lines 134–136). Remove “set as the admin of EquityToken” and “mint call.” New text: (i) this contract **transfers** from its own balance to the employee; (ii) token admin must **mint to this contract** so it holds sufficient balance for releases; (iii) **this contract’s address must be set to verified** in the IdentityRegistry so `EquityToken.transfer()` succeeds when this contract is the sender. Optionally add a short contract-level NatSpec note at the top of the file with the same three points.
- **docs/deployment-vesting-prerequisites.md:** Create with a single “Vesting deployment prerequisites” section: (1) Deploy VestingContract; (2) Call `IdentityRegistry.setStatus(vestingContractAddress, 1)`; (3) Mint to `vestingContractAddress` via EquityToken (at least the sum of grant totals or fund as needed). Add 2–3 sentences each. No code blocks required; contract and function names are enough.
- **README.md:** In the “Repository structure” or “Key components” / deployment section, add one line: “Before using vesting, complete the steps in [Vesting deployment prerequisites](docs/deployment-vesting-prerequisites.md).”
- **scripts/deploy-vesting-esm.js:** After the deploy (e.g. after `console.log` of the vesting address), add a comment block or single `console.log` reminding: “Post-deploy: set IdentityRegistry.setStatus(vestingAddress, 1) and mint tokens to vestingAddress.”
- **scripts/deploy-base-sepolia.js:** If this file deploys VestingContract, add the same reminder comment or log as above.

### Implementation complexity
**Low.** One comment block replacement, one new short doc, one README line, one or two deploy-script reminders. No logic changes.

### Dependencies
None. Do first.

---

## 2. Deployment / preflight invariants

### Class
- **Docs:** New invariants document.
- **Script:** New optional preflight script (read-only checks).

### Exact files to edit
- `docs/deployment-invariants.md` (new file)
- `scripts/ops/preflight-invariants.mjs` (new file, optional)
- `README.md`

### Smallest safe patch
- **docs/deployment-invariants.md:** Create with five invariants in a fixed format. For each: **Invariant** (one sentence), **Check** (exact call or condition, e.g. `IdentityRegistry.getStatus(vestingAddress) == 1`), **When** (when to run). Invariants: (1) Vesting — identity (VestingContract verified in IdentityRegistry); (2) Vesting — funding (vesting balance ≥ sum of grant totals minus released); (3) Token — policy set (EquityTokenV2.transferPolicy() != 0); (4) Composite — non-empty (CompositePolicy.policyCount() > 0); (5) Transparency anchor — authority (post-P2; “only designated anchorer can call anchorLogRoot”). Add a short intro and a “Checklist” subsection: “Before/after deploy and before createGrant: run preflight script or verify each invariant manually; see [Vesting prerequisites](docs/deployment-vesting-prerequisites.md) for vesting steps.”
- **scripts/ops/preflight-invariants.mjs:** New script. Accept (env or args): RPC URL, chain id, and contract addresses (vesting, identityRegistry, token [EquityToken or EquityTokenV2], compositePolicy [optional], transparencyAnchor [optional]). Read-only: for each invariant that has addresses provided, run the check (e.g. `registry.read.getStatus([vestingAddress])`, `token.read.balanceOf([vestingAddress])`). If any check fails, log and exit(1). No tx sending. Skip invariants whose addresses are not provided. Keep under ~80–100 lines; use viem or existing repo client pattern.
- **README.md:** In the same place as the P0 link, add: “See [Deployment invariants](docs/deployment-invariants.md) for required post-deploy checks and optional preflight script.”

### Implementation complexity
**Medium.** Doc is low (structured list). Script is medium: new file, multiple contract reads, env/arg parsing, clear exit semantics. Optional: if script is deferred, complexity is Low (doc only).

### Dependencies
Depends on **P0** so that “Vesting prerequisites” exists and can be linked from the invariants doc.

---

## 3. P1 — Doc + script check for createGrant funding

### Class
- **Docs:** Add funding requirement to existing vesting/prerequisites doc.
- **Script:** Add optional read-only check in create-grant script.

### Exact files to edit
- `docs/deployment-vesting-prerequisites.md` (created in P0)
- `docs/deployment-invariants.md` (created in step 2; optional cross-reference only)
- `scripts/ops/grants/create-grant.mjs`

### Smallest safe patch
- **docs/deployment-vesting-prerequisites.md:** Add a “Funding before createGrant” subsection: “Before or immediately after each createGrant, the token admin must ensure VestingContract holds at least the new grant’s total (or at least the sum of all grant totals). Otherwise release() will revert with insufficient balance.” One short paragraph.
- **scripts/ops/grants/create-grant.mjs:** After building the grant args and before encoding/sending the tx (e.g. after the block where `total`, `vesting`, `registry` are set), add a read-only check: resolve token address from the vesting contract (read `token()` from VestingContract ABI if available, or accept `--token` / env TOKEN). Then `balance = await pc.readContract({ address: tokenAddress, abi: balanceOfFragment, functionName: "balanceOf", args: [vesting] })`. If `balance < total`, `console.warn` or `die` with a clear message (e.g. “Insufficient vesting contract balance: need at least <total>, have <balance>”). Use `--no-send`-style behavior if desired: when `--no-send`, still run the check. Smallest patch: add ~15–25 lines (token read + compare + message). If token address is not easily available from vesting, document that operator must ensure funding and optionally add the check when TOKEN env is set.

### Implementation complexity
**Low.** Doc addition is a few lines. Script change is a single read + comparison + exit/warn; complexity is low if token address is available from vesting or env.

### Dependencies
Depends on **P0** (so `docs/deployment-vesting-prerequisites.md` exists) and preferably **step 2** (invariants doc exists; P1 doc can reference “Vesting — funding” invariant).

---

## 4. P4 — Policy compatibility + deprecation comments

### Class
- **Docs:** New policy compatibility doc.
- **Contract:** Comment-only in two policy contracts.

### Exact files to edit
- `docs/policy-compatibility.md` (new file)
- `contracts/policies/EmergencyFreezePolicyV1.sol`
- `contracts/policy/CompositePolicyV11.sol`
- `README.md` (optional: one-line link)

### Smallest safe patch
- **docs/policy-compatibility.md:** Create with: (a) “EquityTokenV2 and CompositePolicy (main) use the 4-arg interface: `canTransfer(address token, address from, address to, uint256 amount)`.” (b) “Compatible implementations: ComplianceGatedPolicyV1, MinAmountPolicyV1, EmergencyFreezePolicyV2, CompositePolicy, CompositePolicyV111.” (c) “Not compatible with EquityTokenV2 / as child of CompositePolicy: EmergencyFreezePolicyV1 (uses `checkTransfer(from, to, amount)`), CompositePolicyV11 (3-arg `canTransfer`). Use EmergencyFreezePolicyV2 and CompositePolicyV111 instead.” One page or less.
- **EmergencyFreezePolicyV1.sol:** At the top (after SPDX and pragma), add a NatSpec or comment: “@notice Not compatible with EquityTokenV2 or as child of CompositePolicy (uses 3-arg checkTransfer). Use EmergencyFreezePolicyV2 for token integration.”
- **CompositePolicyV11.sol:** Same style: “@notice Not compatible with EquityTokenV2 (3-arg canTransfer). Use CompositePolicyV111 for token integration.”
- **README.md:** Optional: in compliance or architecture section, add “See [Policy compatibility](docs/policy-compatibility.md) for 4-arg vs 3-arg and which policies to use with EquityTokenV2.”

### Implementation complexity
**Low.** One new short doc, two comment blocks, optional README link. No logic changes.

### Dependencies
None.

---

## 5. P5 — Document mint vs policy scope

### Class
- **Docs** only.

### Exact files to edit
- `README.md` or `docs/process-assumptions.md`

### Smallest safe patch
- Add one short paragraph in the place that describes the token or compliance model. Text: “EquityTokenV2 mint is admin-only and is not gated by the transfer policy; the policy applies only to transfers. Issuers must ensure mints are only to compliant recipients (e.g. verified addresses or the vesting contract).” If using `docs/process-assumptions.md`, add a “Mint vs transfer policy” subsection with the same content. No code changes.

### Implementation complexity
**Low.** One paragraph in one file.

### Dependencies
None.

---

## 6. P6 — Policy trust boundary / replacement risk

### Class
- **Docs** only (governance/runbook optional).

### Exact files to edit
- `docs/process-assumptions.md` or `docs/threat-model.md` or `docs/policy-compatibility.md`
- `docs/governance-invariants.md` or `docs/break-glass-runbook.md` (optional)
- `contracts/EquityTokenV2.sol` (optional: one NatSpec line)
- `contracts/policy/ITransferPolicy.sol` (optional: one NatSpec line)

### Smallest safe patch
- **Primary doc (pick one of process-assumptions, threat-model, policy-compatibility):** Add a “Policy as trust boundary” subsection. State: (i) Whoever can call `setTransferPolicy()` (token admin) can replace the policy with any contract. (ii) A malicious or buggy policy can block all transfers, allow disallowed transfers, or perform state changes/reentrancy (token does not enforce view-only). (iii) Recommend: token admin is a multisig or governed process; only set audited, view-only policies. (iv) Replacing the policy with an untrusted or state-changing contract is a governance/trust violation. 3–5 sentences.
- **Optional governance doc:** In `governance-invariants.md` or `break-glass-runbook.md`, add one bullet or short step: “Policy replacement: must be approved by [X]; only deploy view-only, audited policies; verify policy address and 4-arg interface before setTransferPolicy.”
- **Optional NatSpec:** In EquityTokenV2.sol above `transferPolicy` or in the contract doc: “Transfer policy is a trust boundary; only set audited, view-only policies.” In ITransferPolicy.sol: “Implementations should be view-only; policy replacement is a trust boundary.”

### Implementation complexity
**Low.** One subsection in one doc; optional governance bullet and optional NatSpec. No logic changes.

### Dependencies
Best done after **P4** so “policy compatibility” and “which policies are safe” exist; P6 can reference the same doc.

---

## 7. P3 — CompositePolicy empty-stack guard

### Class
- **Contract** only.

### Exact files to edit
- `contracts/policy/CompositePolicy.sol`

### Smallest safe patch
- In the constructor, immediately after `require(_admin != address(0), "ZeroAdmin");` (or right before the `for` loop), add: `require(initialPolicies.length > 0, "EmptyPolicyStack");`. Remove or adjust the comment “Empty stack is allowed (AND over empty set => true)” so it no longer suggests empty is valid. One line added, one comment removed or updated.

### Implementation complexity
**Low.** Single require; no new storage or interfaces. Existing deployments with non-empty stack unchanged.

### Dependencies
None.

---

## 8. P7 — VestingContract release() balance require

### Class
- **Contract** only.

### Exact files to edit
- `contracts/VestingContract.sol`

### Smallest safe patch
- In `release()`, after `g.released = vested;` and before `token.transfer(employee, unreleased);`, add: `require(token.balanceOf(address(this)) >= unreleased, "InsufficientVestingContractBalance");`. EquityToken already exposes `balanceOf(address)` (view). No other changes. This gives a clear revert reason when the vesting contract is underfunded.

### Implementation complexity
**Low.** One require; no new state or external calls beyond the existing token interface. Success paths unchanged.

### Dependencies
None.

---

## Summary: files touched by classification

### Docs only
- `docs/deployment-vesting-prerequisites.md` (new) — P0, P1
- `docs/deployment-invariants.md` (new) — step 2
- `docs/policy-compatibility.md` (new) — P4, P6
- `README.md` — P0, step 2, P4 optional, P5
- `docs/process-assumptions.md` — P5, P6
- `docs/threat-model.md` or `docs/governance-invariants.md` or `docs/break-glass-runbook.md` — P6 optional

### Script only
- `scripts/ops/preflight-invariants.mjs` (new) — step 2
- `scripts/ops/grants/create-grant.mjs` — P1
- `scripts/deploy-vesting-esm.js` — P0
- `scripts/deploy-base-sepolia.js` — P0 (if it deploys vesting)

### Contract only (comment or logic)
- `contracts/VestingContract.sol` — P0 (comment), P7 (require)
- `contracts/policy/CompositePolicy.sol` — P3 (require)
- `contracts/policies/EmergencyFreezePolicyV1.sol` — P4 (comment)
- `contracts/policy/CompositePolicyV11.sol` — P4 (comment)
- `contracts/EquityTokenV2.sol` — P6 (optional NatSpec)
- `contracts/policy/ITransferPolicy.sol` — P6 (optional NatSpec)

---

## Execution order (single developer)

1. **P0** — VestingContract comment + `docs/deployment-vesting-prerequisites.md` + README link + deploy script reminders.
2. **Deployment invariants** — `docs/deployment-invariants.md` + optional `scripts/ops/preflight-invariants.mjs` + README link.
3. **P1** — Funding subsection in vesting prereqs + balance check in `create-grant.mjs`.
4. **P4** — `docs/policy-compatibility.md` + deprecation comments in EmergencyFreezePolicyV1 and CompositePolicyV11 + optional README link.
5. **P5** — One paragraph (mint vs policy) in README or process-assumptions.
6. **P6** — “Policy trust boundary” subsection + optional governance bullet + optional NatSpec.
7. **P3** — One require in CompositePolicy constructor.
8. **P7** — One require in VestingContract.release().

No code has been written in this sprint plan; implement the patches above in the listed files.
