# Phase 8.3 Invariants

The following invariants are mandatory for the on-chain equity MVP:

## Quantity model
- Equity token decimals MUST be `0`
- Grant totals MUST be integer share counts
- Example valid totals:
  - `1`
  - `10`
  - `100`
- Example invalid total:
  - `1000000000000000000`

## Vesting math
- Vesting uses integer floor math only
- Formula:
  - `vested = floor(total * elapsed / duration)`
  - `releasable = vested - released`

## Claim audit requirements
A valid claim audit MUST reconcile:
- vesting release event amount
- released state delta
- beneficiary token balance delta
- ERC20 `Transfer(from vesting, to beneficiary, value)` from the same receipt

## Prohibited assumptions
- No wei-style scaling for equity shares
- No inferred transfer success without direct receipt log verification
- No future lifecycle demo using scaled 18-decimal grant quantities
