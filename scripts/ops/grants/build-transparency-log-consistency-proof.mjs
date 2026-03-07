#!/usr/bin/env node

import fs from "fs";
import path from "path";

const HASH_RE = /^0x[a-f0-9]{64}$/;

function usage() {
  console.error(`
Usage:
  node scripts/ops/grants/build-transparency-log-consistency-proof.mjs \\
    --checkpoint manifests/transparency/checkpoint.json \\
    --log manifests/transparency/transparency-log.json \\
    --out manifests/transparency/transparency-log-consistency-proof.json
`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    out[key] = value;
    i++;
  }
  return out;
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value), null, 2);
}

function writeJson(filePath, value) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, canonicalStringify(value) + "\n");
}

function normalizeHash(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string; got ${JSON.stringify(value)}`);
  }

  let hex = value.trim().toLowerCase();
  if (!hex.startsWith("0x")) hex = "0x" + hex;

  if (!HASH_RE.test(hex)) {
    throw new Error(`${label} must be a 0x-prefixed 32-byte hex string; got ${JSON.stringify(value)}`);
  }

  return hex;
}

function getFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function extractCheckpointState(checkpointDoc) {
  if (!checkpointDoc || typeof checkpointDoc !== "object") {
    throw new Error("Invalid checkpoint JSON");
  }

  const entryCount = checkpointDoc.entry_count;
  if (!Number.isInteger(entryCount) || entryCount < 0) {
    throw new Error(`checkpoint.entry_count must be a non-negative integer; got ${JSON.stringify(entryCount)}`);
  }

  return {
    entry_count: entryCount,
    head_entry_hash: normalizeHash(checkpointDoc.head_entry_hash, "checkpoint.head_entry_hash"),
    entries_merkle_root: normalizeHash(checkpointDoc.entries_merkle_root, "checkpoint.entries_merkle_root"),
    checkpoint_log_root: normalizeHash(checkpointDoc.checkpoint_log_root, "checkpoint.checkpoint_log_root")
  };
}

function extractNormalizedEntryHashes(logJson) {
  if (!logJson || typeof logJson !== "object") {
    throw new Error("Invalid transparency log JSON");
  }

  if (!Array.isArray(logJson.entries)) {
    throw new Error("transparency-log.json must contain entries[]");
  }

  return logJson.entries.map((entry, i) => {
    const raw = getFirstDefined(
      entry?.entry_hash,
      entry?.hash,
      entry?.normalized_entry_hash
    );

    if (!raw) {
      throw new Error(`entries[${i}] is missing entry_hash`);
    }

    return normalizeHash(raw, `entries[${i}].entry_hash`);
  });
}

function extractCurrentLogState(logJson) {
  if (!logJson || typeof logJson !== "object") {
    throw new Error("Invalid transparency log JSON");
  }

  if (!Number.isInteger(logJson.entry_count) || logJson.entry_count < 0) {
    throw new Error(`transparency-log.entry_count must be a non-negative integer; got ${JSON.stringify(logJson.entry_count)}`);
  }

  return {
    entry_count: logJson.entry_count,
    head_entry_hash: normalizeHash(logJson.head_entry_hash, "transparency-log.head_entry_hash"),
    log_root: normalizeHash(logJson.log_root, "transparency-log.log_root")
  };
}

function tryResolvePrefixLogRootFromEntry(entry, index) {
  if (!entry || typeof entry !== "object") return undefined;

  const candidates = [
    entry.checkpoint_log_root,
    entry.log_root,
    entry.cumulative_log_root,
    entry.cumulative_root,
    entry.running_log_root,
    entry.root_after_append,
    entry.state_root_after_append
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      try {
        return normalizeHash(candidate, `entries[${index}] prefix log root`);
      } catch {
        // continue
      }
    }
  }

  return undefined;
}

function resolvePrefixStateFromLog(logJson, checkpoint, currentState) {
  const oldSize = checkpoint.entry_count;
  const newSize = currentState.entry_count;

  if (oldSize === newSize) {
    return {
      entry_count: currentState.entry_count,
      head_entry_hash: currentState.head_entry_hash,
      log_root: currentState.log_root
    };
  }

  const prefixEntries = logJson.entries.slice(0, oldSize);
  const prefixHead = normalizeHash(
    getFirstDefined(
      prefixEntries[prefixEntries.length - 1]?.entry_hash,
      prefixEntries[prefixEntries.length - 1]?.hash,
      prefixEntries[prefixEntries.length - 1]?.normalized_entry_hash
    ),
    `entries[${oldSize - 1}].entry_hash`
  );

  const prefixRoot = tryResolvePrefixLogRootFromEntry(prefixEntries[prefixEntries.length - 1], oldSize - 1);

  if (!prefixRoot) {
    throw new Error(
      [
        `Cannot derive prefix log_root for old_size=${oldSize}.`,
        `The transparency log root model is not reproducible from entry hashes alone.`,
        `To support old_size < new_size, add a cumulative per-entry root field during append`,
        `such as checkpoint_log_root, cumulative_log_root, or root_after_append.`
      ].join(" ")
    );
  }

  return {
    entry_count: oldSize,
    head_entry_hash: prefixHead,
    log_root: prefixRoot
  };
}

function main() {
  const args = parseArgs(process.argv);
  const checkpointPath = args.checkpoint;
  const logPath = args.log;
  const outPath = args.out;

  if (!checkpointPath || !logPath || !outPath) usage();

  const checkpointDoc = readJson(checkpointPath);
  const logJson = readJson(logPath);

  const checkpoint = extractCheckpointState(checkpointDoc);
  const currentState = extractCurrentLogState(logJson);
  const currentEntryHashes = extractNormalizedEntryHashes(logJson);

  if (currentState.entry_count !== currentEntryHashes.length) {
    throw new Error(
      `transparency-log entry_count mismatch: top-level says ${currentState.entry_count}, entries[] length is ${currentEntryHashes.length}`
    );
  }

  if (checkpoint.entry_count > currentState.entry_count) {
    throw new Error(
      `Checkpoint entry_count (${checkpoint.entry_count}) cannot exceed current log entry_count (${currentState.entry_count})`
    );
  }

  const prefixState = resolvePrefixStateFromLog(logJson, checkpoint, currentState);
  const prefixEntryHashes = currentEntryHashes.slice(0, checkpoint.entry_count);
  const appendedEntryHashes = currentEntryHashes.slice(checkpoint.entry_count);

  if (prefixState.head_entry_hash !== checkpoint.head_entry_hash) {
    throw new Error(
      `Checkpoint head mismatch: expected ${checkpoint.head_entry_hash}, derived ${prefixState.head_entry_hash}`
    );
  }

  if (prefixState.log_root !== checkpoint.checkpoint_log_root) {
    throw new Error(
      `Checkpoint log_root mismatch: expected ${checkpoint.checkpoint_log_root}, derived ${prefixState.log_root}`
    );
  }

  const proof = {
    schema: "grant-audit-transparency-log-consistency-proof-v1",
    proof_version: "1.0.0",
    generated_at: new Date().toISOString(),
    base_checkpoint: {
      path: checkpointPath,
      entry_count: checkpoint.entry_count,
      head_entry_hash: checkpoint.head_entry_hash,
      entries_merkle_root: checkpoint.entries_merkle_root,
      checkpoint_log_root: checkpoint.checkpoint_log_root
    },
    candidate_state: {
      path: logPath,
      entry_count: currentState.entry_count,
      head_entry_hash: currentState.head_entry_hash,
      checkpoint_log_root: currentState.log_root
    },
    proof: {
      model: "append-only-prefix-consistency",
      normalization: "0x-lowercase-64-hex",
      root_model: "transparency-log-source-of-truth",
      old_size: checkpoint.entry_count,
      new_size: currentState.entry_count,
      old_head_entry_hash: checkpoint.head_entry_hash,
      new_head_entry_hash: currentState.head_entry_hash,
      old_log_root: checkpoint.checkpoint_log_root,
      new_log_root: currentState.log_root,
      prefix_entry_hashes: prefixEntryHashes,
      appended_entry_hashes: appendedEntryHashes
    }
  };

  writeJson(outPath, proof);

  console.log("Built transparency log consistency proof");
  console.log(`  checkpoint: ${checkpointPath}`);
  console.log(`  log:        ${logPath}`);
  console.log(`  out:        ${outPath}`);
  console.log(`  old_size:   ${checkpoint.entry_count}`);
  console.log(`  new_size:   ${currentState.entry_count}`);
  console.log(`  appended:   ${appendedEntryHashes.length}`);
  console.log(`  old_root:   ${checkpoint.checkpoint_log_root}`);
  console.log(`  new_root:   ${currentState.log_root}`);
}

main();
