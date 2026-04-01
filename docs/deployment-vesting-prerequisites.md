# Vesting Deployment Prerequisites

Before using the vesting system, complete these steps after deploying the VestingContract.

## 1. Deploy VestingContract

Deploy the VestingContract with the correct admin, token, and IdentityRegistry addresses (see deploy scripts).

## 2. Set VestingContract as verified in IdentityRegistry

The VestingContract address must be verified so that `EquityToken.transfer()` succeeds when the contract sends tokens on release.

- Call **IdentityRegistry.setStatus(vestingContractAddress, 1)** (1 = verified).
- Only the registry admin can call this.

## 3. Mint / fund the VestingContract

The vesting contract pays out from its own token balance; it does not mint.

- Using **EquityToken**, the token admin must **mint to the VestingContract address**.
- Ensure the vesting contract holds at least the sum of all grant totals (or fund as needed before each grant or release).

Without this, `release()` will revert with insufficient balance.
