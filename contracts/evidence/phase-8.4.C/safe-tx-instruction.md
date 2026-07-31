# Phase 8.4.C — Safe Transaction: setStatus(address,uint8)

## Blocker resolved

**`setVerified(address,bool)` does not exist in IdentityRegistry.**

The source at `contracts/IdentityRegistry.sol` and ABI at
`artifacts/contracts/IdentityRegistry.sol/IdentityRegistry.json` confirm:

| Function | Exists | Purpose |
|---|---|---|
| `setStatus(address user, uint8 newStatus)` | YES | Set status 0/1/2 |
| `setVerified(address,bool)` | NO | Not in contract — routes to fallback() → GS013 |

Status semantics:
- `0` = Unverified  
- `1` = Verified  
- `2` = Restricted / Terminated  

`isVerified(address)` returns `true` iff `_status[user] == 1`.

---

## Prestate (confirmed on-chain at block 39664362)

| Field | Value |
|---|---|
| Registry | `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4` |
| Registry admin | `0x1eDc758579C66967C42066e8dDCB690a1651517e` (Safe) |
| Target address | `0x7d5A7b3061880c36D69127a4eB8293880b1eD90A` |
| Current status (raw) | `0` (Unverified) |
| isVerified | `false` |
| Grant exists | `false` |

Artifact: `contracts/evidence/phase-8.4.C/identity-prestate.json`

---

## The transaction

**To:** `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4` (IdentityRegistry)  
**Value:** `0`  
**Function:** `setStatus(address user, uint8 newStatus)`  
**Args:**
- `user` = `0x7d5A7b3061880c36D69127a4eB8293880b1eD90A`
- `newStatus` = `1`

**Hex calldata:**
```
0x278e07ce
0000000000000000000000007d5a7b3061880c36d69127a4eb8293880b1ed90a
0000000000000000000000000000000000000000000000000000000000000001
```

Artifact: `contracts/evidence/phase-8.4.C/safe-tx-setStatus-calldata.json`

---

## Safe UI — click-by-click

### 1. Open Safe app
Go to: `https://app.safe.global/home?safe=basesep:0x1eDc758579C66967C42066e8dDCB690a1651517e`

### 2. New Transaction
Click **"New transaction"** → **"Contract interaction"**

### 3. Enter contract address
Paste: `0x9d6831cCB9D6f971Cb648B538448d175650cfEa4`

If Safe prompts for ABI, paste this minimal ABI:
```json
[{"type":"function","name":"setStatus","stateMutability":"nonpayable","inputs":[{"name":"user","type":"address"},{"name":"newStatus","type":"uint8"}],"outputs":[]}]
```

### 4. Select function
From the function dropdown, select: **`setStatus`**

### 5. Fill arguments
| Field | Value |
|---|---|
| `user` | `0x7d5A7b3061880c36D69127a4eB8293880b1eD90A` |
| `newStatus` | `1` |

### 6. Verify encoded data preview
Safe should show calldata beginning with selector `0x278e07ce`. If it shows anything else, stop — wrong function selected.

### 7. ETH value
Leave at `0` (no ETH transfer).

### 8. Review & submit
Click **"Review"** → verify To/Data/Value → click **"Submit"**.  
Simulate must pass. If simulation fails, check that `newStatus` is exactly `1` (not `true` or `"1"`).

### 9. Sign and execute
Sign with your signer key. Execute once threshold is met.

---

## Expected event on success

```
StatusUpdated(
  user:           0x7d5A7b3061880c36D69127a4eB8293880b1eD90A,
  previousStatus: 0,
  newStatus:      1
)
```

---

## After tx confirms — run poststate verification

```bash
node scripts/ops/grants/verify-identity-poststate.mjs \
  --rpc https://sepolia.base.org \
  --registry 0x9d6831cCB9D6f971Cb648B538448d175650cfEa4 \
  --user 0x7d5A7b3061880c36D69127a4eB8293880b1eD90A \
  --expected-status 1 \
  --prestate contracts/evidence/phase-8.4.C/identity-prestate.json \
  --out contracts/evidence/phase-8.4.C/identity-poststate.json
```

Expected output: `"verdict": "POSTSTATE_VERIFIED"`, `"ok": true`

---

## Next after poststate verified

With beneficiary verified, proceed to grant creation for revocation cases:

```bash
node scripts/ops/grants/create-grant.mjs \
  --vesting 0x4739e9B845F4b4861236dfE0d8Da7AD985754f08 \
  --registry 0x9d6831cCB9D6f971Cb648B538448d175650cfEa4 \
  --employee 0x7d5A7b3061880c36D69127a4eB8293880b1eD90A \
  --total 1000 \
  --start <unix_now> --cliff <unix_now + cliff_seconds> --duration <seconds> \
  --notes "Phase 8.4.C revocation test grant" \
  --evidence contracts/evidence/phase-8.4.C/case-1-revoke-before-cliff
```

Cases to execute (in order):
- **Case 1:** Revoke before cliff → expect claimable=0, canceled=total
- **Case 2:** Revoke during vesting → expect partial vested preserved
- **Case 3:** Revoke after full vesting → expect all vested preserved
- **Case 4:** Release after revoke → expect release() pays claimable
- **Case 5:** Double revoke → expect `GrantAlreadyRevoked` revert
- **Case 6:** Non-admin revoke → expect `NotAdmin` revert
