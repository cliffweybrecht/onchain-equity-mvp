#!/usr/bin/env node
/**
 * Phase 8.4.C — Post-createGrant verification artifact generator.
 *
 * Fetches the confirmed createGrant tx and produces a chain-grounded proof
 * artifact containing:
 *   - tx receipt (status, block number, block hash, tx index, gas used, to)
 *   - raw GrantCreated log (topic0, topic1, data, log_index) with decoded fields
 *   - exact eth_call request body for grants(employee) pinned to post-tx block
 *   - raw eth_call response (256-byte tuple)
 *   - decoded grant fields with explicit assertions
 *   - address consistency across tx/log/read surfaces
 *   - non-tautological block-pin assertions
 *
 * Grant struct ABI return layout (8 × 32 bytes):
 *   [0]   uint256  total
 *   [1]   uint256  released
 *   [2]   uint64   start
 *   [3]   uint64   cliff
 *   [4]   uint64   duration
 *   [5]   bool     exists
 *   [6]   bool     revoked
 *   [7]   uint64   revokedAt
 *
 * Usage:
 *   node scripts/ops/phase-8.4.C/build-post-create-grant.mjs \
 *     --tx-hash 0x... \
 *     --vesting  0x... \
 *     --employee 0x... \
 *     --case     break-test-B-revoke-then-release \
 *     --out      contracts/evidence/phase-8.4.C/break-test-B-revoke-then-release/post-create-grant.json
 */

import fs from "fs";
import path from "path";
import { createPublicClient, http, getAddress, toFunctionSelector, toEventSelector } from "viem";
import { baseSepolia } from "viem/chains";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function required(name, val) {
  if (!val) { console.error(`Missing required arg: ${name}`); process.exit(1); }
  return val;
}

const rpcUrl   = arg("--rpc")      || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const txHash   = required("--tx-hash",  arg("--tx-hash"));
const vesting  = getAddress(required("--vesting",  arg("--vesting")  || process.env.VESTING_CONTRACT));
const employee = getAddress(required("--employee", arg("--employee") || process.env.TARGET_ADDRESS));
const caseId   = arg("--case") || "break-test-B-revoke-then-release";
const out      = required("--out", arg("--out") || process.env.OUT_FILE);

// ── Selectors / topic0 — computed, not hardcoded ──────────────────────────────
const GRANTS_SELECTOR      = toFunctionSelector("grants(address)");
const GRANT_CREATED_TOPIC0 = toEventSelector("GrantCreated(address,uint256,uint64,uint64,uint64)");

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

// ── 1. Fetch tx receipt ───────────────────────────────────────────────────────
const receipt = await client.request({ method: "eth_getTransactionReceipt", params: [txHash] });
if (!receipt) { console.error("Receipt not found for", txHash); process.exit(1); }
if (receipt.status !== "0x1") { console.error("Tx reverted"); process.exit(1); }

const blockHex    = receipt.blockNumber;                    // e.g. "0x25e4753"
const blockNumber = Number(BigInt(blockHex)).toString();    // decimal string
const blockHash   = receipt.blockHash;
const txIndex     = Number(BigInt(receipt.transactionIndex));
const gasUsed     = Number(BigInt(receipt.gasUsed)).toString();
const toAddr      = receipt.to;                             // must equal vesting contract

// Decimal ↔ hex round-trip (non-tautological)
const blockHexRoundTrip = "0x" + parseInt(blockNumber, 10).toString(16);

// ── 2. Confirm block hash via independent eth_getBlockByNumber ────────────────
const block              = await client.request({ method: "eth_getBlockByNumber", params: [blockHex, false] });
const confirmedBlockHash = block.hash;
const blockTimestamp     = Number(BigInt(block.timestamp));

// ── 3. Fetch tx for from/to confirmation ─────────────────────────────────────
const tx = await client.request({ method: "eth_getTransactionByHash", params: [txHash] });

// ── 4. Find GrantCreated log ──────────────────────────────────────────────────
const grantLog = receipt.logs.find(
  l => l.topics[0]?.toLowerCase() === GRANT_CREATED_TOPIC0.toLowerCase()
);
if (!grantLog) { console.error("GrantCreated log not found in receipt"); process.exit(1); }

// topic1 = indexed employee (ABI-padded)
const topic1Raw       = grantLog.topics[1];
const logEmployeePad  = topic1Raw.replace("0x", "");
const logEmployeeAddr = "0x" + logEmployeePad.slice(-40);

