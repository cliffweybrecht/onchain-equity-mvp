# Phase 8.4.C Case 2 — Execution Plan: Revoke During Vesting

## State going in (confirmed on-chain, block 39665527)

| Field | Value |
|---|---|
| beneficiary | `0x1A0E8fC547DC74d4caEcC506dc605534846B6A06` |
| isVerified | `false` (status=0) — must be set first |
| grant.exists | `false` |
| vesting.admin | `0x1eDc758579C66967C42066e8dDCB690a1651517e` (Safe) |
| registry.admin | `0x1eDc758579C66967C42066e8dDCB690a1651517e` (Safe) |

## Grant parameters

| Field | Value | Human |
|---|---|---|
| total | `1000` | 1000 tokens |
| start | `1759547342` | 2025-10-04T03:09:02Z (180 days ago) |
| cliff | `1767323342` | 2026-01-02T03:09:02Z (90 days ago — already past) |
| duration | `31536000` | 365 days |
| end | `1791083342` | 2026-10-04T03:09:02Z (~185 days from now) |

**Case 2 invariant:** cliff is already in the past. revokeGrant called immediately after createGrant
mines will produce `cliff ≤ revokedAt < end`, guaranteeing `0 < vested < total`.

**Vested formula:** `vested = floor(1000 × (revokedAt − 1759547342) / 31536000)`

At the prestate anchor (2026-04-02): elapsed = 180 days → vested ≈ **493 tokens**. Each additional
~31 minutes of delay adds 1 token. Exact value confirmed from `GrantRevoked` event.

---

## Safe Transaction 0 of 3: setStatus (verify beneficiary)

**To:** `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4` (IdentityRegistry)  
**Function:** `setStatus(address,uint8)`  
**Calldata:** `0x278e07ce0000000000000000000000001a0e8fc547dc74d4caecc506dc605534846b6a060000000000000000000000000000000000000000000000000000000000000001`

### Safe UI steps

1. Open: `https://app.safe.global/home?safe=basesep:0x1eDc758579C66967C42066e8dDCB690a1651517e`
2. New transaction → Contract interaction
3. Contract: `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4`
4. ABI:
   ```json
   [{"type":"function","name":"setStatus","stateMutability":"nonpayable","inputs":[{"name":"user","type":"address"},{"name":"newStatus","type":"uint8"}],"outputs":[]}]
   ```
5. Function: `setStatus`
6. Args: `user=0x1A0E8fC547DC74d4caEcC506dc605534846B6A06`, `newStatus=1`
7. Selector check: `0x278e07ce`
8. Submit → sign → execute

**Expected event:** `StatusUpdated(user=0x1A0E8fC547DC74d4caEcC506dc605534846B6A06, previousStatus=0, newStatus=1)`

### After confirms — report back tx hash

---

## Safe Transaction 1 of 3: createGrant

**To:** `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` (VestingContract)  
**Function:** `createGrant(address,uint256,uint64,uint64,uint64)`  
**Calldata:**
```
0x637096e6
0000000000000000000000001a0e8fc547dc74d4caecc506dc605534846b6a06
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
   | `employee` | `0x1A0E8fC547DC74d4caEcC506dc605534846B6A06` |
   | `total` | `1000` |
   | `start` | `1759547342` |
   | `cliff` | `1767323342` |
   | `duration` | `31536000` |
6. Selector check: `0x637096e6`
7. Submit → sign → execute

**Expected event:** `GrantCreated(employee=0x1A0E8fC547DC74d4caEcC506dc605534846B6A06, total=1000, start=1759547342, cliff=1767323342, duration=31536000)`

### After confirms — report back tx hash

---

## Safe Transaction 2 of 3: revokeGrant

**To:** `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08`  
**Function:** `revokeGrant(address)`  
**Calldata:** `0x1817c5a70000000000000000000000001a0e8fc547dc74d4caecc506dc605534846b6a06`

### Safe UI steps

1. New transaction → Contract interaction
2. Contract: `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08`
3. ABI:
   ```json
   [{"type":"function","name":"revokeGrant","stateMutability":"nonpayable","inputs":[{"name":"employee","type":"address"}],"outputs":[]}]
   ```
4. Function: `revokeGrant`
5. Args: `employee=0x1A0E8fC547DC74d4caEcC506dc605534846B6A06`
6. Selector check: `0x1817c5a7`
7. Submit → sign → execute

**Expected event:**
```
GrantRevoked(
  employee: 0x1A0E8fC547DC74d4caEcC506dc605534846B6A06,
  revokedAt: <block.timestamp>,         ← must satisfy: 1767323342 <= revokedAt < 1791083342
  total: 1000,
  released: 0,
  vested: floor(1000 * (revokedAt - 1759547342) / 31536000),   ← > 0
  claimable: vested,
  canceled: 1000 - vested               ← > 0
)
```

### After confirms — report back tx hash

I will:
- Decode the `GrantRevoked` event
- Assert `1767323342 ≤ revokedAt < 1791083342`
- Verify `vested = floor(1000 × (revokedAt − 1759547342) / 31536000)` against event
- Assert `claimable = vested`, `canceled = 1000 − vested`
- Write `post-create-grant.json`, `post-revoke-grant.json`, `verification-summary.json`

---

## Artifact index for this case

| File | Status |
|---|---|
| `case-config.json` | Written |
| `prestate.json` | Written |
| `safe-tx-0-set-verified.json` | Written |
| `safe-tx-1-create-grant.json` | Written |
| `safe-tx-2-revoke-grant.json` | Written |
| `post-set-verified.json` | Pending tx 0 |
| `post-create-grant.json` | Pending tx 1 |
| `post-revoke-grant.json` | Pending tx 2 |
| `verification-summary.json` | Pending tx 2 |
