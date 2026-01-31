# Break-Glass Runbook (Pilot)

## Purpose
Emergency controls for halting transfers quickly during an incident.

## Mechanism
`EmergencyFreezePolicyV2` is the **first** policy in the active `CompositePolicy` (AND).
- `frozen=true`  → blocks **all** transfers
- `frozen=false` → passes; downstream policies decide

## Preconditions
- Operator has access to the `emergencyAdmin` key (pilot: single EOA; later: multisig).
- RPC is reachable.
- `.env` includes `PRIVATE_KEY`.

## Commands

### Status
```bash
node scripts/ops/status.js
