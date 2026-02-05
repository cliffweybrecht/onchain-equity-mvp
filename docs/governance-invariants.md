# Governance Invariants (Part 3.9)

Network: Base Sepolia (chainId 84532)  
RPC: https://sepolia.base.org  
policyStackId: BASESEP-84532-STACK-2026-01-28-v1.3-recover1

## Roles (Canonical)
SAFE (protocol + emergency admin): 0x1eDc758579C66967C42066e8dDCB690a1651517e  
Deployer EOA (break-glass only; non-routine): 0x6C775411e11cAb752Af03C5BBb440618788E13Be

## Post-Incident Governance Targets
Steady-state governance intent is that SAFE is the sole governing authority for:
- IdentityRegistry
- VestingContract
- CompositePolicy root
- Compliance policies (ComplianceGatedPolicyV1, MinAmountPolicyV1)

Emergency control expectation:
- EmergencyFreezePolicyV2.frozen == false outside active incidents

Evidence:
- `evidence/part-3.9/governance-snapshot-POSTROTATE-84532-37243679.json`

## Verified SAFE-Governed Components (Observed)
As of block 37243679:
- IdentityRegistry.admin == SAFE
- VestingContract.admin == SAFE
- CompositePolicyV111.admin == SAFE
- ComplianceGatedPolicyV1.admin == SAFE
- MinAmountPolicyV1.admin == SAFE
- EmergencyFreezePolicyV2.frozen == false

## Residual Risk: EquityTokenV2 Admin (Non-Rotatable in this Deployment)
EquityTokenV2 exposes `admin()` but its deployed ABI does not include an admin-rotation function.
Current observed state (block 37243679):
- EquityTokenV2.admin == Deployer EOA

### Admin Blast Radius (EquityTokenV2 ABI)
Admin can:
- mint(address,uint256)
- setTransferPolicy(address)

Admin cannot:
- rotate itself via ABI (no setAdmin/transferOwnership/etc in V2 ABI)

### Compensating Controls (Required)
1) Deployer EOA key treated as break-glass only:
   - not used for routine operations
   - stored in hardware wallet or split custody
2) Any token-admin action requires:
   - incident/ticket ID
   - approval record
   - pre-change snapshot JSON
   - tx hash + block number
   - post-change snapshot JSON
3) Monitoring:
   - stack health check must flag token admin != SAFE as FAIL (or WARN if explicitly accepted for testnet)

### Production Requirement
Production deployment MUST support SAFE-governed token administration:
- either deploy a token version with explicit admin rotation to SAFE
- or ensure SAFE is token admin at deployment and admin is rotatable/recoverable

## Change Control (All Governance Surfaces)
For any governance-relevant change:
1) capture evidence snapshot (JSON)
2) execute transaction (SAFE when possible)
3) capture post-change snapshot (JSON)
4) commit evidence artifacts to repository
