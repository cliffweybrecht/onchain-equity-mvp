# Remediation Plan — Security Findings (Revised)

This document turns the identified high-risk smart contract findings into a prioritized remediation plan. For each issue: (1) fix type, (2) minimum safe patch, (3) breaking vs non-breaking, (4) urgency rank, (5) exact files affected.

**Revision:** P6 reframed as policy trust-boundary / arbitrary policy replacement risk; added future hardening for aggregate vesting reserve; added formal deployment/preflight invariants; implementation order re-ranked for fastest real-world risk reduction.

---

## Urgency ranking (executive summary)

| Rank | Issue | Fix type | Breaking? |
|------|--------|----------|-----------|
| P0 | VestingContract wrong comment + deploy prerequisites | Documentation + Deployment | Non-breaking |
| P1 | VestingContract createGrant unfunded grants | Documentation + Code/script (optional) | Non-breaking (doc/script); Breaking (if strict on-chain check) |
| P2 | TransparencyLogAnchor permissionless | Code | Breaking (new deploy) |
| P3 | CompositePolicy empty stack | Code | Non-breaking |
| P4 | Policy ABI mismatch (3-arg vs 4-arg) | Documentation + Code (optional) | Non-breaking |
| P5 | EquityTokenV2 mint bypasses policy | Documentation or Code | Non-breaking (doc) / Breaking (if policy on mint) |
| P6 | **Policy trust boundary / arbitrary policy replacement** | Documentation + Governance | Non-breaking |
| P7 | release() balance diagnostics | Code | Non-breaking |

---

## Implementation order (fastest real-world risk reduction)

Order is chosen to maximize risk reduction with minimal deployment dependency: doc and operational fixes first, then code that affects only new deployments or is backward-compatible.

| Step | Item | Rationale |
|------|------|-----------|
| 1 | **P0** — Vesting comment + deploy prerequisites | No redeploy; fixes silent release failure for existing and new setups. |
| 2 | **Deployment / preflight invariants** (new section) | Single source of truth for what must hold at deploy and at runtime; enables automated checks. |
| 3 | **P1** — Doc + script check for createGrant funding | No redeploy; prevents unfunded grants via process and optional script. |
| 4 | **P4** — Policy compatibility doc + deprecation comments | No redeploy; prevents wrong policy wiring on next deploy or config change. |
| 5 | **P5** — Document mint vs policy scope | No redeploy; clarifies compliance boundary. |
| 6 | **P6** — Policy trust boundary / policy replacement risk (reframed) | Doc + governance; defines who may replace policy and consequences. |
| 7 | **P7** — VestingContract release() balance require | Code; improves diagnostics on next vesting deploy or upgrade. |
| 8 | **P3** — CompositePolicy empty-stack guard | Code; only affects new CompositePolicy deploys. |
| 9 | **P2** — TransparencyLogAnchor access control | Code; requires new anchor deploy; schedule when anchoring is production-critical. |
| — | **Future** — Aggregate vesting reserve accounting | See “Future hardening” section. |

---

## Deployment / preflight invariants (formal)

This section defines invariants that **must hold** at deployment and at runtime for the system to behave as intended. Preflight checks (read-only scripts or runbooks) should verify these before and after deploy and before sensitive ops (e.g. createGrant, anchor).

### Invariants

1. **Vesting — identity**
   - **Invariant:** The VestingContract address is verified in the IdentityRegistry (status == 1) when using EquityToken.
   - **Check:** `IdentityRegistry.getStatus(vestingContractAddress) == 1` (or `isVerified(vestingContractAddress) == true`).
   - **When:** After deploying VestingContract; before first `createGrant` or `release` on a new chain.

2. **Vesting — funding**
   - **Invariant:** VestingContract token balance is at least the sum of `(grant.total - grant.released)` over all existing grants (or at least the total of any new grant being created).
   - **Check:** `EquityToken.balanceOf(vestingContractAddress) >= sum_over_grants(total - released)` (or for createGrant: `>= currentReserve + newGrantTotal`).
   - **When:** Before or immediately after each `createGrant`; optionally in a periodic health check.

3. **Token — policy set**
   - **Invariant:** EquityTokenV2 has a non-zero transfer policy address that implements the 4-arg `canTransfer(token, from, to, amount)` interface.
   - **Check:** `EquityTokenV2.transferPolicy() != address(0)`; optional: static or runtime check that the contract at that address has the correct selector.
   - **When:** After deploying or updating EquityTokenV2.

4. **Composite policy — non-empty**
   - **Invariant:** CompositePolicy (and any composite used as the token’s policy) has at least one child policy.
   - **Check:** `CompositePolicy.policyCount() > 0` (or equivalent).
   - **When:** After deploying CompositePolicy; before setting it as the token’s transfer policy.

