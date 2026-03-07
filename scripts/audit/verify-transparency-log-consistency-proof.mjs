#!/usr/bin/env node

import fs from "fs";

const HASH_RE = /^0x[a-f0-9]{64}$/;

function usage() {
  console.error(`
Usage:
  node scripts/audit/verify-transparency-log-consistency-proof.mjs \\
    manifests/transparency/transparency-log-consistency-proof.json \\
    manifests/transparency/transparency-log.json
`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function resolvePrefixStateFromLog(logJson, oldSize, currentState) {
  if (oldSize === currentState.entry_count) {
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
        `Add a cumulative per-entry root field during append to support general consistency proofs.`
      ].join(" ")
    );
  }

  return {
    entry_count: oldSize,
    head_entry_hash: prefixHead,
    log_root: prefixRoot
  };
}

function assertArrayEqual(actual, expected, label) {
  if (actual.length !== expected.length) {
    throw new Error(`${label} length mismatch: expected ${expected.length}, got ${actual.length}`);
  }

  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`${label}[${i}] mismatch: expected ${expected[i]}, got ${actual[i]}`);
    }
  }
}

function main() {
  const proofPath = process.argv[2];
  const logPath = process.argv[3];
  if (!proofPath || !logPath) usage();

  const proofDoc = readJson(proofPath);
  const logJson = readJson(logPath);

  if (proofDoc.schema !== "grant-audit-transparency-log-consistency-proof-v1") {
    throw new Error(`Unexpected proof schema: ${proofDoc.schema}`);
  }

  if (proofDoc.proof_version !== "1.0.0") {
    throw new Error(`Unexpected proof version: ${proofDoc.proof_version}`);
  }

  const p = proofDoc.proof;
  if (!p || typeof p !== "object") throw new Error("Missing proof object");

  if (p.model !== "append-only-prefix-consistency") {
    throw new Error(`Unexpected proof.model: ${p.model}`);
  }

  if (p.normalization !== "0x-lowercase-64-hex") {
    throw new Error(`Unexpected proof.normalization: ${p.normalization}`);
  }

  const currentState = extractCurrentLogState(logJson);
  const currentEntryHashes = extractNormalizedEntryHashes(logJson);

  if (currentState.entry_count !== currentEntryHashes.length) {
    throw new Error(
      `transparency-log entry_count mismatch: top-level says ${currentState.entry_count}, entries[] length is ${currentEntryHashes.length}`
    );
  }

  const oldSize = p.old_size;
  const newSize = p.new_size;

  if (!Number.isInteger(oldSize) || oldSize < 0) {
    throw new Error("proof.old_size must be a non-negative integer");
  }

  if (!Number.isInteger(newSize) || newSize < 0) {
    throw new Error("proof.new_size must be a non-negative integer");
  }

  if (oldSize > newSize) {
    throw new Error(`old_size (${oldSize}) cannot exceed new_size (${newSize})`);
  }

  if (newSize !== currentState.entry_count) {
    throw new Error(`new_size mismatch: proof has ${newSize}, current log derives ${currentState.entry_count}`);
  }

  const prefixEntryHashes = currentEntryHashes.slice(0, oldSize);
  const appendedEntryHashes = currentEntryHashes.slice(oldSize);
  const prefixState = resolvePrefixStateFromLog(logJson, oldSize, currentState);

  assertArrayEqual(
    prefixEntryHashes,
    (p.prefix_entry_hashes || []).map((x, i) => normalizeHash(x, `proof.prefix_entry_hashes[${i}]`)),
    "proof.prefix_entry_hashes"
  );

  assertArrayEqual(
    appendedEntryHashes,
    (p.appended_entry_hashes || []).map((x, i) => normalizeHash(x, `proof.appended_entry_hashes[${i}]`)),
    "proof.appended_entry_hashes"
  );

  const expectedOldHead = normalizeHash(p.old_head_entry_hash, "proof.old_head_entry_hash");
  const expectedNewHead = normalizeHash(p.new_head_entry_hash, "proof.new_head_entry_hash");
  const expectedOldRoot = normalizeHash(p.old_log_root, "proof.old_log_root");
  const expectedNewRoot = normalizeHash(p.new_log_root, "proof.new_log_root");

  if (prefixState.head_entry_hash !== expectedOldHead) {
    throw new Error(`Old head mismatch: proof has ${expectedOldHead}, derived ${prefixState.head_entry_hash}`);
  }

  if (currentState.head_entry_hash !== expectedNewHead) {
    throw new Error(`New head mismatch: proof has ${expectedNewHead}, derived ${currentState.head_entry_hash}`);
  }

  if (prefixState.log_root !== expectedOldRoot) {
    throw new Error(`Old root mismatch: proof has ${expectedOldRoot}, derived ${prefixState.log_root}`);
  }

  if (currentState.log_root !== expectedNewRoot) {
    throw new Error(`New root mismatch: proof has ${expectedNewRoot}, derived ${currentState.log_root}`);
  }

  if (proofDoc.base_checkpoint.entry_count !== oldSize) {
    throw new Error(`base_checkpoint.entry_count mismatch: expected ${oldSize}, got ${proofDoc.base_checkpoint.entry_count}`);
  }

  if (normalizeHash(proofDoc.base_checkpoint.head_entry_hash, "base_checkpoint.head_entry_hash") !== expectedOldHead) {
    throw new Error("base_checkpoint.head_entry_hash mismatch");
  }

  if (normalizeHash(proofDoc.base_checkpoint.checkpoint_log_root, "base_checkpoint.checkpoint_log_root") !== expectedOldRoot) {
    throw new Error("base_checkpoint.checkpoint_log_root mismatch");
  }

  if (proofDoc.candidate_state.entry_count !== newSize) {
    throw new Error(`candidate_state.entry_count mismatch: expected ${newSize}, got ${proofDoc.candidate_state.entry_count}`);
  }

  if (normalizeHash(proofDoc.candidate_state.head_entry_hash, "candidate_state.head_entry_hash") !== expectedNewHead) {
    throw new Error("candidate_state.head_entry_hash mismatch");
  }

  if (normalizeHash(proofDoc.candidate_state.checkpoint_log_root, "candidate_state.checkpoint_log_root") !== expectedNewRoot) {
    throw new Error("candidate_state.checkpoint_log_root mismatch");
  }

  console.log("PASS: transparency log consistency proof verified");
  console.log(`  proof:      ${proofPath}`);
  console.log(`  log:        ${logPath}`);
  console.log(`  old_size:   ${oldSize}`);
  console.log(`  new_size:   ${newSize}`);
  console.log(`  appended:   ${newSize - oldSize}`);
  console.log(`  old_root:   ${expectedOldRoot}`);
  console.log(`  new_root:   ${expectedNewRoot}`);
  console.log(`  old_head:   ${expectedOldHead}`);
  console.log(`  new_head:   ${expectedNewHead}`);
}

main();
