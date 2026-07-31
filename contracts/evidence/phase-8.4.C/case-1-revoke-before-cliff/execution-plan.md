# Phase 8.4.C Case 1 — Execution Plan: Revoke Before Cliff

## State going in (confirmed on-chain, block 39664674)

| Field | Value |
|---|---|
| beneficiary | `0x7d5A7b3061880c36D69127a4eB8293880b1eD90A` |
| isVerified | `true` (status=1) |
| grant.exists | `false` |
| vesting.admin | `0x1eDc758579C66967C42066e8dDCB690a1651517e` (Safe) |

## Grant parameters

| Field | Value | Human |
|---|---|---|
| total | `1000` | 1000 tokens |
| start | `1775097636` | 2026-04-02T02:40:36Z |
| cliff | `1806633636` | 2027-04-02T02:40:36Z (+1 year) |
| duration | `63072000` | 730 days |
| end | `1838169636` | 2028-04-01T02:40:36Z |

**Case 1 invariant:** cliff is 1 year in the future. Executing revokeGrant at any time in the next year guarantees `revokedAt < cliff`, therefore `vested=0`, `claimable=0`, `canceled=1000`.

---

## Safe Transaction 1 of 2: createGrant

**To:** `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` (VestingContract)  
**Value:** `0`  
**Function:** `createGrant(address,uint256,uint64,uint64,uint64)`

**Calldata:**
```
0x637096e6
0000000000000000000000007d5a7b3061880c36d69127a4eb8293880b1ed90a
00000000000000000000000000000000000000000000000000000000000003e8
0000000000000000000000000000000000000000000000000000000069cdd724
000000000000000000000000000000000000000000000000000000006baf0aa4
0000000000000000000000000000000000000000000000000000000003c26700
```

### Safe UI steps

1. Open: `https://app.safe.global/home?safe=basesep:0x1eDc758579C66967C42066e8dDCB690a1651517e`
2. Click **"New transaction"** → **"Contract interaction"**
3. Enter contract address: `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08`
4. If prompted for ABI, paste:
   ```json
   [{"type":"function","name":"createGrant","stateMutability":"nonpayable","inputs":[{"name":"employee","type":"address"},{"name":"total","type":"uint256"},{"name":"start","type":"uint64"},{"name":"cliff","type":"uint64"},{"name":"duration","type":"uint64"}],"outputs":[]}]
   ```
5. Select function: **`createGrant`**
6. Fill arguments:
   | Arg | Value |
   |---|---|
   | `employee` | `0x7d5A7b3061880c36D69127a4eB8293880b1eD90A` |
   | `total` | `1000` |
   | `start` | `1775097636` |
   | `cliff` | `1806633636` |
   | `duration` | `63072000` |
7. ETH value: `0`
8. Verify selector in data preview begins with `0x637096e6`
9. Click **"Review"** → **"Submit"** → sign → execute

### Expected event on success
```
GrantCreated(
  employee: 0x7d5A7b3061880c36D69127a4eB8293880b1eD90A,
  total: 1000,
  start: 1775097636,
  cliff: 1806633636,
  duration: 63072000
)
```

### After tx confirms — report back
Paste the tx hash. I will:
- Run `grants(beneficiary)` read to confirm on-chain state
- Write `post-create-grant.json`
- Present Safe Transaction 2

---

## Safe Transaction 2 of 2: revokeGrant

> **Prepared in advance. Do not execute until createGrant confirms.**

**To:** `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` (VestingContract)  
**Value:** `0`  
**Function:** `revokeGrant(address)`

**Calldata:**
```
0x1817c5a7
0000000000000000000000007d5a7b3061880c36d69127a4eb8293880b1ed90a
```

### Safe UI steps

1. New transaction → Contract interaction
2. Contract: `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08`
3. ABI if needed:
   ```json
   [{"type":"function","name":"revokeGrant","stateMutability":"nonpayable","inputs":[{"name":"employee","type":"address"}],"outputs":[]}]
   ```
4. Select function: **`revokeGrant`**
5. Args:
   | Arg | Value |
   |---|---|
   | `employee` | `0x7d5A7b3061880c36D69127a4eB8293880b1eD90A` |
6. ETH value: `0`
7. Verify selector begins with `0x1817c5a7`
8. Submit → sign → execute

### Expected event on success
```
GrantRevoked(
  employee: 0x7d5A7b3061880c36D69127a4eB8293880b1eD90A,
  revokedAt: <block.timestamp>,   ← must be < 1806633636
  total: 1000,
  released: 0,
  vested: 0,
  claimable: 0,
  canceled: 1000
)
```

### After tx confirms — report back
Paste the tx hash. I will:
- Decode the GrantRevoked event
- Assert `revokedAt < 1806633636`
- Assert `vested == 0`, `claimable == 0`, `canceled == 1000`
- Write `post-revoke-grant.json` and `verification-summary.json`
- Mark Case 1 complete

---

## Artifact index for this case

| File | Status |
|---|---|
| `case-config.json` | Written |
| `prestate.json` | Written |
| `safe-tx-1-create-grant.json` | Written |
| `safe-tx-2-revoke-grant.json` | Written |
| `post-create-grant.json` | Pending tx 1 |
| `post-revoke-grant.json` | Pending tx 2 |
| `verification-summary.json` | Pending tx 2 |
