#!/usr/bin/env node

import fs from "fs";
import path from "path";
import Ajv from "ajv";

function usage() {
  console.error(`
Usage:
  node scripts/audit/verify-transparency-checkpoint.mjs \
    manifests/transparency/checkpoint.json \
    --log manifests/transparency/transparency-log.json \
    --anchor evidence/phase-7.13/transparency-log-anchor-receipt.json \
    --schema schemas/grant-audit-transparency-log-checkpoint-v1.schema.json
`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const named = {};

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        named[key] = true;
      } else {
        named[key] = value;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, named };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeHex32(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing or invalid ${fieldName}`);
  }
  const stripped = value.toLowerCase().replace(/^0x/, "");
  if (!/^[a-f0-9]{64}$/.test(stripped)) {
    throw new Error(`Invalid ${fieldName}; expected 32-byte hex`);
  }
  return `0x${stripped}`;
}

function normalizeAddress(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing or invalid ${fieldName}`);
  }
  const stripped = value.toLowerCase().replace(/^0x/, "");
  if (!/^[a-f0-9]{40}$/.test(stripped)) {
    throw new Error(`Invalid ${fieldName}; expected 20-byte address`);
  }
  return `0x${stripped}`;
}

function normalizeBlockNumber(value, fieldName) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  throw new Error(`Invalid ${fieldName}; expected non-negative integer`);
}

