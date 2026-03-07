#!/usr/bin/env node

import fs from "fs";
import path from "path";

function usage() {
  console.error(`
Usage:
  node scripts/ops/grants/build-transparency-checkpoint.mjs \
    --log manifests/transparency/transparency-log.json \
    --anchor evidence/phase-7.13/transparency-log-anchor-receipt.json \
    --out manifests/transparency/checkpoint.json
`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = value;
      i++;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
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

function main() {
  const args = parseArgs(process.argv);
  const logPath = args.log;
  const anchorPath = args.anchor;
  const outPath = args.out || "manifests/transparency/checkpoint.json";

  if (!logPath || !anchorPath) usage();

  const log = readJson(logPath);
  const anchorReceipt = readJson(anchorPath);

  if (log.schema !== "grant-audit-transparency-log-v1") {
    throw new Error(`Unexpected log schema: ${log.schema}`);
  }

  if (!Array.isArray(log.entries)) {
    throw new Error(`Transparency log missing entries[]`);
  }

  const entryCount = log.entry_count;
  if (!Number.isInteger(entryCount) || entryCount < 0) {
    throw new Error(`Transparency log entry_count must be a non-negative integer`);
  }

  if (entryCount !== log.entries.length) {
    throw new Error(
      `Transparency log entry_count (${entryCount}) does not match entries.length (${log.entries.length})`
    );
  }

  const headEntryHash = normalizeHex32(log.head_entry_hash, "log.head_entry_hash");
  const checkpointLogRoot = normalizeHex32(log.log_root, "log.log_root");

  let entriesMerkleRoot;
  if (entryCount === 0) {
    entriesMerkleRoot = normalizeHex32(
      "0000000000000000000000000000000000000000000000000000000000000000",
      "entries_merkle_root"
    );
  } else if (entryCount === 1) {
    const onlyEntry = log.entries[0];
    if (!onlyEntry || typeof onlyEntry !== "object") {
      throw new Error(`Transparency log entries[0] missing`);
    }
    const onlyEntryHash = normalizeHex32(onlyEntry.entry_hash, "entries[0].entry_hash");
    if (onlyEntryHash !== headEntryHash) {
      throw new Error(
        `Single-entry log invariant violated: entries[0].entry_hash != head_entry_hash`
      );
    }
    entriesMerkleRoot = onlyEntryHash;
  } else {
    throw new Error(
      `Phase 7.15.A currently supports single-entry log normalization only; found ${entryCount} entries`
    );
  }

  const anchoredLog = getAnchoredLog(anchorReceipt);

  const anchoredEntryCount = anchoredLog.entry_count;
  if (!Number.isInteger(anchoredEntryCount) || anchoredEntryCount < 0) {
    throw new Error(`Anchor receipt anchored entry_count must be a non-negative integer`);
  }

  const anchoredHeadEntryHash = normalizeHex32(
    anchoredLog.head_entry_hash,
    "anchored.head_entry_hash"
  );
  const anchoredLogRoot = normalizeHex32(
    anchoredLog.log_root,
    "anchored.log_root"
  );

  if (anchoredEntryCount !== entryCount) {
    throw new Error(
      `Anchor receipt entry_count mismatch: anchored=${anchoredEntryCount} log=${entryCount}`
    );
  }

  if (anchoredHeadEntryHash !== headEntryHash) {
    throw new Error(`Anchor receipt head_entry_hash mismatch`);
  }

  if (anchoredLogRoot !== checkpointLogRoot) {
    throw new Error(`Anchor receipt log_root mismatch`);
  }

  const anchorContract = normalizeAddress(
    anchorReceipt.anchor_contract,
    "anchor_contract"
  );

  const anchorTxHash = normalizeHex32(
    anchorReceipt?.transaction?.hash,
    "transaction.hash"
  );

  const anchorBlockNumber = normalizeBlockNumber(
    anchorReceipt?.transaction?.block_number,
    "transaction.block_number"
  );

  const checkpoint = {
    schema: "grant-audit-transparency-log-checkpoint-v1",
    version: "1.0.0",
    created_at: new Date().toISOString(),
    entry_count: entryCount,
    head_entry_hash: headEntryHash,
    entries_merkle_root: entriesMerkleRoot,
    checkpoint_log_root: checkpointLogRoot,
    anchor_contract: anchorContract,
    anchor_tx_hash: anchorTxHash,
    anchor_block_number: anchorBlockNumber,
    source_log_path: logPath,
    source_anchor_receipt_path: anchorPath
  };

  writeJson(outPath, checkpoint);

  console.log(`Built normalized transparency checkpoint: ${outPath}`);
  console.log(JSON.stringify(checkpoint, null, 2));
}

main();
