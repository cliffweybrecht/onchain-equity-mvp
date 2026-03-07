#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const part = argv[i];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(data) {
  return "0x" + crypto.createHash("sha256").update(data).digest("hex");
}

function normalizeHash(value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  return v.startsWith("0x") ? v : `0x${v}`;
}

function strip0x(value) {
  return normalizeHash(value).slice(2);
}

function hashPair(leftHex, rightHex) {
  const left = Buffer.from(strip0x(leftHex), "hex");
  const right = Buffer.from(strip0x(rightHex), "hex");
  return sha256Hex(Buffer.concat([left, right]));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function entryHash(entry) {
  if (entry.entry_hash) return normalizeHash(entry.entry_hash);
  const clone = JSON.parse(JSON.stringify(entry));
  delete clone.entry_hash;
  delete clone.leaf_hash;
  return sha256Hex(canonicalStringify(clone));
}

function extractPacketSha(entry) {
  const candidates = [
    entry?.packet_sha256,
    entry?.audit_packet_sha256,
    entry?.packet?.sha256,
    entry?.audit_packet?.sha256,
    entry?.packet_manifest_sha256,
    entry?.packet?.manifest_sha256,
    entry?.packet_manifest_hash,
    entry?.transparency_manifest_hash,
    entry?.artifact?.packet_sha256
  ].filter(Boolean);

  if (candidates.length === 0) return null;
  return normalizeHash(candidates[0]);
}

function extractPacketPath(entry) {
  const candidates = [
    entry?.packet_path,
    entry?.packet?.path,
    entry?.audit_packet?.path,
    entry?.artifact?.packet_path
  ].filter(Boolean);

  return candidates[0] || null;
}

function extractEntryId(entry, idx) {
  return entry?.entry_id || entry?.id || entry?.packet_id || `entry-${idx}`;
}

function buildMerkleRoot(leaves) {
  if (leaves.length === 0) return "0x" + "00".repeat(32);
  let level = [...leaves];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || level[i];
      next.push(hashPair(left, right));
    }
    level = next;
  }
  return level[0];
}

function main() {
  const args = parseArgs(process.argv);

  const logPath = args.log || "manifests/transparency/transparency-log.json";
  const outPath = args.out || "manifests/transparency/transparency-log-index.json";

  const log = readJson(logPath);
  const entries = Array.isArray(log.entries) ? log.entries : [];

  const leaves = entries.map((entry, index) => ({
    index,
    entry_hash: entryHash(entry),
    packet_sha256: extractPacketSha(entry),
    packet_path: extractPacketPath(entry),
    entry_id: extractEntryId(entry, index)
  }));

  const merkleRoot = buildMerkleRoot(leaves.map((x) => x.entry_hash));
  const sourceBytes = fs.readFileSync(logPath);

  const indexDoc = {
    schema: "grant-audit-transparency-log-index-v1",
    version: "1.0.0",
    created_at: new Date().toISOString(),
    source_log: {
      path: logPath,
      sha256: sha256Hex(sourceBytes)
    },
    checkpoint: {
      entry_count: Number(log.entry_count ?? entries.length),
      head_entry_hash: normalizeHash(log.head_entry_hash || leaves[leaves.length - 1]?.entry_hash || "0x" + "00".repeat(32)),
      log_root: normalizeHash(log.log_root || "0x" + "00".repeat(32))
    },
    merkle: {
      algorithm: "sha256-pair-duplicate-last",
      leaf_hash_type: "transparency-log-entry-hash",
      leaf_count: leaves.length,
      root: merkleRoot
    },
    leaves
  };

  writeJson(outPath, indexDoc);
  console.log(JSON.stringify({
    ok: true,
    schema: "grant-audit-transparency-log-index-v1",
    out: outPath,
    leaf_count: leaves.length,
    merkle_root: merkleRoot,
    checkpoint_log_root: indexDoc.checkpoint.log_root
  }, null, 2));
}

main();
