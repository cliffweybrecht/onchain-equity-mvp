# Rail Protocol — Terminology Reference

Strict definitions used throughout this repository. Where a term appears in a commit message, PR description, evidence artifact, or governance document, it carries the meaning defined here.

---

## canonical

A contract instance, artifact, or code path that is **actively maintained, chain-verified, and authoritative** for the current phase. There is exactly one canonical stack at any given time.

At the time of this writing the canonical stack is Phase 8.4.C on Base Sepolia (chain ID 84532).

Antonyms: *parallel experiment*, *legacy*, *deprecated*.

---

## parallel experiment

A contract or code path that **exists in the repository but is not the authoritative implementation**. It may explore features not yet adopted into the canonical stack. It must be clearly labeled in source and documentation.

The `EquityTokenV2` contract and the `IssuanceModule` are parallel experiments as of Phase 8.4.C.

---

## legacy

A component that **was canonical in a prior phase but has been superseded**. Legacy components are retained for audit continuity; they must not be modified.

---

## deprecated

A component that **should not be used and is scheduled for removal**. Unlike legacy, deprecated components carry no audit continuity obligation.

---

## verified

A participant address that has been confirmed by the IdentityRegistry as eligible to receive tokens. Verified status is a precondition for `createGrant`.

On-chain: `IdentityRegistry.isVerified(address) == true`.

---

## reproducible

An artifact is reproducible if **running the documented script against the recorded chain state produces the same bytes**. This repository produces *chain-grounded* artifacts (fetched from Base Sepolia), not locally-simulated ones. Two artifacts are reproducible-equivalent if they reference the same transaction hashes and their decoded values agree.

Do not conflate "reproducible" with "deterministic build output" — CBOR metadata in Solidity bytecode means local recompilation will differ from deployed bytecode.

---

## conservation invariant

`released_before + claimable + canceled = total`

This identity must hold at the moment of every `revokeGrant` call. It is proven per-case in the Phase 8.4.C evidence artifacts.

---

## effective time

The timestamp used by the vesting formula when computing `vestedAmount`. Defined in the VestingContract as:

```
_effectiveTime(g, queryTime):
  if g.revoked && queryTime > g.revokedAt:
    return g.revokedAt
  return queryTime
```

The strict `>` means that when `queryTime == g.revokedAt` (same-block, same-transaction), the cap does not apply. This is the central boundary condition proven by Break Tests A and B in Phase 8.4.C.

---

## cliff

The timestamp before which no tokens have vested. Formally: `vestedAmount(t) = 0` for all `t < cliff`.

---

## vesting window

The period `[cliff, start + duration)` during which tokens vest linearly.

---

## vesting formula

`floor(total * (effectiveTime - start) / duration)`

Applied only when `effectiveTime >= cliff`. Result is zero for `effectiveTime < cliff`.

---

## mint-on-claim

The release mechanism used in the canonical VestingContract. When `release(employee)` is called, the VestingContract calls `token.mint(employee, unreleased)` — no pre-funded token balance is required. The VestingContract is the sole admin of the EquityToken.

---

## Safe (governance)

The Gnosis Safe v1.4.1 instance (`0x1eDc758579C66967C42066e8dDCB690a1651517e` on Base Sepolia) that holds admin authority over the VestingContract and the IdentityRegistry. Currently configured 1-of-1 with owner EOA `0x6C775411e11cAb752Af03C5BBb440618788E13Be`.

---

## MultiSend

The `MultiSendCallOnly` v1.4.1 contract (`0x9641d764fc13c8B624c04430C7356C1C7C8102e2`) used by the Safe to batch multiple calls atomically in a single transaction. The `CallOnly` variant does not forward `DELEGATECALL` (selector `0xf4` is absent from bytecode).

---

## chain-grounded

An artifact is chain-grounded if every claim in it is derived from an on-chain transaction, receipt, log, or storage read — not from local simulation. Chain-grounded artifacts reference block hashes and transaction hashes that can be independently verified via any Base Sepolia RPC endpoint.

---

## phase

A named experimental period corresponding to a specific canonical stack deployment and evidence campaign. Phases are numbered (e.g., 7.7.3, 8.4.B.B, 8.4.C). Evidence artifacts are organized under `contracts/evidence/phase-X/`.

---

## grant

A vesting allocation created by `VestingContract.createGrant(employee, total, start, cliff, duration)`. A grant is a struct stored in the VestingContract mapping `grants(address)`. Once revoked, a grant cannot be re-granted to the same address on the same contract instance.

---

## revocation

The irreversible termination of a grant's future vesting via `revokeGrant(employee)`. At the moment of revocation, the vesting formula is frozen at `revokedAt`. Any accrued but unreleased tokens remain claimable; the remainder is canceled.

---

## A2 assumption

The EVM invariant that within a single transaction, `SSTORE` writes are immediately visible to subsequent `SLOAD` instructions. This is not a Rail-specific assumption — it is a property of the EVM specification. Break Tests A and B in Phase 8.4.C produce evidence consistent with A2.
