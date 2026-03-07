#!/usr/bin/env node

import fs from "fs";
import crypto from "crypto";
import path from "path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
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

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stable(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalize(value) {
  return JSON.stringify(stable(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function buildEntryHashPayload(entry) {
  const { entry_hash, ...rest } = entry;
  return rest;
}

function computeEntryHash(entry) {
  return sha256Hex(canonicalize(buildEntryHashPayload(entry)));
}

function computeLogRoot(entries) {
  return sha256Hex(
    canonicalize({
      entry_hashes: entries.map((entry) => entry.entry_hash)
    })
  );
}

function usage() {
  console.error(`
Usage:
  node scripts/audit/verify-transparency-log.mjs --log <file>
`);
  process.exit(1);
}

const args = parseArgs(process.argv);
if (!args.log) usage();

const logPath = path.resolve(args.log);
const log = readJson(logPath);

const errors = [];

if (log.schema !== "grant-audit-transparency-log-v1") {
  errors.push(`unexpected log schema: ${log.schema || "<missing>"}`);
}

if (!Array.isArray(log.entries)) {
  errors.push("entries must be an array");
}

const entries = Array.isArray(log.entries) ? log.entries : [];

let chainIntact = true;
let contiguousIndices = true;
let monotonicTimestamps = true;
const duplicatePacketManifestHashes = [];
const seenPacketManifestHashes = new Map();

for (let i = 0; i < entries.length; i += 1) {
  const entry = entries[i];

  if (entry.schema !== "grant-audit-transparency-log-entry-v1") {
    errors.push(`unexpected entry schema at index ${i}: ${entry.schema || "<missing>"}`);
  }

  if (entry.index !== i) {
    contiguousIndices = false;
    errors.push(`index mismatch at position ${i}: expected ${i}, received ${entry.index}`);
  }

  const expectedPrev = i === 0 ? null : entries[i - 1].entry_hash;
  if (entry.prev_entry_hash !== expectedPrev) {
    chainIntact = false;
    errors.push(`prev_entry_hash mismatch at index ${i}`);
  }

  const expectedEntryHash = computeEntryHash(entry);
  if (entry.entry_hash !== expectedEntryHash) {
    chainIntact = false;
    errors.push(`entry_hash mismatch at index ${i}`);
  }

  if (i > 0) {
    const prior = new Date(entries[i - 1].appended_at).getTime();
    const current = new Date(entry.appended_at).getTime();
    if (Number.isFinite(prior) && Number.isFinite(current) && current < prior) {
      monotonicTimestamps = false;
      errors.push(`appended_at is not monotonic at index ${i}`);
    }
  }

  const priorIndex = seenPacketManifestHashes.get(entry.packet_manifest_hash);
  if (priorIndex !== undefined) {
    duplicatePacketManifestHashes.push({
      packet_manifest_hash: entry.packet_manifest_hash,
      first_index: priorIndex,
      duplicate_index: i
    });
    errors.push(
      `duplicate packet_manifest_hash detected at index ${i} (first seen at ${priorIndex})`
    );
  } else {
    seenPacketManifestHashes.set(entry.packet_manifest_hash, i);
  }
}

const expectedHead =
  entries.length === 0 ? null : entries[entries.length - 1].entry_hash;

if (log.head_entry_hash !== expectedHead) {
  errors.push("head_entry_hash mismatch");
}

const expectedRoot = computeLogRoot(entries);
if (log.log_root !== expectedRoot) {
  errors.push("log_root mismatch");
}

if (log.entry_count !== entries.length) {
  errors.push(
    `entry_count mismatch: expected ${entries.length}, received ${log.entry_count}`
  );
}

const result = {
  ok: errors.length === 0,
  schema: "grant-audit-transparency-log-verification-v1",
  log_path: logPath,
  entry_count: entries.length,
  contiguous_indices: contiguousIndices,
  chain_intact: chainIntact,
  monotonic_timestamps: monotonicTimestamps,
  duplicate_packet_manifest_hashes: duplicatePacketManifestHashes,
  head_entry_hash: log.head_entry_hash,
  expected_head_entry_hash: expectedHead,
  log_root: log.log_root,
  expected_log_root: expectedRoot,
  first_entry_hash: entries.length ? entries[0].entry_hash : null,
  last_entry_hash: entries.length ? entries[entries.length - 1].entry_hash : null,
  errors
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
