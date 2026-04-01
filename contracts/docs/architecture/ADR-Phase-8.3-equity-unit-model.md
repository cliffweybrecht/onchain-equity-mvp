# ADR — Phase 8.3 Equity Unit Model and Claim Event Lineage

## Status
Accepted

## Date
2026-03-10

## Context

Phase 8.2 proved deterministic vesting claim execution and payout reconciliation, but exposed two architectural inconsistencies:

1. Grant quantities were expressed using ERC20-style 18-decimal scaled units.
2. EquityToken declares `decimals = 0`, which implies indivisible integer share units.
3. Claim reconciliation relied on release events and state deltas, but direct `Transfer(from vesting, to beneficiary, amount)` lineage was not yet treated as mandatory evidence.

This created a semantic mismatch between token economics and grant accounting.

## Decision

The repository adopts the following rules:

1. `EquityToken.decimals()` remains `0`.
2. Equity grant quantities MUST be expressed as integer share units only.
3. Vesting math remains integer floor math:
   `vested = floor(total * elapsed / duration)`
   `releasable = vested - released`
4. No 18-decimal scaling is permitted for equity grant quantities.
5. Claim evidence MUST verify direct ERC20 `Transfer` event lineage from the claim transaction receipt.
6. Future lifecycle demonstrations MUST use whole-share grants and deterministic receipt-level event reconciliation.

## Consequences

### Accepted
- The token model remains aligned with whole-share equity semantics.
- Vesting math remains simple and deterministic.
- Auditors can reconcile economic meaning directly from state and event evidence.

### Rejected
- Changing token decimals to 18 in order to preserve prior scaled grant inputs.
- Continuing lifecycle proofs without direct receipt-level `Transfer` verification.
- Treating 18-decimal quantity encoding as acceptable for equity shares.

## Required follow-up
- Audit all grant creation scripts for scaled-unit assumptions.
- Normalize future demo grants to integer share quantities.
- Add deterministic transfer-event verification to claim evidence generation.
- Mark Phase 8.2 as mechanically successful but semantically non-final with respect to quantity model integrity.