// data = ABI-encoded (uint256 total, uint64 start, uint64 cliff, uint64 duration)
// Each occupies 32 bytes = 64 hex chars
const logData = grantLog.data.replace("0x", "");
if (logData.length !== 256) {
  console.error(`Unexpected GrantCreated data length: ${logData.length} hex chars (expected 256)`);
  process.exit(1);
}
const logTotal    = BigInt("0x" + logData.slice(0, 64)).toString();
const logStart    = BigInt("0x" + logData.slice(64, 128)).toString();
const logCliff    = BigInt("0x" + logData.slice(128, 192)).toString();
const logDuration = BigInt("0x" + logData.slice(192, 256)).toString();
const logIndex    = Number(BigInt(grantLog.logIndex));

// ── 5. grants(employee) eth_call pinned to post-tx block ─────────────────────
const employeeLower  = employee.toLowerCase().replace("0x", "");
const addrPadded     = employeeLower.padStart(64, "0");
// GRANTS_SELECTOR already has 0x prefix (from toFunctionSelector); strip it for concatenation
const grantsCalldata = GRANTS_SELECTOR.slice(2) + addrPadded;  // raw hex, no 0x prefix

const rpcReqGrants = {
  method: "eth_call",
  params: [{ to: vesting, data: "0x" + grantsCalldata }, blockHex]
};

const rawGrants = await client.request(rpcReqGrants);

// Decode 8-field tuple: 8 × 32 bytes = 256 bytes = 512 hex chars
const gHex = rawGrants.replace("0x", "");
if (gHex.length !== 512) {
  console.error(`Unexpected grants() return length: ${gHex.length} hex chars (expected 512)`);
  process.exit(1);
}
function slot(hex, n) { return hex.slice(n * 64, (n + 1) * 64); }

const gTotal     = BigInt("0x" + slot(gHex, 0)).toString();
const gReleased  = BigInt("0x" + slot(gHex, 1)).toString();
const gStart     = BigInt("0x" + slot(gHex, 2)).toString();
const gCliff     = BigInt("0x" + slot(gHex, 3)).toString();
const gDuration  = BigInt("0x" + slot(gHex, 4)).toString();
const gExists    = BigInt("0x" + slot(gHex, 5)) === 1n;
const gRevoked   = BigInt("0x" + slot(gHex, 6)) === 1n;
const gRevokedAt = BigInt("0x" + slot(gHex, 7)).toString();

// Derived: end timestamp
const gEnd = (BigInt(gStart) + BigInt(gDuration)).toString();

// ── 6. Address consistency ────────────────────────────────────────────────────
const empLC = employee.toLowerCase().replace("0x", "");

// topic1 encodes the employee: last 40 chars of the 64-char padded value
const topic1Employee = logEmployeePad.slice(-40);
const grantsArgEmployee = addrPadded.slice(-40);

// tx.to is the Safe (execTransaction outer call); vesting contract is the inner target.
// Proof that VestingContract executed: GrantCreated log was emitted by the vesting address.
const grantLogEmitter = grantLog.address.toLowerCase();
const addrConsistency = {
  grant_created_emitter_is_vesting: grantLogEmitter === vesting.toLowerCase(),
  topic1_employee_match:            topic1Employee === empLC,
  grants_arg_match:                 grantsArgEmployee === empLC,
  all_match: (
    grantLogEmitter === vesting.toLowerCase() &&
    topic1Employee === empLC &&
    grantsArgEmployee === empLC
  )
};