5. **Transparency anchor — authority (post-P2)**
   - **Invariant:** Only the designated anchorer (or multisig) can call `anchorLogRoot` on the TransparencyLogAnchor.
   - **Check:** Contract has access control and anchorer is set; ops use the correct key/signer for anchoring.
   - **When:** After deploying a new TransparencyLogAnchor with access control.

### Deliverables

- **Document:** Add a section (e.g. in `docs/deployment-vesting-prerequisites.md` or new `docs/deployment-invariants.md`) that lists the above invariants, the exact checks, and when to run them.
- **Script (optional):** A single preflight script (e.g. `scripts/ops/preflight-invariants.mjs` or similar) that takes chain and contract addresses and runs the read-only checks, exiting non-zero if any invariant fails. Same checks can be used in CI or before deploy steps.
- **Checklist:** A short deployment/runbook checklist that references the doc and script so operators never skip verification.

### Files likely affected

- New or updated: `docs/deployment-invariants.md` (or equivalent).
- New or updated: `docs/deployment-vesting-prerequisites.md` / runbook.
- New (optional): `scripts/ops/preflight-invariants.mjs` (or `scripts/deploy/verify-invariants.mjs`).
- `README.md` (link to deployment invariants and preflight).

---

## P0 — VestingContract: wrong comment and missing deploy prerequisites

**Finding:** Comment says vesting contract must be “admin” and use “mint”; code uses `transfer`. VestingContract must (a) hold tokens (minted to it) and (b) be verified in IdentityRegistry for releases to succeed.

### 1. Fix type
- **Documentation fix** (comment + deploy/runbook).
- **Deployment fix** (checklist: mint to vesting, set vesting address verified).

### 2. Minimum safe patch
- **Code:** Correct the NatSpec/comment in `VestingContract.sol` to state that (i) the contract **transfers** from its own balance (does not mint), (ii) the token admin must **mint to the VestingContract** so it holds the grant total (or sufficient balance over time), and (iii) the **VestingContract address must be set to verified** in the IdentityRegistry so `EquityToken.transfer()` succeeds when the contract is the sender.
- **Documentation:** Add a “Vesting deployment prerequisites” section (e.g. in README or a runbook) listing: (1) Deploy VestingContract; (2) On IdentityRegistry, call `setStatus(vestingContractAddress, 1)`; (3) On EquityToken, mint to `vestingContractAddress` (at least the sum of grant totals that will be created, or fund as needed).
- **Deployment:** Align with the formal **Deployment / preflight invariants** section (vesting identity + funding); add a preflight or checklist step that verifies the vesting contract is verified and has sufficient token balance (or document that operators must do this manually).

### 3. Breaking or non-breaking?
**Non-breaking.** No contract interface or behavior change; only comments and deploy/docs. Existing deployments can be fixed operationally (mint to vesting + set status) without redeploy.

### 4. Urgency
**P0** — Incorrect setup silently breaks all releases; doc/deploy fix prevents misconfiguration immediately.

### 5. Files likely affected
- `contracts/VestingContract.sol` (comment block above `release()` and/or at top of contract).
- `README.md` or new `docs/deployment-vesting-prerequisites.md` (or `docs/runbook-vesting.md`).
- Deploy script(s) that deploy vesting — add a comment or log reminding to set status and mint.
- `scripts/ops/grants/create-grant.mjs` — optional: read-only check or log that vesting contract is verified and has balance ≥ grant total before sending `createGrant`.

---

## P1 — VestingContract: createGrant allows unfunded grants

**Finding:** `createGrant()` does not ensure the vesting contract has (or will have) token balance; grants can be created that can never be released.

### 1. Fix type
- **Code fix** (optional balance check or explicit revert with clear reason).
- **Documentation fix** (state that issuer must fund the vesting contract before or immediately after creating grants).

### 2. Minimum safe patch
- **Option A (non-breaking, recommended):** Add a **documentation** requirement: “Before or immediately after createGrant, the token admin must ensure VestingContract holds at least the sum of all grant totals (or the new grant total).” Reference the **Deployment / preflight invariants** (vesting funding). Optionally add a **read-only** check in an ops script (e.g. `create-grant.mjs`) that warns or fails the script if `token.balanceOf(vesting) < total` for the new grant (no on-chain change).
- **Option B (code, potentially breaking):** In `createGrant()`, add a require that `token.balanceOf(address(this)) >= total` (or `>= existingReserve + total` if reserving for multiple grants). This is **breaking** if the current workflow is “create grant first, mint later.” Minimum **safe** patch is: **documentation + optional script check**; code check only if the project accepts “mint before createGrant” as the only supported flow.

