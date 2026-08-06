# Architecture — Phase 8.4.C

> For addresses, trust model, and component classification see [`CANONICAL_SYSTEM.md`](CANONICAL_SYSTEM.md).
> For evidence mapping see [`EVIDENCE_INDEX.md`](EVIDENCE_INDEX.md).

---

## 1. Canonical Contract Relationships

The diagram shows administrator relationships (dashed) and call relationships (solid) for Phase 8.4.C canonical contracts. The `EquityTokenV2` / `ITransferPolicy` / `CompositePolicy` stack is not shown here — see §7 for the repository organisation view.

```mermaid
graph TD
    OWNER["Safe Owner EOA\n0x6C775411…13Be"]
    SAFE["Safe v1.4.1\n0x1eDc75…517e\n(1-of-1 multisig)"]
    REG["IdentityRegistry\n0x9d6831…fEa4"]
    VEST["VestingContract\n0x4739e9…4f08"]
    TOKEN["EquityToken\n0x73b8e6…7c95"]
    BEN["Beneficiary Wallet"]

    OWNER -- "signs execTransaction" --> SAFE

    SAFE -. "admin" .-> REG
    SAFE -. "admin" .-> VEST
    VEST -. "admin (token.admin)" .-> TOKEN

    SAFE -- "setStatus(address, uint8)" --> REG
    SAFE -- "createGrant(employee,…)" --> VEST
    SAFE -- "revokeGrant(employee)" --> VEST

    VEST -- "isVerified(employee)" --> REG
    VEST -- "mint(employee, amount)" --> TOKEN

    TOKEN -- "isVerified(from/to)" --> REG

    BEN -- "release(employee) [permissionless]" --> VEST
    BEN -- "transfer(to, amount)" --> TOKEN

    TOKEN -- "Transfer(0x0 → employee)" --> BEN
```

**Key:**
- Dashed arrows (`-.->`) = administrator relationship (the source holds `admin` role over the target)
- Solid arrows (`-->`) = function call direction
- `release(employee)` has no caller restriction; any address may submit it

---

## 2. Governance and Trust Boundaries

```mermaid
graph TD
    OWNER["Safe Owner EOA\n0x6C775411…13Be\n[single point of trust]"]
    SAFE["Safe v1.4.1\n0x1eDc75…517e\nthreshold: 1-of-1"]

    subgraph "Admin boundary — Safe controls"
        REG["IdentityRegistry\nadmin = Safe"]
        VEST["VestingContract\nadmin = Safe"]
    end

    subgraph "Admin boundary — VestingContract controls"
        TOKEN["EquityToken\nadmin = VestingContract"]
    end

    OWNER -- "one signature sufficient" --> SAFE
    SAFE --> REG
    SAFE --> VEST
    VEST --> TOKEN
```

All three canonical contracts are ultimately controlled by the Safe owner EOA. There is no second signer, time lock, or veto path.

---

## 3. Grant Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Absent : address has no grant

    Absent --> Created : Safe calls createGrant()\nGrantCreated event emitted

    Created --> PreCliff : block.timestamp < cliff\nvestedAmount = 0

    PreCliff --> Vesting : block.timestamp >= cliff\nlinear vesting begins

    Vesting --> FullyVested : block.timestamp >= start + duration\nvestedAmount = total

    PreCliff --> RevokedZero : Safe calls revokeGrant()\nrevokedAt < cliff → vested=0

    Vesting --> RevokedPartial : Safe calls revokeGrant()\nrevokedAt in window → vested=floor(total×elapsed/duration)

    FullyVested --> RevokedFull : Safe calls revokeGrant()\nrevokedAt >= end → vested=total, canceled=0

    RevokedZero --> FinalState : release() has nothing to claim\nNothingToRelease() if called

    RevokedPartial --> FinalState : release() mints claimable amount\nfuture release() reverts NothingToRelease()

    RevokedFull --> FinalState : release() mints total-released\nfuture release() reverts NothingToRelease()

    FullyVested --> FinalState : release() mints unreleased amount\ngrant.released = total

    note right of Created : One grant per address.\nGrantAlreadyExists() on duplicate.\nNo amendment function.

    note right of FinalState : grant.revoked = true\ngrant.revokedAt frozen\nvestedAmount() frozen forever
```

---

## 4. Release Lifecycle

```mermaid
flowchart TD
    A["Any caller invokes release(employee)"]
    B["Load grant storage: g = grants[employee]"]
    C{g.exists?}
    D["revert GrantDoesNotExist()"]
    E["vested = vestedAmount(employee)\n= _vestedAmountAt(g, block.timestamp)"]
    F["unreleased = vested − g.released"]
    G{unreleased == 0?}
    H["revert NothingToRelease()"]
    I{"isVerified(employee)?"}
    J["revert NotVerified()"]
    K["g.released = vested\n[SSTORE — CEI order]"]
    L["token.mint(employee, unreleased)\nEmits Mint + Transfer(0x0 → employee)"]
    M["emit GrantReleased(employee, unreleased)"]
    N["Employee wallet receives tokens"]

    A --> B --> C
    C -- No --> D
    C -- Yes --> E --> F --> G
    G -- Yes --> H
    G -- No --> I
    I -- No --> J
    I -- Yes --> K --> L --> M --> N
