# Claim Receipt Format (v1)

Schema: `claim-receipt-v1`
Type: `claim-receipt`

This document defines the canonical JSON structure for deterministic claim execution receipts in Phase 6.2.

## Determinism Rules

1) No wall-clock timestamps. Use the on-chain block timestamp.
2) All state reads MUST be block-anchored:
   - `state.before` uses `blockTag = receipt.blockNumber - 1`
   - `state.after` uses `blockTag = receipt.blockNumber`
3) All uint256/bigint quantities MUST be decimal strings.
4) The receipt must include the actual `tx.data` sent and a digest:
   - `claim.calldataDigest = keccak256(tx.data)`

---

## Top-Level Structure (Ordered Keys)

```json
{
  "schema": "claim-receipt-v1",
  "type": "claim-receipt",
  "chain": { "chainId": 84532, "name": "base-sepolia" },
  "tx": {
    "from": "0x...",
    "to": "0x...",
    "data": "0x...",
    "hash": "0x...",
    "nonce": 0
  },
  "receipt": {
    "status": 1,
    "blockNumber": 0,
    "blockHash": "0x...",
    "transactionIndex": 0,
    "gasUsed": "0",
    "effectiveGasPrice": "0",
    "cumulativeGasUsed": "0",
    "logsBloom": "0x..."
  },
  "block": {
    "timestamp": 0,
    "timestampISO": "1970-01-01T00:00:00.000Z"
  },
  "contracts": {
    "vesting": "0x...",
    "equityToken": "0x...",
    "identityRegistry": "0x...",
    "policy": "0x..."
  },
  "claim": {
    "beneficiary": "0x...",
    "operator": "0x...",
    "requestedAmount": "0",
    "calldataDigest": { "alg": "keccak256", "value": "0x..." }
  },
  "state": {
    "before": {
      "claimed": "0",
      "releasable": "0",
      "vested": "0"
    },
    "after": {
      "claimed": "0",
      "releasable": "0",
      "vested": "0"
    },
    "delta": {
      "claimedIncrease": "0",
      "tokensTransferred": "0"
    }
  },
  "events": {
    "decoded": [],
    "transferSummary": {
      "token": "0x...",
      "from": "0x...",
      "to": "0x...",
      "amount": "0"
    }
  },
  "verification": {
    "rules": {
      "deterministicBlockTags": {
        "before": "blockNumber-1",
        "after": "blockNumber"
      }
    },
    "checks": {
      "receiptStatus": true,
      "claimedIncreased": true,
      "transferMatchesDelta": true
    }
  }
}
```

---

## Minimum Verification Semantics

A verifier MUST be able to assert:

- `receipt.status === 1`
- `state.delta.claimedIncrease === state.after.claimed - state.before.claimed`
- `state.delta.claimedIncrease > 0` (unless no-op claims are explicitly allowed)
- `events.transferSummary.amount` equals `state.delta.tokensTransferred`