Recommendation: **Documentation + script check** as minimum; code check as follow-up if product accepts the stricter invariant.

### 3. Breaking or non-breaking?
- Doc + script check: **Non-breaking.**
- On-chain balance require in `createGrant`: **Breaking** for any deployment that creates grants before funding.

### 4. Urgency
**P1** — Prevents operational mistakes that leave grants unfulfillable; doc/script gives immediate benefit.

### 5. Files likely affected
- `contracts/VestingContract.sol` (only if Option B: add require and ensure token exposes `balanceOf(address)`).
- `docs/deployment-vesting-prerequisites.md` or `docs/deployment-invariants.md` (document funding requirement).
- `scripts/ops/grants/create-grant.mjs` (optional: read balance of vesting, compare to grant total, warn or exit if insufficient).

---

## P2 — TransparencyLogAnchor: permissionless anchoring

**Finding:** Any address can call `anchorLogRoot()`; attackers can anchor fake roots and undermine transparency guarantees.

### 1. Fix type
**Code fix** (access control on the anchor contract).

### 2. Minimum safe patch
- Add an **owner or allowed anchorer** address (or list) and require `msg.sender == anchorer` (or has role) in `anchorLogRoot()`. Set anchorer in constructor (e.g. deployer or a multisig/Safe address). Add `setAnchorer(address)` or `setOwner(address)` with only-owner so governance can rotate.
- **No change** to `getAnchor()` or to the shape of stored data; only gate who can call `anchorLogRoot()`.

### 3. Breaking or non-breaking?
**Breaking** for existing deployments: current contract has no owner; adding access control requires deploying a **new** TransparencyLogAnchor and using it for future anchors (old one remains permissionless). Existing anchored roots remain valid; only **future** anchors are restricted.

### 4. Urgency
**P2** — High impact on trust in “official” checkpoints; implement when anchors are used for production assurance; can follow doc and non-anchor code fixes.

### 5. Files likely affected
- `contracts/audit/TransparencyLogAnchor.sol` (add state: `address public anchorer` or `owner`, modifier, constructor arg, optional setter).
- `scripts/deploy/deploy-transparency-anchor.mjs` (pass anchorer/owner address to constructor).
- `scripts/ops/grants/anchor-transparency-log-root.mjs` (ensure signer is the designated anchorer).

---

## P3 — CompositePolicy: empty stack allows all transfers

**Finding:** Deploying CompositePolicy with an empty `initialPolicies` array results in all transfers being allowed (AND over empty set = true).

### 1. Fix type
**Code fix.**

### 2. Minimum safe patch
- In `CompositePolicy` constructor, require `initialPolicies.length > 0` (e.g. `require(initialPolicies.length > 0, "EmptyPolicyStack")`). Optionally add the same check when a removal would leave the stack empty. Minimum: **constructor guard only** so that no new deployment can be created with an empty stack.

### 3. Breaking or non-breaking?
**Non-breaking** for any existing deployment that already uses a non-empty stack. **Breaking** only for the (mis)use case of “deploy with empty list.”

### 4. Urgency
**P3** — Prevents accidental or malicious “no compliance” deployment; applies to new CompositePolicy deploys only.

### 5. Files likely affected
- `contracts/policy/CompositePolicy.sol` (constructor: add `require(initialPolicies.length > 0, "EmptyPolicyStack");` or equivalent).

---

## P4 — Policy ABI mismatch (3-arg vs 4-arg)

**Finding:** EmergencyFreezePolicyV1 and CompositePolicyV11 use 3-arg `canTransfer(from, to, amount)` or `checkTransfer(from, to, amount)`; EquityTokenV2 and CompositePolicy (main) use 4-arg `canTransfer(token, from, to, amount)`. Mixing them causes wrong selector or revert.

### 1. Fix type
**Documentation fix** (primary). **Code fix** (optional: deprecate or align interfaces).

### 2. Minimum safe patch
- **Documentation:** In a single “Policy integration” or “Compatibility” doc (or README), state clearly:
  - EquityTokenV2 and the main CompositePolicy expect the **4-arg** interface: `canTransfer(address token, address from, address to, uint256 amount)`.
  - List which contracts implement it: e.g. ComplianceGatedPolicyV1, MinAmountPolicyV1, EmergencyFreezePolicyV2, CompositePolicy, CompositePolicyV111.
  - List which do **not** and must not be used with EquityTokenV2 or as children of CompositePolicy: EmergencyFreezePolicyV1 (uses `checkTransfer`), CompositePolicyV11 (3-arg `canTransfer`).
