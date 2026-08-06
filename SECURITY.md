# Security Policy

---

## Maturity Disclosure

Rail is **experimental testnet software**. The canonical stack (Phase 8.4.C) is deployed on Base Sepolia (chain ID 84532) and has not undergone a full external security audit.

**Do not use this software to manage real assets.**

No production deployment exists. No mainnet contracts are associated with this repository. Evidence artifacts reference Base Sepolia transaction hashes only.

---

## What Has Been Verified

Phase 8.4.C provides chain-grounded proof artifacts for the following behaviors:

- Vesting formula correctness (cliff + linear schedule)
- Grant revocation semantics (before cliff, during vesting window)
- Conservation invariant (`released_before + claimable + canceled = total`)
- Atomic `revokeGrant` + `release` boundary condition (`_effectiveTime` strict `>`)
- Atomic `release` + `revokeGrant` ordering (EVM intra-transaction SSTORE/SLOAD — A2 assumption, evidence consistent)
- Mint-on-claim correctness (token balance delta matches vested amount)
- Safe MultiSend execution proof (ExecutionSuccess event, nonce increment)

These verifications are not a substitute for a formal audit.

---

## What Has Not Been Verified

- Transfer restriction correctness (policy contracts exist in repository but are not deployed in Phase 8.4.C)
- Emergency pause / freeze (emergency freeze policy contracts exist but are not deployed in Phase 8.4.C)
- Reentrancy attack surface
- Front-running of `release()` calls
- Safe owner key management (single EOA; no hardware wallet requirement is enforced)
- Dependency supply chain (npm packages, Hardhat plugins)
- Full contract interaction surface under adversarial conditions

---

## Responsible Disclosure

If you discover a security vulnerability in this repository's code or operational tooling:

1. **Do not open a public GitHub issue.**
2. Contact the repository owner directly via the GitHub profile associated with this repository.

Describe the vulnerability, the affected component, and steps to reproduce.

**Note:** GitHub private vulnerability reporting is not currently enabled on this repository. Enabling it is a pending administrative action. Until it is enabled, direct contact via GitHub is the only available channel.

There is no formal bug bounty program. No response time is guaranteed.

---

## Dependencies

This repository uses the following security-relevant dependencies:

| Package | Role |
|---|---|
| `hardhat` v3 | Local EVM simulation, contract compilation |
| `viem` v2 | Chain interaction, ABI encoding/decoding |
| `@nomicfoundation/hardhat-viem` | Hardhat + viem integration |
| `ajv` v8 | JSON schema validation for artifacts |

Run `npm audit` periodically and address high-severity findings before publishing evidence artifacts.

---

## Key Material

Private keys are never committed to this repository. The `.gitignore` excludes `.env` files and all `*.pem` and `*.key` files except public keys in `keys/`. If you discover a private key in the git history, treat it as compromised and rotate immediately.
