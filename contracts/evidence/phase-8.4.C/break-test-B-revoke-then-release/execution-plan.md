# Phase 8.4.C Break Test B — Execution Plan: revokeGrant → release (Same-Tx)

## State going in (confirmed on-chain, block ~39707000)

| Field | Value |
|---|---|
| beneficiary | `0x2237d846D3EE2Baf268FF2a91C5971F5E594E1B1` |
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

**_effectiveTime boundary:** The condition in VestingContract is `g.revoked && queryTime > uint256(g.revokedAt)`.
When `release()` is called in the same tx as `revokeGrant()`, `block.timestamp == revokedAt`, so
`queryTime > revokedAt` is **false**. The cap does NOT apply. `release()` computes the same
`vested_at_T` as `revokeGrant()` did moments earlier.

---

## Safe Transaction 0 of 3: setStatus (verify beneficiary)

**To:** `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4` (IdentityRegistry)  
**Function:** `setStatus(address,uint8)`  
**Calldata:** `0x278e07ce0000000000000000000000002237d846d3ee2baf268ff2a91c5971f5e594e1b10000000000000000000000000000000000000000000000000000000000000001`

### Safe UI steps

1. Open: `https://app.safe.global/home?safe=basesep:0x1eDc758579C66967C42066e8dDCB690a1651517e`
2. New transaction → Contract interaction
3. Contract: `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4`
4. ABI:
   ```json
   [{"type":"function","name":"setStatus","stateMutability":"nonpayable","inputs":[{"name":"user","type":"address"},{"name":"newStatus","type":"uint8"}],"outputs":[]}]
   ```
5. Function: `setStatus`
6. Args: `user=0x2237d846D3EE2Baf268FF2a91C5971F5E594E1B1`, `newStatus=1`
7. Selector check: `0x278e07ce`
8. Submit → sign → execute

**Expected event:** `StatusUpdated(user=0x2237d846D3EE2Baf268FF2a91C5971F5E594E1B1, previousStatus=0, newStatus=1)`

### After confirms — report back tx hash

---

## Safe Transaction 1 of 3: createGrant

**To:** `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08` (VestingContract)  
**Function:** `createGrant(address,uint256,uint64,uint64,uint64)`  
**Calldata:**
```
0x637096e6
0000000000000000000000002237d846d3ee2baf268ff2a91c5971f5e594e1b1
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
   | `employee` | `0x2237d846D3EE2Baf268FF2a91C5971F5E594E1B1` |
   | `total` | `1000` |
   | `start` | `1759547342` |
   | `cliff` | `1767323342` |
   | `duration` | `31536000` |
6. Selector check: `0x637096e6`
7. Submit → sign → execute

**Expected event:** `GrantCreated(employee=0x2237d846D3EE2Baf268FF2a91C5971F5E594E1B1, total=1000, start=1759547342, cliff=1767323342, duration=31536000)`

### After confirms — report back tx hash

---

## Safe Transaction 2 of 3: MultiSend [revokeGrant, release]

**CRITICAL: Ordering matters. revokeGrant must be index 0, release must be index 1.**

### Safe Transaction Builder steps

1. New transaction → **Transaction Builder**
2. Add **Sub-call 0 (revokeGrant)**:
   - To: `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08`
   - Value: `0`
   - Data: `0x1817c5a70000000000000000000000002237d846d3ee2baf268ff2a91c5971f5e594e1b1`
3. Add **Sub-call 1 (release)**:
   - To: `0x4739e9B845F4b4861236dfE0d8Da7AD985754f08`
   - Value: `0`
   - Data: `0x191655870000000000000000000000002237d846d3ee2baf268ff2a91c5971f5e594e1b1`
4. Click "Create Batch"
5. Review: confirm 2 transactions, ordering is revokeGrant first
6. Submit → sign → execute

### What this proves

Let T = block.timestamp of this transaction.

- `revokeGrant()` runs first at T: `vested_at_T = floor(1000 * (T - 1759547342) / 31536000)`.
  Emits:
  ```
  GrantRevoked(
    employee: 0x2237d846D3EE2Baf268FF2a91C5971F5E594E1B1,
    revokedAt: T,
    total: 1000,
    released: 0,
    vested: vested_at_T,
    claimable: vested_at_T,
    canceled: 1000 - vested_at_T
  )
  ```
  Sets `g.revoked = true`, `g.revokedAt = T`.

- `release()` runs second at T:
  - `_effectiveTime`: `g.revoked && queryTime > g.revokedAt` → `T > T` → **false** → returns T
  - `vestedAmount = floor(1000 * (T - 1759547342) / 31536000) = vested_at_T`
  - `g.released = 0`, `unreleased = vested_at_T > 0`
  - **release succeeds**: mints `vested_at_T` tokens, writes `g.released = vested_at_T`

### Post-transaction verification (later block)

Execute these as `eth_call` (read-only) after the MultiSend confirms:

**1. vestedAmount(beneficiary) — formula freeze invariant**
```
eth_call: vestedAmount(0x2237d846D3EE2Baf268FF2a91C5971F5E594E1B1)
Expected: vested_at_T (same as GrantRevoked.vested)
Proof: _effectiveTime caps queryTime at revokedAt=T for any later block (queryTime > T is true in later blocks)
       formula = floor(1000 * (T - 1759547342) / 31536000) = vested_at_T
```

**2. release(beneficiary) eth_call — NothingToRelease invariant**
```
eth_call: release(0x2237d846D3EE2Baf268FF2a91C5971F5E594E1B1)
Expected: revert NothingToRelease
Proof: g.released = vested_at_T (written by same-tx release), vestedAmount = vested_at_T → unreleased = 0
```

### After confirms — report back tx hash + full GrantRevoked event args

I will:
- Decode GrantRevoked event: assert vested > 0, released = 0, claimable = vested, canceled = 1000 - vested
- Confirm release() succeeded in same tx (no revert, TokensReleased or similar event)
- Execute eth_call vestedAmount → assert == GrantRevoked.vested
- Execute eth_call release → assert revert NothingToRelease
- Write `post-multisend.json` and `verification-summary.json`

---

## Artifact index

| File | Status |
|---|---|
| `case-config.json` | Written |
| `prestate.json` | Written |
| `safe-tx-0-set-verified.json` | Written |
| `safe-tx-1-create-grant.json` | Written |
| `safe-tx-2-multisend-revoke-release.json` | Written |
| `post-set-verified.json` | Pending tx 0 |
| `post-create-grant.json` | Pending tx 1 |
| `post-multisend.json` | Pending tx 2 |
| `verification-summary.json` | Pending tx 2 |