function getAnchoredLog(anchorReceipt) {
  if (!anchorReceipt || typeof anchorReceipt !== "object") {
    throw new Error("Anchor receipt missing");
  }

  if (
    anchorReceipt.anchored &&
    typeof anchorReceipt.anchored === "object" &&
    anchorReceipt.anchored.log &&
    typeof anchorReceipt.anchored.log === "object"
  ) {
    return anchorReceipt.anchored.log;
  }

  if (
    anchorReceipt.anchored &&
    typeof anchorReceipt.anchored === "object" &&
    Number.isInteger(anchorReceipt.anchored.entry_count) &&
    typeof anchorReceipt.anchored.head_entry_hash === "string" &&
    typeof anchorReceipt.anchored.log_root === "string"
  ) {
    return anchorReceipt.anchored;
  }

  if (
    anchorReceipt.log &&
    typeof anchorReceipt.log === "object" &&
    Number.isInteger(anchorReceipt.log.entry_count) &&
    typeof anchorReceipt.log.head_entry_hash === "string" &&
    typeof anchorReceipt.log.log_root === "string"
  ) {
    return anchorReceipt.log;
  }

  throw new Error(
    "Anchor receipt missing anchored log payload; expected anchored.log.*, anchored.*, or log.*"
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const { positional, named } = parseArgs(process.argv);

  const checkpointPath = positional[0];
  const logPath = named.log;
  const anchorPath = named.anchor;
  const schemaPath =
    named.schema || "schemas/grant-audit-transparency-log-checkpoint-v1.schema.json";

  if (!checkpointPath || !logPath || !anchorPath) usage();

  const checkpoint = readJson(checkpointPath);
  const log = readJson(logPath);
  const anchorReceipt = readJson(anchorPath);
  const schema = readJson(schemaPath);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(checkpoint);

  if (!valid) {
    console.error("Checkpoint schema validation failed:");
    console.error(validate.errors);
    process.exit(1);
  }

  assert(
    checkpoint.schema === "grant-audit-transparency-log-checkpoint-v1",
    `Unexpected checkpoint schema: ${checkpoint.schema}`
  );
  assert(
    checkpoint.version === "1.0.0",
    `Unexpected checkpoint version: ${checkpoint.version}`
  );

  assert(
    log.schema === "grant-audit-transparency-log-v1",
    `Unexpected transparency log schema: ${log.schema}`
  );
  assert(Array.isArray(log.entries), `Transparency log missing entries[]`);
  assert(
    Number.isInteger(log.entry_count) && log.entry_count >= 0,
    `Transparency log entry_count must be a non-negative integer`
  );
  assert(
    log.entries.length === log.entry_count,
    `Transparency log entry_count mismatch`
  );

  const normalizedLogHead = normalizeHex32(log.head_entry_hash, "log.head_entry_hash");
  const normalizedLogRoot = normalizeHex32(log.log_root, "log.log_root");

  let expectedEntriesMerkleRoot;
  if (log.entry_count === 0) {
    expectedEntriesMerkleRoot = normalizeHex32(
      "0000000000000000000000000000000000000000000000000000000000000000",
      "entries_merkle_root"
    );
  } else if (log.entry_count === 1) {
    expectedEntriesMerkleRoot = normalizeHex32(
      log.entries[0].entry_hash,
      "entries[0].entry_hash"
    );
    assert(
      expectedEntriesMerkleRoot === normalizedLogHead,
      `Single-entry log invariant violated: entry_hash != head_entry_hash`
    );
  } else {
    throw new Error(
      `Phase 7.15.A verifier currently supports single-entry log normalization only; found ${log.entry_count} entries`
    );
  }

  const anchoredLog = getAnchoredLog(anchorReceipt);

  const normalizedAnchorContract = normalizeAddress(
    anchorReceipt.anchor_contract,
    "anchor_contract"
  );
  const normalizedAnchorTxHash = normalizeHex32(
    anchorReceipt?.transaction?.hash,
    "transaction.hash"
  );
  const normalizedAnchorBlockNumber = normalizeBlockNumber(
    anchorReceipt?.transaction?.block_number,
    "transaction.block_number"
  );
  const normalizedAnchoredHead = normalizeHex32(
    anchoredLog.head_entry_hash,
    "anchored.head_entry_hash"
  );
  const normalizedAnchoredRoot = normalizeHex32(
    anchoredLog.log_root,
    "anchored.log_root"
  );

  assert(
    anchoredLog.entry_count === log.entry_count,
    `Anchor receipt entry_count mismatch`
  );
  assert(
    normalizedAnchoredHead === normalizedLogHead,
    `Anchor receipt head_entry_hash mismatch`
  );
  assert(
    normalizedAnchoredRoot === normalizedLogRoot,
    `Anchor receipt log_root mismatch`
  );

  assert(
    checkpoint.entry_count === log.entry_count,
    `Checkpoint entry_count mismatch`
  );
  assert(
    checkpoint.head_entry_hash === normalizedLogHead,
    `Checkpoint head_entry_hash mismatch`
  );
  assert(
    checkpoint.entries_merkle_root === expectedEntriesMerkleRoot,
    `Checkpoint entries_merkle_root mismatch`
  );
  assert(
    checkpoint.checkpoint_log_root === normalizedLogRoot,
    `Checkpoint checkpoint_log_root mismatch`
  );
  assert(
    checkpoint.anchor_contract === normalizedAnchorContract,
    `Checkpoint anchor_contract mismatch`
  );
  assert(
    checkpoint.anchor_tx_hash === normalizedAnchorTxHash,
    `Checkpoint anchor_tx_hash mismatch`
  );
  assert(
    checkpoint.anchor_block_number === normalizedAnchorBlockNumber,
    `Checkpoint anchor_block_number mismatch`
  );
  assert(
    checkpoint.source_log_path === logPath,
    `Checkpoint source_log_path mismatch`
  );
  assert(
    checkpoint.source_anchor_receipt_path === anchorPath,
    `Checkpoint source_anchor_receipt_path mismatch`
  );

  console.log("Transparency checkpoint verification passed.");
  console.log(`- checkpoint: ${path.resolve(checkpointPath)}`);
  console.log(`- log: ${path.resolve(logPath)}`);
  console.log(`- anchor receipt: ${path.resolve(anchorPath)}`);
  console.log(`- entry_count: ${checkpoint.entry_count}`);
  console.log(`- head_entry_hash: ${checkpoint.head_entry_hash}`);
  console.log(`- entries_merkle_root: ${checkpoint.entries_merkle_root}`);
  console.log(`- checkpoint_log_root: ${checkpoint.checkpoint_log_root}`);
  console.log(`- anchor_contract: ${checkpoint.anchor_contract}`);
  console.log(`- anchor_tx_hash: ${checkpoint.anchor_tx_hash}`);
  console.log(`- anchor_block_number: ${checkpoint.anchor_block_number}`);
}

main();
