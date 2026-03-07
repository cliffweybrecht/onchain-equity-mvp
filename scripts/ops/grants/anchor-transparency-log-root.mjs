#!/usr/bin/env node

import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
  parseAbiItem
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      value,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2
    ) + "\n"
  );
}

function writeText(filePath, text) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, text.endsWith("\n") ? text : text + "\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeBytes32(value, label) {
  const s = String(value);
  const normalized = s.startsWith("0x") ? s : `0x${s}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex string`);
  }
  return normalized;
}

const ABI = parseAbi([
  "function anchorLogRoot(bytes32 logRoot, bytes32 headEntryHash, uint256 entryCount)",
  "function getAnchor(bytes32 logRoot) view returns (bool anchored, bytes32 headEntryHash, uint256 entryCount, uint256 anchoredAtBlock, uint256 anchoredAtTimestamp, address anchorer)",
  "event TransparencyLogRootAnchored(bytes32 indexed logRoot, bytes32 indexed headEntryHash, uint256 indexed entryCount, uint256 anchoredAtBlock, uint256 anchoredAtTimestamp, address anchorer)"
]);

const ANCHOR_EVENT = parseAbiItem(
  "event TransparencyLogRootAnchored(bytes32 indexed logRoot, bytes32 indexed headEntryHash, uint256 indexed entryCount, uint256 anchoredAtBlock, uint256 anchoredAtTimestamp, address anchorer)"
);

