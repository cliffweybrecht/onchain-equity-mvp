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
  if (Array.isArray(value)) return value.map(canonicalize);

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

function buildProof(leaves, targetIndex) {

  const siblings = [];

  let index = targetIndex;
  let level = [...leaves];

  while (level.length > 1) {

    const isRightNode = index % 2 === 1;
    const pairIndex = isRightNode ? index - 1 : index + 1;

    const siblingHash = level[pairIndex] || level[index];

    siblings.push({
      position: isRightNode ? "left" : "right",
      hash: siblingHash
    });

    const next = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || level[i];
      next.push(hashPair(left, right));
    }

    index = Math.floor(index / 2);
    level = next;
  }

  return siblings;
}

function main() {

  const args = parseArgs(process.argv);

  const packetPath = args.packet;
  const packetShaArg = args["packet-sha256"];

  const logPath = args.log || "manifests/transparency/transparency-log.json";
  const indexPath = args.index || "manifests/transparency/transparency-log-index.json";

  const outPath = args.out || "evidence/phase-7.14/transparency-log-inclusion-proof.json";

  if (!packetPath && !packetShaArg) {
    throw new Error("Provide --packet <path> or --packet-sha256 <hash>");
  }

  let packetSha;

  if (packetShaArg) {
    packetSha = normalizeHash(packetShaArg);
  } else {
    packetSha = sha256Hex(fs.readFileSync(packetPath));
  }

  const log = readJson(logPath);
  const indexDoc = readJson(indexPath);

  const entries = Array.isArray(log.entries) ? log.entries : [];

  const matchedIndex = entries.findIndex(
    (entry) => extractPacketSha(entry) === packetSha
  );

  if (matchedIndex === -1) {

    const available = entries.map((entry, i) => ({
      index: i,
      entry_hash: entryHash(entry),
      packet_sha256: extractPacketSha(entry)
    }));

    throw new Error(
      `No transparency log entry found for packet digest ${packetSha}\n` +
      `Available entries:\n${JSON.stringify(available, null, 2)}`
    );
  }

  const entry = entries[matchedIndex];

  const computedEntryHash = entryHash(entry);

  const leaf = indexDoc.leaves.find(
    (x) => Number(x.index) === matchedIndex
  );

  if (!leaf) {
    throw new Error(`No Merkle index leaf found for entry ${matchedIndex}`);
  }

  if (normalizeHash(leaf.entry_hash) !== computedEntryHash) {
    throw new Error("Merkle index leaf hash mismatch");
  }

  const leafHashes = indexDoc.leaves.map((x) => normalizeHash(x.entry_hash));

  const siblings = buildProof(leafHashes, matchedIndex);

  const proof = {

    schema: "grant-audit-transparency-log-inclusion-proof-v1",

    version: "1.0.0",

    created_at: new Date().toISOString(),

    packet: {
      path: packetPath || "",
      sha256: packetSha
    },

    entry,

    entry_hash: computedEntryHash,

    checkpoint: {
      entry_count: log.entry_count,
      head_entry_hash: normalizeHash(log.head_entry_hash),
      log_root: normalizeHash(log.log_root)
    },

    index: {
      path: indexPath,
      merkle_root: normalizeHash(indexDoc.merkle.root),
      leaf_count: Number(indexDoc.merkle.leaf_count),
      leaf_index: matchedIndex
    },

    inclusion_proof: {
      algorithm: "sha256-pair-duplicate-last",
      leaf_hash: computedEntryHash,
      siblings
    },

    anchor: {
      contract: args["anchor-contract"] || "",
      tx_hash: args["anchor-tx"] || "",
      anchored_log_root: normalizeHash(
        args["anchored-root"] || log.log_root
      )
    }
  };

  writeJson(outPath, proof);

  console.log(JSON.stringify({
    ok: true,
    schema: "grant-audit-transparency-log-inclusion-proof-v1",
    out: outPath,
    entry_index: matchedIndex,
    packet_sha256: packetSha,
    merkle_root: proof.index.merkle_root,
    anchored_log_root: proof.anchor.anchored_log_root
  }, null, 2));
}

main();
