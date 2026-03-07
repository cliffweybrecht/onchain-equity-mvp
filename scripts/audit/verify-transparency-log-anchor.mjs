#!/usr/bin/env node

import fs from "fs";
import path from "path";
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi
} from "viem";
import { baseSepolia } from "viem/chains";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toBytes32(hexValue, label, errors) {
  const normalized =
    typeof hexValue === "string" && hexValue.startsWith("0x")
      ? hexValue
      : `0x${hexValue ?? ""}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    errors.push(`${label} is not a valid 32-byte hex string`);
  }
  return normalized;
}

const ABI = parseAbi([
  "function getAnchor(bytes32 logRoot) view returns (bool anchored, bytes32 headEntryHash, uint256 entryCount, uint256 anchoredAtBlock, uint256 anchoredAtTimestamp, address anchorer)",
  "event TransparencyLogRootAnchored(bytes32 indexed logRoot, bytes32 indexed headEntryHash, uint256 indexed entryCount, uint256 anchoredAtBlock, uint256 anchoredAtTimestamp, address anchorer)"
]);

async function main() {
  const args = parseArgs(process.argv);

  const receiptPath =
    args.receipt ||
    "evidence/phase-7.13/transparency-log-anchor-receipt.json";

  const logPath =
    args.log ||
    "manifests/transparency/transparency-log.json";

  const rpcUrl = args.rpc || process.env.BASE_SEPOLIA_RPC_URL;

  if (!rpcUrl) {
    throw new Error("Missing --rpc or BASE_SEPOLIA_RPC_URL");
  }

  const receiptDoc = readJson(receiptPath);
  const log = readJson(logPath);
  const errors = [];

  const localEntryCount = Number(
    log.entry_count ?? (Array.isArray(log.entries) ? log.entries.length : 0)
  );
  const localHeadEntryHash = toBytes32(log.head_entry_hash, "local head_entry_hash", errors);
  const localLogRoot = toBytes32(log.log_root, "local log_root", errors);

  const receiptHeadEntryHash = toBytes32(
    receiptDoc?.log?.head_entry_hash,
    "receipt head_entry_hash",
    errors
  );
  const receiptLogRoot = toBytes32(
    receiptDoc?.log?.log_root,
    "receipt log_root",
    errors
  );

  if (String(localEntryCount) !== String(receiptDoc?.log?.entry_count)) {
    errors.push("entry_count mismatch between local log and receipt");
  }

  if (localHeadEntryHash !== receiptHeadEntryHash) {
    errors.push("head_entry_hash mismatch between local log and receipt");
  }

  if (localLogRoot !== receiptLogRoot) {
    errors.push("log_root mismatch between local log and receipt");
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl)
  });

  const txReceipt = await publicClient.getTransactionReceipt({
    hash: receiptDoc.transaction.hash
  });

  const block = await publicClient.getBlock({
    blockHash: txReceipt.blockHash
  });

  if (txReceipt.blockHash !== receiptDoc.transaction.block_hash) {
    errors.push("block_hash mismatch between chain receipt and receipt file");
  }

  if (txReceipt.blockNumber.toString() !== String(receiptDoc.transaction.block_number)) {
    errors.push("block_number mismatch between chain receipt and receipt file");
  }

  if (txReceipt.transactionIndex.toString() !== String(receiptDoc.transaction.transaction_index)) {
    errors.push("transaction_index mismatch between chain receipt and receipt file");
  }

  if (txReceipt.status !== receiptDoc.transaction.status) {
    errors.push("transaction status mismatch between chain receipt and receipt file");
  }

  const matchingLog = txReceipt.logs.find((l) => {
    if (l.address.toLowerCase() !== receiptDoc.anchor_contract.toLowerCase()) {
      return false;
    }
    try {
      const decoded = decodeEventLog({
        abi: ABI,
        data: l.data,
        topics: l.topics
      });
      return decoded.eventName === "TransparencyLogRootAnchored";
    } catch {
      return false;
    }
  });

  if (!matchingLog) {
    errors.push("anchor event not found on-chain");
  }

  let decoded = null;

  if (matchingLog) {
    decoded = decodeEventLog({
      abi: ABI,
      data: matchingLog.data,
      topics: matchingLog.topics
    });

    if (decoded.args.logRoot !== receiptLogRoot) {
      errors.push("event logRoot mismatch");
    }

    if (decoded.args.headEntryHash !== receiptHeadEntryHash) {
      errors.push("event headEntryHash mismatch");
    }

    if (decoded.args.entryCount.toString() !== String(receiptDoc.log.entry_count)) {
      errors.push("event entryCount mismatch");
    }

    if (decoded.args.anchoredAtBlock.toString() !== String(receiptDoc.event.anchored_at_block)) {
      errors.push("event anchoredAtBlock mismatch");
    }

    if (decoded.args.anchoredAtTimestamp.toString() !== String(receiptDoc.event.anchored_at_timestamp)) {
      errors.push("event anchoredAtTimestamp mismatch");
    }

    if (decoded.args.anchorer.toLowerCase() !== receiptDoc.event.anchorer.toLowerCase()) {
      errors.push("event anchorer mismatch");
    }

    if (matchingLog.logIndex.toString() !== String(receiptDoc.event.log_index)) {
      errors.push("event log_index mismatch");
    }
  }

  const state = await publicClient.readContract({
    address: receiptDoc.anchor_contract,
    abi: ABI,
    functionName: "getAnchor",
    args: [receiptLogRoot]
  });

  const [
    anchored,
    headEntryHash,
    entryCount,
    anchoredAtBlock,
    anchoredAtTimestamp,
    anchorer
  ] = state;

  if (!anchored) {
    errors.push("contract state shows log root is not anchored");
  }

  if (headEntryHash !== receiptHeadEntryHash) {
    errors.push("contract state headEntryHash mismatch");
  }

  if (entryCount.toString() !== String(receiptDoc.log.entry_count)) {
    errors.push("contract state entryCount mismatch");
  }

  if (anchoredAtBlock.toString() !== String(receiptDoc.event.anchored_at_block)) {
    errors.push("contract state anchoredAtBlock mismatch");
  }

  if (anchoredAtTimestamp.toString() !== String(receiptDoc.event.anchored_at_timestamp)) {
    errors.push("contract state anchoredAtTimestamp mismatch");
  }

  if (anchorer.toLowerCase() !== receiptDoc.event.anchorer.toLowerCase()) {
    errors.push("contract state anchorer mismatch");
  }

  const result = {
    ok: errors.length === 0,
    schema: "grant-audit-transparency-log-anchor-verification-v1",
    network: "base-sepolia",
    receipt_path: path.resolve(receiptPath),
    log_path: path.resolve(logPath),
    anchor_contract: receiptDoc.anchor_contract,
    log_root: receiptLogRoot,
    head_entry_hash: receiptHeadEntryHash,
    entry_count: String(receiptDoc.log.entry_count),
    tx_hash: receiptDoc.transaction.hash,
    block_number: txReceipt.blockNumber.toString(),
    block_hash: txReceipt.blockHash,
    block_timestamp: block.timestamp.toString(),
    anchored: anchored,
    errors
  };

  process.stdout.write(
    JSON.stringify(
      result,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2
    ) + "\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