async function main() {
  const args = parseArgs(process.argv);

  const logPath =
    args.log || "manifests/transparency/transparency-log.json";

  const outAnchor =
    args.outAnchor || "evidence/phase-7.13/transparency-log-anchor.json";

  const outReceipt =
    args.outReceipt || "evidence/phase-7.13/transparency-log-anchor-receipt.json";

  const outText =
    args.outText || "evidence/phase-7.13/transparency-log-anchor.txt";

  const rpcUrl = args.rpc || process.env.BASE_SEPOLIA_RPC_URL;
  const privateKey = args.privateKey || process.env.PRIVATE_KEY;
  const anchorContract =
    args.anchorContract || process.env.TRANSPARENCY_LOG_ANCHOR;

  if (!rpcUrl) throw new Error("Missing --rpc or BASE_SEPOLIA_RPC_URL");
  if (!privateKey) throw new Error("Missing --privateKey or PRIVATE_KEY");
  if (!anchorContract) {
    throw new Error("Missing --anchorContract or TRANSPARENCY_LOG_ANCHOR");
  }

  const log = readJson(logPath);
  const entryCount = Number(log.entry_count || (log.entries || []).length);
  const headEntryHash = normalizeBytes32(log.head_entry_hash, "head_entry_hash");
  const logRoot = normalizeBytes32(log.log_root, "log_root");

  if (!entryCount || entryCount < 1) {
    throw new Error("Transparency log is empty");
  }

  const anchorDoc = {
    schema: "grant-audit-transparency-log-anchor-v1",
    version: "1.0.0",
    created_at: new Date().toISOString(),
    network: {
      name: "base-sepolia",
      chain_id: baseSepolia.id
    },
    anchor_contract: anchorContract,
    log: {
      path: path.resolve(logPath),
      entry_count: entryCount,
      head_entry_hash: headEntryHash,
      log_root: logRoot
    }
  };

  writeJson(outAnchor, anchorDoc);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl)
  });

  const account = privateKeyToAccount(
    privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`
  );

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl)
  });

  const existing = await publicClient.readContract({
    address: anchorContract,
    abi: ABI,
    functionName: "getAnchor",
    args: [logRoot]
  });

  let txReceipt = null;
  let block = null;
  let decoded = null;
  let matchingLog = null;
  let txHash = null;

  if (!existing[0]) {
    txHash = await walletClient.writeContract({
      address: anchorContract,
      abi: ABI,
      functionName: "anchorLogRoot",
      args: [logRoot, headEntryHash, BigInt(entryCount)],
      account
    });

    txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    block = await publicClient.getBlock({
      blockNumber: txReceipt.blockNumber
    });

    matchingLog = txReceipt.logs.find((l) => {
      try {
        const evt = decodeEventLog({
          abi: ABI,
          data: l.data,
          topics: l.topics
        });
        return (
          l.address.toLowerCase() === anchorContract.toLowerCase() &&
          evt.eventName === "TransparencyLogRootAnchored"
        );
      } catch {
        return false;
      }
    });

    if (!matchingLog) {
      throw new Error("Anchor event not found in transaction receipt");
    }

    decoded = decodeEventLog({
      abi: ABI,
      data: matchingLog.data,
      topics: matchingLog.topics
    });
  } else {
    const anchoredAtBlock = existing[3];

    const logs = await publicClient.getLogs({
      address: anchorContract,
      event: ANCHOR_EVENT,
      args: {
        logRoot
      },
      fromBlock: anchoredAtBlock,
      toBlock: anchoredAtBlock,
      strict: true
    });

    if (!logs.length) {
      throw new Error(
        `Root is anchored in contract state but matching event log was not found in block ${anchoredAtBlock.toString()}`
      );
    }

    matchingLog = logs[0];
    txHash = matchingLog.transactionHash;

    txReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
    block = await publicClient.getBlock({ blockNumber: txReceipt.blockNumber });

    decoded = {
      eventName: matchingLog.eventName,
      args: matchingLog.args
    };
  }

  const receiptDoc = {
    schema: "grant-audit-transparency-log-anchor-receipt-v1",
    version: "1.0.0",
    created_at: new Date().toISOString(),
    network: {
      name: "base-sepolia",
      chain_id: baseSepolia.id
    },
    anchor_contract: anchorContract,
    log: {
      path: path.resolve(logPath),
      entry_count: entryCount,
      head_entry_hash: headEntryHash,
      log_root: logRoot
    },
    transaction: {
      hash: txHash,
      block_number: txReceipt.blockNumber.toString(),
      block_hash: txReceipt.blockHash,
      transaction_index: txReceipt.transactionIndex.toString(),
      status: txReceipt.status
    },
    event: {
      name: decoded.eventName,
      log_index: matchingLog.logIndex.toString(),
      anchored_at_block: decoded.args.anchoredAtBlock.toString(),
      anchored_at_timestamp: decoded.args.anchoredAtTimestamp.toString(),
      anchorer: decoded.args.anchorer
    },
    block: {
      timestamp: block.timestamp.toString()
    }
  };

  writeJson(outReceipt, receiptDoc);

  const summary = [
    `schema: ${receiptDoc.schema}`,
    `network: ${receiptDoc.network.name}`,
    `anchor_contract: ${receiptDoc.anchor_contract}`,
    `log_path: ${receiptDoc.log.path}`,
    `log_root: ${receiptDoc.log.log_root}`,
    `head_entry_hash: ${receiptDoc.log.head_entry_hash}`,
    `entry_count: ${receiptDoc.log.entry_count}`,
    `tx_hash: ${receiptDoc.transaction.hash}`,
    `block_number: ${receiptDoc.transaction.block_number}`,
    `block_hash: ${receiptDoc.transaction.block_hash}`,
    `transaction_index: ${receiptDoc.transaction.transaction_index}`,
    `status: ${receiptDoc.transaction.status}`,
    `event_name: ${receiptDoc.event.name}`,
    `event_log_index: ${receiptDoc.event.log_index}`,
    `anchored_at_block: ${receiptDoc.event.anchored_at_block}`,
    `anchored_at_timestamp: ${receiptDoc.event.anchored_at_timestamp}`,
    `anchorer: ${receiptDoc.event.anchorer}`
  ].join("\n");

  writeText(outText, summary);

  console.log(
    JSON.stringify(
      receiptDoc,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