- **Code (optional):** Add NatSpec or comments on EmergencyFreezePolicyV1 and CompositePolicyV11: “Not compatible with EquityTokenV2; use EmergencyFreezePolicyV2 / CompositePolicyV111.” Consider marking V1/V11 as deprecated in comments.

### 3. Breaking or non-breaking?
**Non-breaking.** No change to existing correct deployments; only prevents future misconfiguration.

### 4. Urgency
**P4** — Reduces risk of broken production or emergency-freeze wiring; doc-only gives immediate benefit.

### 5. Files likely affected
- `README.md` or new `docs/policy-compatibility.md` (or `docs/compliance-policy-layer.md`).
- `contracts/policies/EmergencyFreezePolicyV1.sol` (NatSpec/deprecation comment).
- `contracts/policy/CompositePolicyV11.sol` (NatSpec/deprecation comment).
- `contracts/policy/ITransferPolicy.sol` (optional: note that EquityTokenV2 uses the 4-arg form; reference doc).

---

## P5 — EquityTokenV2: mint bypasses policy

**Finding:** `mint()` is admin-only and does not call the transfer policy; compliance is enforced only on `transfer()`.

### 1. Fix type
**Documentation fix** (minimum). **Code fix** (optional: enforce policy on mint).

### 2. Minimum safe patch
- **Documentation (minimum):** State explicitly that “Mint is admin-only and is not gated by the transfer policy; policy applies only to transfers. Issuers must ensure mints are only to compliant recipients (e.g. verified addresses or vesting contract).” Add to README or token/policy doc.
- **Code (optional):** If the product requirement is “policy must apply to who can receive newly minted tokens,” add a call to `transferPolicy.canTransfer(address(this), address(0), to, amount)` (or equivalent) inside `mint()` and revert if false. This is **breaking** if current ops mint to addresses that would fail the policy.

Recommendation: **Documentation** first; code only if product explicitly requires policy-on-mint.

### 3. Breaking or non-breaking?
- Doc-only: **Non-breaking.**
- Policy check in `mint()`: **Breaking** for any flow that mints to an address not allowed by the policy.

### 4. Urgency
**P5** — Clarifies compliance boundary; doc-only is fast.

### 5. Files likely affected
- `README.md` or `docs/process-assumptions.md` / compliance doc (document mint vs transfer policy scope).
- `contracts/EquityTokenV2.sol` (only if adding policy check in `mint()`).

---

## P6 — Policy trust boundary / arbitrary policy replacement risk (reframed)

**Finding:** The token’s transfer policy is a **trust boundary**. Whoever can call `setTransferPolicy()` (the token admin) can replace the policy with an arbitrary contract. A malicious or buggy policy can (a) block all transfers, (b) allow transfers that should be restricted, or (c) perform state changes or reentrancy during `canTransfer` (the token does not enforce that the policy is view-only). There is no on-chain constraint on *who* can replace the policy or *what* the new policy does—only the admin’s key (or multisig) controls this. Risk is therefore **policy replacement and trust in the admin**, not merely “view is not enforced at runtime.”

### 1. Fix type
- **Documentation fix** (trust boundary, who may replace policy, consequences of a bad policy).
- **Governance / runbook** (who holds admin, how policy changes are approved, that only audited/view-only policies should be set).

### 2. Minimum safe patch
- **Documentation:** In the policy/token documentation (and optionally in NatSpec for EquityTokenV2 and ITransferPolicy):
  - State that the **transfer policy is a trust boundary**: the token admin can replace it with any contract; the token does not restrict what that contract does (including state changes or reentrancy).
  - Describe the consequences of a malicious or buggy policy: full transfer denial, inappropriate allowance, or loss/inconsistency.
  - Recommend that (i) token admin be a multisig or governed process, and (ii) only audited, view-only policies be set; document that replacing the policy with an untrusted or state-changing contract is a governance/trust violation.
- **Governance / runbook:** Add a short runbook or checklist: “Policy replacement must be approved by [X]; only deploy policies that are view-only and audited; verify policy address and interface before calling setTransferPolicy.”

### 3. Breaking or non-breaking?
**Non-breaking.** No contract or interface change; only documentation and process.

### 4. Urgency
**P6** — Clarifies trust model and reduces risk of inappropriate or malicious policy replacement; doc and governance can be done early.

