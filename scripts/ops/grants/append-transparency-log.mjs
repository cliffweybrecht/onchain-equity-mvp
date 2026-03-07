#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function usage() {
  console.error(`
Usage:
  node scripts/ops/grants/append-transparency-log.mjs \
    --transparency-manifest <file> \
    --log <file> \
    [--out <file>] \
    [--packet-path <string>] \
    [--note <string>]

Required:
  --transparency-manifest   Path to transparency manifest JSON
  --log                     Existing or new transparency log path

Optional:
  --out                     Output file path (defaults to --log)
  --packet-path             Logical packet path/label to store in entry
  --note                    Single note string to attach to the entry
`);
  process.exit(1);
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

function verifyExistingLogShape(log) {
  if (!log || typeof log !== "object") {
    throw new Error("Existing log is not a valid object");
  }

  if (log.schema !== "grant-audit-transparency-log-v1") {
    throw new Error(`Unexpected log schema: ${log.schema || "<missing>"}`);
  }

  if (!Array.isArray(log.entries)) {
    throw new Error("Existing log entries must be an array");
  }

  for (let i = 0; i < log.entries.length; i += 1) {
    const entry = log.entries[i];

    if (entry.index !== i) {
      throw new Error(`Existing log index mismatch at position ${i}`);
    }

    const expectedPrev = i === 0 ? null : log.entries[i - 1].entry_hash;
    if (entry.prev_entry_hash !== expectedPrev) {
      throw new Error(`Existing log prev_entry_hash mismatch at index ${i}`);
    }

    const expectedEntryHash = computeEntryHash(entry);
    if (entry.entry_hash !== expectedEntryHash) {
      throw new Error(`Existing log entry_hash mismatch at index ${i}`);
    }
  }

  const expectedHead =
    log.entries.length === 0 ? null : log.entries[log.entries.length - 1].entry_hash;

  if (log.head_entry_hash !== expectedHead) {
    throw new Error("Existing log head_entry_hash mismatch");
  }

  const expectedRoot = computeLogRoot(log.entries);
  if (log.log_root !== expectedRoot) {
    throw new Error("Existing log root mismatch");
  }

  if (log.entry_count !== log.entries.length) {
    throw new Error("Existing log entry_count mismatch");
  }
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function toNonNegativeInteger(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

function extractPacketManifestHash(transparencyManifest) {
  return firstDefined(
    transparencyManifest.packet_manifest_hash,
    transparencyManifest.packet?.manifest_hash,
    transparencyManifest.manifest?.packet_manifest_hash,
    transparencyManifest.audit_packet?.manifest_hash,
    transparencyManifest.packet_hash
  );
}

function extractLifecycleStatus(transparencyManifest) {
  return firstDefined(
    transparencyManifest.lifecycle_status,
    transparencyManifest.lifecycle?.status,
    transparencyManifest.packet_lifecycle?.status,
    transparencyManifest.status,
    transparencyManifest.packet_status
  );
}

function extractBoundBlockNumber(transparencyManifest) {
  return toNonNegativeInteger(
    firstDefined(
      transparencyManifest.bound_block_number,
      transparencyManifest.current_block_number,
      transparencyManifest.block_number,
      transparencyManifest.binding?.bound_block_number,
      transparencyManifest.binding?.current_block_number,
      transparencyManifest.binding?.block_number,
      transparencyManifest.chain_binding?.bound_block_number,
      transparencyManifest.chain_binding?.current_block_number,
      transparencyManifest.chain_binding?.block_number,
      transparencyManifest.packet_binding?.bound_block_number,
      transparencyManifest.packet_binding?.current_block_number,
      transparencyManifest.packet_binding?.block_number,
      transparencyManifest.base_sepolia_binding?.bound_block_number,
      transparencyManifest.base_sepolia_binding?.current_block_number,
      transparencyManifest.base_sepolia_binding?.block_number,
      transparencyManifest.anchor?.bound_block_number,
      transparencyManifest.anchor?.current_block_number,
      transparencyManifest.anchor?.block_number,
      transparencyManifest.freshness?.bound_block_number,
      transparencyManifest.freshness?.current_block_number,
      transparencyManifest.freshness?.block_number,
      transparencyManifest.packet_freshness?.bound_block_number,
      transparencyManifest.packet_freshness?.current_block_number,
      transparencyManifest.packet_freshness?.block_number,
      transparencyManifest.state_binding?.bound_block_number,
      transparencyManifest.state_binding?.current_block_number,
      transparencyManifest.state_binding?.block_number
    )
  );
}

const args = parseArgs(process.argv);
if (!args["transparency-manifest"] || !args.log) {
  usage();
}

const transparencyManifestPath = path.resolve(args["transparency-manifest"]);
const logPath = path.resolve(args.log);
const outPath = path.resolve(args.out || args.log);
const packetPath = args["packet-path"] || "";
const note = args.note ? [String(args.note)] : [];

const transparencyManifest = readJson(transparencyManifestPath);

if (transparencyManifest.schema !== "grant-audit-transparency-manifest-v1") {
  throw new Error(
    `Unexpected transparency manifest schema: ${transparencyManifest.schema || "<missing>"}`
  );
}

const packetManifestHash = extractPacketManifestHash(transparencyManifest);
const lifecycleStatus = extractLifecycleStatus(transparencyManifest);
const boundBlockNumber = extractBoundBlockNumber(transparencyManifest);

if (!packetManifestHash || !/^[a-f0-9]{64}$/.test(packetManifestHash)) {
  throw new Error("transparency manifest packet_manifest_hash is missing or invalid");
}

if (!["active", "superseded", "revoked"].includes(lifecycleStatus)) {
  throw new Error("transparency manifest lifecycle status is missing or invalid");
}

if (!Number.isInteger(boundBlockNumber) || boundBlockNumber < 0) {
  throw new Error("transparency manifest bound_block_number is missing or invalid");
}

const transparencyManifestHash = sha256Hex(canonicalize(transparencyManifest));

let existingLog;
if (fs.existsSync(logPath)) {
  existingLog = readJson(logPath);
  verifyExistingLogShape(existingLog);
} else {
  existingLog = {
    schema: "grant-audit-transparency-log-v1",
    log_version: "1.0.0",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    entry_count: 0,
    head_entry_hash: null,
    log_root: sha256Hex(canonicalize({ entry_hashes: [] })),
    entries: []
  };
}

const duplicate = existingLog.entries.find(
  (entry) => entry.packet_manifest_hash === packetManifestHash
);

if (duplicate) {
  throw new Error(
    `Packet manifest hash already present in transparency log at index ${duplicate.index}`
  );
}

const index = existingLog.entries.length;
const prevEntryHash = index === 0 ? null : existingLog.entries[index - 1].entry_hash;

const newEntry = {
  schema: "grant-audit-transparency-log-entry-v1",
  entry_version: "1.0.0",
  index,
  appended_at: new Date().toISOString(),
  packet_manifest_hash: packetManifestHash,
  transparency_manifest_hash: transparencyManifestHash,
  lifecycle_status: lifecycleStatus,
  bound_block_number: boundBlockNumber,
  prev_entry_hash: prevEntryHash,
  entry_hash: "",
  ...(packetPath ? { packet_path: packetPath } : {}),
  ...(note.length ? { notes: note } : {})
};

newEntry.entry_hash = computeEntryHash(newEntry);

const entries = [...existingLog.entries, newEntry];

const nextLog = {
  schema: "grant-audit-transparency-log-v1",
  log_version: "1.0.0",
  created_at: existingLog.created_at,
  updated_at: new Date().toISOString(),
  entry_count: entries.length,
  head_entry_hash: entries.length === 0 ? null : entries[entries.length - 1].entry_hash,
  log_root: computeLogRoot(entries),
  entries
};

writeJson(outPath, nextLog);

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: "grant-audit-transparency-log-append-result-v1",
      log_path: outPath,
      appended_index: newEntry.index,
      packet_manifest_hash: newEntry.packet_manifest_hash,
      entry_hash: newEntry.entry_hash,
      prev_entry_hash: newEntry.prev_entry_hash,
      head_entry_hash: nextLog.head_entry_hash,
      log_root: nextLog.log_root,
      entry_count: nextLog.entry_count
    },
    null,
    2
  )
);