```

---

## 5. Revocation Lifecycle

```mermaid
flowchart TD
    A["Safe calls revokeGrant(employee)"]
    B["Load grant storage: g = grants[employee]"]
    C{g.exists?}
    D["revert GrantDoesNotExist()"]
    E{g.revoked?}
    F["revert GrantAlreadyRevoked()"]
    G["revocationTime = uint64(block.timestamp)"]
    H["snapshot = g  [memory copy]"]
    I["vested = _vestedAmountAt(snapshot, revocationTime)"]
    J["claimable = vested − g.released"]
    K["canceled = g.total − vested"]
    L["g.revoked = true\ng.revokedAt = revocationTime\n[SSTORE]"]
    M["emit GrantRevoked(employee, revokedAt,\ntotal, released, vested, claimable, canceled)"]
    N["Future: _effectiveTime(g, T) returns revokedAt for all T > revokedAt\nvestedAmount() is permanently frozen"]
    O["Future: release() succeeds if claimable > 0\nSubsequent release() reverts NothingToRelease()"]

    A --> B --> C
    C -- No --> D
    C -- Yes --> E
    E -- Yes --> F
    E -- No --> G --> H --> I --> J --> K --> L --> M
    M --> N
    M --> O
```

**`_effectiveTime` boundary:** When `release` and `revokeGrant` execute in the same transaction (`queryTime == g.revokedAt`), the condition `queryTime > g.revokedAt` is `false`. The time cap does not apply and `release` computes the same vested amount as `revokeGrant`. This is Break Test B — proven in `contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/`.

---

## 6. Evidence Generation Flow

The diagram marks builder script availability. `[MISSING]` indicates no script exists in the current commit.

```mermaid
flowchart TD
    SRC["Source commit\n5c2e293905748fdd…"]
    DEPLOY["Canonical contracts\non Base Sepolia\n(chain ID 84532)"]
    BENCH["Beneficiary setup\nfind-verified-fresh-beneficiary-v2.mjs\nbuild-identity-prestate.mjs"]
    SAFE_TX["Safe Transaction\n(Safe Transaction Builder UI\nor scripted execTransaction)"]
    CHAIN["Base Sepolia\nBlock included"]
    RECEIPT["eth_getTransactionReceipt\nEvent logs decoded"]
    STATE["eth_call post-state reads\npinned to receipt block"]

    subgraph "Evidence builders"
        B_SETVF["build-post-set-verified.mjs\n[EXISTS]"]
        B_GRANT["build-post-create-grant.mjs\n[EXISTS]"]
        B_MULTI["build-post-multisend.mjs\n[MISSING]"]
    end

    ARTIFACT_SV["post-set-verified.json"]
    ARTIFACT_CG["post-create-grant.json"]
    ARTIFACT_MS["post-multisend.json"]
    ARTIFACT_VS["verification-summary.json"]
    IDX["EVIDENCE_INDEX.md"]

    SRC --> DEPLOY
    DEPLOY --> BENCH
    BENCH --> SAFE_TX
    SAFE_TX -- "setStatus tx" --> CHAIN
    SAFE_TX -- "createGrant tx" --> CHAIN
    SAFE_TX -- "revokeGrant / multiSend tx" --> CHAIN
    CHAIN --> RECEIPT --> STATE

    STATE --> B_SETVF --> ARTIFACT_SV
    STATE --> B_GRANT --> ARTIFACT_CG
    STATE --> B_MULTI --> ARTIFACT_MS

    ARTIFACT_SV --> ARTIFACT_VS
    ARTIFACT_CG --> ARTIFACT_VS
    ARTIFACT_MS --> ARTIFACT_VS
    ARTIFACT_VS --> IDX

    style B_MULTI fill:#ffcccc,stroke:#cc0000
```

---

## 7. Repository Organisation

```mermaid
graph TD
    subgraph "Canonical — Phase 8.4.C"
        CS["contracts/EquityToken.sol\ncontracts/VestingContract.sol\ncontracts/IdentityRegistry.sol"]
        CE["contracts/evidence/phase-8.4.C/"]
        SC["scripts/ops/phase-8.4.C/\nscripts/ops/grants/ [selected]"]
    end

    subgraph "Active Parallel Experiments"
        EV2["contracts/EquityTokenV2.sol"]
        POL["contracts/policy/\n(ITransferPolicy, CompositePolicy,\nComplianceGatedPolicyV1, MinAmountPolicyV1)"]
        POLV2["contracts/policies/EmergencyFreezePolicyV2.sol"]
        ANC["contracts/audit/TransparencyLogAnchor.sol"]
        GST["test/governance.selftest.test.js"]
    end

    subgraph "Legacy — Historical Reference"
        OLD["contracts/evidence/phase-3.* … phase-8.4.B.A\nevidence/ [phase-7.* runs]"]
        DM["deployments/base-sepolia.json\n[stale — 8.4.B.A addresses]"]
        AT["archived-tests/"]
    end

    subgraph "Deprecated"
        POLV1["contracts/policies/EmergencyFreezePolicyV1.sol\n[wrong interface — do not deploy]"]
    end

    subgraph "Active Documentation"
        DOC["docs/CANONICAL_SYSTEM.md\ndocs/ARCHITECTURE.md\ndocs/EVIDENCE_INDEX.md\ndocs/TEST_MATRIX.md\ndocs/REPOSITORY_PHILOSOPHY.md"]
    end

    subgraph "Historical Documentation"
        HDOC["docs/vesting-invariants.md [Phase 6.2]\ndocs/governance-invariants.md\nother legacy docs"]
    end

    subgraph "Schemas and Build"
        SCH["schemas/"]
        CFG["hardhat.config.ts\npackage.json\ntsconfig.json"]
    end
```