### 5. Files likely affected
- `docs/process-assumptions.md` or `docs/policy-compatibility.md` or `docs/threat-model.md` (trust boundary, policy replacement, view-only recommendation).
- `docs/governance-invariants.md` or `docs/break-glass-runbook.md` (optional: policy change procedure).
- `contracts/EquityTokenV2.sol` (optional: one-line NatSpec on `transferPolicy` / trust boundary).
- `contracts/policy/ITransferPolicy.sol` (optional: note that implementers should not modify state and that policy is a trust boundary).

---

## P7 — VestingContract release(): no explicit balance check

**Finding:** If the vesting contract has insufficient token balance, `release()` fails with the token’s generic revert; no in-contract message that the failure is due to “vesting contract not funded.”

### 1. Fix type
**Code fix** (diagnostic only).

### 2. Minimum safe patch
- In `VestingContract.release()`, before `token.transfer(employee, unreleased)`, add:
  - `require(token.balanceOf(address(this)) >= unreleased, "InsufficientVestingContractBalance");`
  - (or equivalent using the actual token type — VestingContract uses `EquityToken` which has `balanceOf`). This gives a clear revert reason. No change to success paths; only earlier, clearer failure when balance is insufficient.

### 3. Breaking or non-breaking?
**Non-breaking.** Same behavior when balance is sufficient; when insufficient, revert reason is vesting-specific.

### 4. Urgency
**P7** — Improves diagnostics and ops debugging; implement on next vesting deploy or upgrade.

### 5. Files likely affected
- `contracts/VestingContract.sol` (one `require` before `token.transfer`; ensure `EquityToken` exposes `balanceOf(address)`).

---

## Future hardening: aggregate vesting reserve accounting

**Item:** Add **aggregate vesting reserve accounting** across all outstanding grants so that the system can enforce or at least observe the invariant: “VestingContract token balance ≥ total unreleased amount across all grants.”

### Purpose
- **Enforce (optional):** In `createGrant()`, require that after the new grant, `balanceOf(vesting) >= totalReserve()` (or equivalent), so that unfunded grants cannot be created.
- **Observe (minimum):** Expose a view such as `totalUnreleased()` or `requiredReserve()` that sums over all grants `(grant.total - grant.released)`, so that operators and preflight scripts can check `balanceOf(vesting) >= totalUnreleased()` without iterating off-chain over an unbounded set.

### Minimum safe patch (observation only, non-breaking)
- Add a view function (e.g. `totalUnreleased() returns (uint256)`) that iterates over a bounded set of beneficiaries (e.g. a stored array of grant recipients) and returns the sum of `(grants[beneficiary].total - grants[beneficiary].released)`. If the contract does not currently maintain an enumerable list of beneficiaries, this would require adding one (e.g. on `createGrant`, push to an array) and is a small contract change.
- Document that “required reserve” = this value and that preflight should check `token.balanceOf(vesting) >= totalUnreleased()`.

### Stronger option (enforcement, potentially breaking)
- In `createGrant()`, require `token.balanceOf(address(this)) >= totalUnreleased() + total` (or maintain a single `totalReserved` counter updated on createGrant and release). This is **breaking** if the current workflow is “create grant first, mint later.”

### Files likely affected
- `contracts/VestingContract.sol` (add beneficiary list if not present; add `totalUnreleased()` view; optionally add reserve check in `createGrant()`).
- `docs/deployment-invariants.md` (document reserve invariant and use of `totalUnreleased()` in preflight).
- `scripts/ops/preflight-invariants.mjs` (or equivalent) — use `totalUnreleased()` when available for vesting funding check.

### Priority
**Future** — After P0–P7 and deployment invariants are in place; implement when the project is ready to add vesting contract state (beneficiary list) and/or stricter createGrant invariants.

---

## Summary table: fix type and breaking impact

| Issue | Primary fix type | Secondary | Breaking? |
|-------|------------------|------------|-----------|
| P0 Vesting comment + prerequisites | Documentation, Deployment | — | No |
| P1 Unfunded grants | Documentation, (Code optional) | Deployment/script | No (doc/script); Yes if strict code check |
| P2 Anchor permissionless | Code | Deployment (new contract) | Yes (new anchors only) |
| P3 Empty policy stack | Code | — | No |
| P4 Policy ABI mismatch | Documentation | Code (comments) | No |
| P5 Mint bypasses policy | Documentation | Code (optional) | No (doc); Yes if enforce on mint |
| P6 Policy trust boundary / replacement | Documentation, Governance | — | No |
| P7 release() balance message | Code | — | No |
| Deployment / preflight invariants | Documentation, (Script optional) | — | No |
| Future: Aggregate vesting reserve | Code | Documentation, Script | No (view only); Yes if enforce in createGrant |

This plan is intended to be implemented without writing new code in this step; the next step is to apply the patches in the listed files per the descriptions above.
