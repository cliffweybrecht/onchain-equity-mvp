# Phase 8.4.C Break Test A — Execution Plan: release → revokeGrant (Same-Tx)

## State going in (confirmed on-chain, block ~39707000)

| Field | Value |
|---|---|
| beneficiary | `0x1d3854fd3c70540A38918aD9C54303d1e0E31e20` |
| isVerified | `false` (status=0) — must be set first |
| grant.exists | `false` |
| vesting.admin | `0x1eDc758579C66967C42066e8dDCB690a1651517e` (Safe) |
| registry.admin | `0x1eDc758579C66967C42066e8dDCB690a1651517e` (Safe) |

## Grant parameters (same window as Case 2)

| Field | Value | Human |
|---|---|---|
| total | `1000` | 1000 tokens |
| start | `1759547342` | 2025-10-04T03:09:02Z (~180+ days ago) |
| cliff | `1767323342` | 2026-01-02T03:09:02Z (~90+ days ago — past) |
| duration | `31536000` | 365 days |
| end | `1791083342` | 2026-10-04T03:09:02Z (~185 days from now) |

**Active vesting window invariant:** cliff is in the past, end is in the future. Any MultiSend execution now
satisfies `cliff ≤ revokedAt < end`, producing `0 < vested < 1000`.

**Vested estimate at execution:** `floor(1000 × elapsed / 31536000)` ≈ **495–496 tokens** (same window as Case 2,
~1 day later). Exact value from GrantRevoked event.

---

## Safe Transaction 0 of 3: setStatus (verify beneficiary)

**To:** `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4` (IdentityRegistry)  
**Function:** `setStatus(address,uint8)`  
**Calldata:** `0x278e07ce0000000000000000000000001d3854fd3c70540a38918ad9c54303d1e0e31e200000000000000000000000000000000000000000000000000000000000000001`

### Safe UI steps

1. Open: `https://app.safe.global/home?safe=basesep:0x1eDc758579C66967C42066e8dDCB690a1651517e`
2. New transaction → Contract interaction
3. Contract: `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4`
4. ABI:
   ```json
   [{"type":"function","name":"setStatus","stateMutability":"nonpayable","inputs":[{"name":"user","type":"address"},{"name":"newStatus","type":"uint8"}],"outputs":[]}]
   ```
5. Function: `setStatus`
6. Args: `user=0x1d3854fd3c70540A38918aD9C54303d1e0E31e20`, `newStatus=1`
7. Selector check: `0x278e07ce`
8. Submit → sign → execute

**Expected event:** `StatusUpdated(user=0x1d3854fd3c70540A38918aD9C54303d1e0E31e20, previousStatus=0, newStatus=1)`

### After confirms — report back tx hash

---

## Safe Transaction 1 of 3: createGrant

**To:** `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` (VestingContract)  
**Function:** `createGrant(address,uint256,uint64,uint64,uint64)`  
**Calldata:**
```
0x637096e6
0000000000000000000000001d3854fd3c70540a38918ad9c54303d1e0e31e20
00000000000000000000000000000000000000000000000000000000000003e8
0000000000000000000000000000000000000000000000000000000068e08fce
00000000000000000000000000000000000000000000000000000000695736ce
0000000000000000000000000000000000000000000000000000000001e13380
```

### Safe UI steps

1. New transaction → Contract interaction
2. Contract: `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08`
3. ABI:
   ```json
   [{"type":"function","name":"createGrant","stateMutability":"nonpayable","inputs":[{"name":"employee","type":"address"},{"name":"total","type":"uint256"},{"name":"start","type":"uint64"},{"name":"cliff","type":"uint64"},{"name":"duration","type":"uint64"}],"outputs":[]}]
   ```
4. Function: `createGrant`
5. Args:
   | Arg | Value |
   |---|---|
   | `employee` | `0x1d3854fd3c70540A38918aD9C54303d1e0E31e20` |
   | `total` | `1000` |
   | `start` | `1759547342` |
   | `cliff` | `1767323342` |
   | `duration` | `31536000` |
6. Selector check: `0x637096e6`
7. Submit → sign → execute

**Expected event:** `GrantCreated(employee=0x1d3854fd3c70540A38918aD9C54303d1e0E31e20, total=1000, start=1759547342, cliff=1767323342, duration=31536000)`

### After confirms — report back tx hash

---

## Safe Transaction 2 of 3: MultiSend [release, revokeGrant]

**CRITICAL: Ordering matters. release must be index 0, revokeGrant must be index 1.**

### Safe Transaction Builder steps

1. New transaction → **Transaction Builder**
2. Add **Sub-call 0 (release)**:
   - To: `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08`
   - Value: `0`
   - Data: `0x191655870000000000000000000000001d3854fd3c70540a38918ad9c54303d1e0e31e20`
3. Add **Sub-call 1 (revokeGrant)**:
   - To: `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08`
   - Value: `0`
   - Data: `0x1817c5a70000000000000000000000001d3854fd3c70540a38918ad9c54303d1e0e31e20`
4. Click "Create Batch"
5. Review: confirm 2 transactions, ordering is release first
6. Submit → sign → execute

### What this proves

- `release()` runs first at block.timestamp T: computes `vested_at_T = floor(1000 * (T - 1759547342) / 31536000)`, writes `g.released = vested_at_T`, mints `vested_at_T` tokens.
- `revokeGrant()` runs second at block.timestamp T: reads `g.released` from storage (should observe `vested_at_T` written by preceding sub-call — A2). Emits:
  ```
  GrantRevoked(
    employee: 0x1d3854fd3c70540A38918aD9C54303d1e0E31e20,
    revokedAt: T,
    total: 1000,
    released: vested_at_T,          ← must equal vested_at_T (not 0)
    vested: vested_at_T,
    claimable: 0,                   ← vested == released → nothing left to claim
    canceled: 1000 - vested_at_T
  )
  ```

### Conservation check
`released(vested_at_T) + claimable(0) + canceled(1000 - vested_at_T) = 1000` ✓

### Failure mode
If `claimable > 0`: `revokeGrant` read `g.released = 0` instead of `vested_at_T` — indicates stale storage read (A2 violation or contract bug).

### After confirms — report back tx hash + full GrantRevoked event args

I will:
- Decode GrantRevoked event
- Assert `released == vested_at_T` (not zero)
- Assert `claimable == 0`
- Assert `canceled == 1000 - vested_at_T`
- Verify conservation: `released + claimable + canceled == 1000`
- Verify `vested == floor(1000 * (revokedAt - 1759547342) / 31536000)`
- Write `post-multisend.json` and `verification-summary.json`

---

## Artifact index

| File | Status |
|---|---|
| `case-config.json` | Written |
| `prestate.json` | Written |
| `safe-tx-0-set-verified.json` | Written |
| `safe-tx-1-create-grant.json` | Written |
| `safe-tx-2-multisend-release-revoke.json` | Written |
| `post-set-verified.json` | Pending tx 0 |
| `post-create-grant.json` | Pending tx 1 |
| `post-multisend.json` | Pending tx 2 |
| `verification-summary.json` | Pending tx 2 |
