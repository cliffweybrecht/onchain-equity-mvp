#!/usr/bin/env node

import fs from "fs";
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

function verifyMerkleProof(leafHash, siblings) {
  let current = normalizeHash(leafHash);
  for (const step of siblings) {
    const sibling = normalizeHash(step.hash);
    if (step.position === "left") {
      current = hashPair(sibling, current);
    } else if (step.position === "right") {
      current = hashPair(current, sibling);
    } else {
      throw new Error(`Invalid sibling position: ${step.position}`);
    }
  }
  return current;
}

function main() {
  const args = parseArgs(process.argv);
  const proofPath = args.proof;

  if (!proofPath) {
    throw new Error("Provide --proof <path>");
  }

  const proof = readJson(proofPath);
  const errors = [];

  if (proof.schema !== "grant-audit-transparency-log-inclusion-proof-v1") {
    errors.push(`unexpected proof schema: ${proof.schema}`);
  }

  const computedEntryHash = entryHash(proof.entry);
  if (computedEntryHash !== normalizeHash(proof.entry_hash)) {
    errors.push(`entry_hash mismatch: computed ${computedEntryHash} != proof ${proof.entry_hash}`);
  }

  if (normalizeHash(proof.inclusion_proof.leaf_hash) !== computedEntryHash) {
    errors.push(`leaf_hash mismatch: proof leaf ${proof.inclusion_proof.leaf_hash} != computed entry hash ${computedEntryHash}`);
  }

  const packetShaInEntry = extractPacketSha(proof.entry);
  if (!packetShaInEntry) {
    errors.push("could not extract packet sha256 from transparency log entry");
  } else if (packetShaInEntry !== normalizeHash(proof.packet.sha256)) {
    errors.push(`packet digest mismatch: entry ${packetShaInEntry} != proof ${proof.packet.sha256}`);
  }

  if (args.packet) {
    const computedPacketSha = sha256Hex(fs.readFileSync(args.packet));
    if (computedPacketSha !== normalizeHash(proof.packet.sha256)) {
      errors.push(`packet file sha256 mismatch: file ${computedPacketSha} != proof ${proof.packet.sha256}`);
    }
  }

  const merkleRoot = verifyMerkleProof(
    normalizeHash(proof.inclusion_proof.leaf_hash),
    proof.inclusion_proof.siblings || []
  );

  if (merkleRoot !== normalizeHash(proof.index.merkle_root)) {
    errors.push(`Merkle root mismatch: computed ${merkleRoot} != proof ${proof.index.merkle_root}`);
  }

  if (normalizeHash(proof.anchor.anchored_log_root) !== normalizeHash(proof.checkpoint.log_root)) {
    errors.push(
      `anchored checkpoint root mismatch: anchor ${proof.anchor.anchored_log_root} != checkpoint ${proof.checkpoint.log_root}`
    );
  }

  if (args["anchored-root"]) {
    const expectedRoot = normalizeHash(args["anchored-root"]);
    if (expectedRoot !== normalizeHash(proof.anchor.anchored_log_root)) {
      errors.push(`provided anchored root ${expectedRoot} != proof anchor root ${proof.anchor.anchored_log_root}`);
    }
  }

  if (args["anchor-contract"]) {
    const expectedContract = String(args["anchor-contract"]).toLowerCase();
    if (String(proof.anchor.contract).toLowerCase() !== expectedContract) {
      errors.push(`provided anchor contract ${expectedContract} != proof contract ${proof.anchor.contract}`);
    }
  }

  if (args["anchor-tx"]) {
    const expectedTx = String(args["anchor-tx"]).toLowerCase();
    if (String(proof.anchor.tx_hash).toLowerCase() !== expectedTx) {
      errors.push(`provided anchor tx ${expectedTx} != proof tx ${proof.anchor.tx_hash}`);
    }
  }

  const result = {
    ok: errors.length === 0,
    schema: "grant-audit-transparency-log-inclusion-proof-verification-v1",
    packet_sha256: normalizeHash(proof.packet.sha256),
    entry_hash: computedEntryHash,
    merkle_root: normalizeHash(proof.index.merkle_root),
    checkpoint_log_root: normalizeHash(proof.checkpoint.log_root),
    anchor_contract: proof.anchor.contract,
    anchor_tx_hash: proof.anchor.tx_hash,
    errors
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();