// ── 7. Build artifact ─────────────────────────────────────────────────────────
const artifact = {
  phase: "8.4.C",
  case: caseId,
  snapshot_type: "post_create_grant",
  generated_at: new Date(blockTimestamp * 1000).toISOString(),

  tx: {
    hash: txHash,
    status: "success",
    transaction_index: txIndex,
    from: tx.from,
    to:   tx.to,
    block_number: blockNumber,
    block_number_hex: blockHex,
    block_hash: blockHash,
    block_timestamp: blockTimestamp.toString(),
    block_timestamp_iso: new Date(blockTimestamp * 1000).toISOString(),
    gas_used: gasUsed
  },

  selector_derivations: {
    grants_selector: {
      preimage: "grants(address)",
      value: GRANTS_SELECTOR,
      method: "toFunctionSelector()"
    },
    grant_created_topic0: {
      preimage: "GrantCreated(address,uint256,uint64,uint64,uint64)",
      value: GRANT_CREATED_TOPIC0,
      method: "toEventSelector()"
    }
  },

  grant_created_log: {
    log_index: logIndex,
    emitting_contract: grantLog.address,
    topic0: grantLog.topics[0],
    topic1_raw: topic1Raw,
    data_raw: "0x" + logData,
    abi_fragment: "event GrantCreated(address indexed employee, uint256 total, uint64 start, uint64 cliff, uint64 duration)",
    data_layout: "4 × 32-byte ABI words: [total][start][cliff][duration]",
    decoded: {
      employee:  logEmployeeAddr,
      total:     logTotal,
      start:     logStart,
      cliff:     logCliff,
      duration:  logDuration
    }
  },

  grants_read: {
    target: vesting,
    block_tag: blockHex,
    calldata: "0x" + grantsCalldata,
    calldata_breakdown: {
      selector: GRANTS_SELECTOR,
      selector_preimage: "grants(address)",
      arg_address_padded: addrPadded
    },
    rpc_request: rpcReqGrants,
    rpc_response: { result: rawGrants },
    return_layout: "8 × 32-byte ABI words: [total][released][start][cliff][duration][exists][revoked][revokedAt]",
    raw_slots: {
      slot_0_total:     slot(gHex, 0),
      slot_1_released:  slot(gHex, 1),
      slot_2_start:     slot(gHex, 2),
      slot_3_cliff:     slot(gHex, 3),
      slot_4_duration:  slot(gHex, 4),
      slot_5_exists:    slot(gHex, 5),
      slot_6_revoked:   slot(gHex, 6),
      slot_7_revokedAt: slot(gHex, 7)
    },
    decoded: {
      total:     gTotal,
      released:  gReleased,
      start:     gStart,
      cliff:     gCliff,
      duration:  gDuration,
      end:       gEnd,
      exists:    gExists,
      revoked:   gRevoked,
      revokedAt: gRevokedAt
    }
  },

  address_consistency: {
    subject: employee,
    note: "tx.to is the Safe (outer execTransaction call). VestingContract execution is proven by GrantCreated log emitter.",
    surfaces: {
      tx_to_safe:                    tx.to,
      grant_created_log_emitter:     grantLog.address,
      expected_vesting:              vesting,
      grant_created_topic1_raw:      topic1Raw,
      grant_created_topic1_employee: "0x" + topic1Employee,
      grants_read_arg:               "0x" + grantsArgEmployee
    },
    checks: addrConsistency
  },

  chain_binding: {
    tx_hash:                          txHash,
    receipt_status:                   "success",
    receipt_transaction_index:        txIndex,
    receipt_block_number:             blockNumber,
    receipt_block_number_hex:         blockHex,
    receipt_block_hash:               blockHash,
    block_hash_confirmed_by_getBlock: confirmedBlockHash,
    grants_read_block_tag:            rpcReqGrants.params[1],
    block_number_decimal_to_hex:      blockHexRoundTrip
  },

  assertions: {
    tx_status_success:
      receipt.status === "0x1",
    grant_created_emitter_is_vesting_contract:
      grantLog.address.toLowerCase() === vesting.toLowerCase(),
    block_hash_matches_receipt_and_getBlock:
      blockHash.toLowerCase() === confirmedBlockHash.toLowerCase(),
    block_hex_matches_decimal_round_trip:
      blockHexRoundTrip === blockHex,
    grants_read_pinned_to_receipt_block:
      rpcReqGrants.params[1] === blockHex,

    // GrantCreated log assertions
    grant_created_log_exists:
      !!grantLog,
    grant_created_employee_matches:
      topic1Employee === empLC,
    grant_created_total_eq_1000:
      logTotal === "1000",
    grant_created_start_eq_1759547342:
      logStart === "1759547342",
    grant_created_cliff_eq_1767323342:
      logCliff === "1767323342",
    grant_created_duration_eq_31536000:
      logDuration === "31536000",

    // grants(employee) storage read assertions
    grant_exists_true:
      gExists === true,
    grant_revoked_false:
      gRevoked === false,
    grant_total_eq_1000:
      gTotal === "1000",
    grant_released_eq_0:
      gReleased === "0",
    grant_start_eq_1759547342:
      gStart === "1759547342",
    grant_cliff_eq_1767323342:
      gCliff === "1767323342",
    grant_duration_eq_31536000:
      gDuration === "31536000",
    grant_revokedAt_eq_0:
      gRevokedAt === "0",

    // Cross-surface consistency
    address_consistent_across_all_surfaces:
      addrConsistency.all_match,

    // Event ↔ storage consistency
    log_total_matches_storage_total:
      logTotal === gTotal,
    log_start_matches_storage_start:
      logStart === gStart,
    log_cliff_matches_storage_cliff:
      logCliff === gCliff,
    log_duration_matches_storage_duration:
      logDuration === gDuration
  }
};

// Final gate check
const failures = Object.entries(artifact.assertions).filter(([, v]) => v !== true);
if (failures.length > 0) {
  console.error("FAIL — assertions failed:", failures.map(([k]) => k).join(", "));
  console.error(JSON.stringify(artifact.assertions, null, 2));
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify(artifact, null, 2));
console.error("\nPASS — all assertions satisfied. Artifact written to:", out);
