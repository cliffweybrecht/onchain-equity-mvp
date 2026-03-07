#!/usr/bin/env node

import fs from "fs";
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function sha256BytesHex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hashHexPair(leftHex, rightHex) {
  return sha256BytesHex(
    Buffer.concat([
      Buffer.from(leftHex, "hex"),
      Buffer.from(rightHex, "hex")
    ])
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileHash(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return sha256Hex(canonicalStringify(parsed));
}

function requireHex64(name, value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Missing or invalid ${name}: ${value}`);
  }
  return value;
}

function extractLifecycleHashes(artifact) {
  return {
    artifactHash: requireHex64(
      "deterministic_hashes.artifact_hash",
      artifact.deterministic_hashes?.artifact_hash
    ),
    lifecycleEventHash: requireHex64(
      "deterministic_hashes.lifecycle_event_hash",
      artifact.deterministic_hashes?.lifecycle_event_hash
    ),
    lifecycleLineageHash: requireHex64(
      "deterministic_hashes.lifecycle_lineage_hash",
      artifact.deterministic_hashes?.lifecycle_lineage_hash
    ),
    trustChainHash: requireHex64(
      "deterministic_hashes.trust_chain_hash",
      artifact.deterministic_hashes?.trust_chain_hash
    )
  };
}

function getLeafHash(entry) {
  if (typeof entry.leaf_hash === "string") return entry.leaf_hash;
  if (typeof entry.merkle_leaf_hash === "string") return entry.merkle_leaf_hash;
  if (typeof entry.entry_hash === "string") return entry.entry_hash;
  return sha256Hex(canonicalStringify(entry));
}

function computeRootFromProof(leafHash, siblings) {
  let current = leafHash;
  for (const sibling of siblings) {
    if (sibling.position === "left") {
      current = hashHexPair(sibling.hash, current);
    } else if (sibling.position === "right") {
      current = hashHexPair(current, sibling.hash);
    } else {
      throw new Error(`Invalid sibling position: ${sibling.position}`);
    }
  }
  return current;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const args = parseArgs(process.argv);

  const proofPath = args.proof ?? "manifests/transparency/lifecycle-inclusion-proof.json";
  const artifactPath = args.artifact ?? "manifests/grants/grant-lifecycle-event.json";
  const logPath = args.log ?? "manifests/transparency/transparency-log.json";
  const checkpointPath = args.checkpoint ?? "manifests/transparency/checkpoint.json";

  if (!fs.existsSync(proofPath)) throw new Error(`Missing proof artifact: ${proofPath}`);
  if (!fs.existsSync(artifactPath)) throw new Error(`Missing lifecycle artifact: ${artifactPath}`);
  if (!fs.existsSync(logPath)) throw new Error(`Missing transparency log: ${logPath}`);
  if (!fs.existsSync(checkpointPath)) throw new Error(`Missing checkpoint: ${checkpointPath}`);

  const proof = readJson(proofPath);
  const artifact = readJson(artifactPath);
  const log = readJson(logPath);
  const checkpoint = readJson(checkpointPath);

  assert(
    proof.schema === "grant-audit-transparency-lifecycle-inclusion-proof-v1",
    `Unexpected proof schema: ${proof.schema}`
  );
  assert(
    artifact.schema === "grant-audit-grant-lifecycle-event-v1",
    `Unexpected lifecycle artifact schema: ${artifact.schema}`
  );

  const hashes = extractLifecycleHashes(artifact);

  // Treat the embedded Phase 7.20 artifact_hash as the authoritative
  // deterministic subject hash. Do not require equality with a naive
  // full-file hash because the artifact is self-referential.

  const proofHashExpected = sha256Hex(
    canonicalStringify({
      schema: proof.schema,
      proof_version: proof.proof_version,
      created_at: proof.created_at,
      subject: proof.subject,
      log_entry: proof.log_entry,
      inclusion_proof: proof.inclusion_proof,
      log_binding: proof.log_binding,
      checkpoint_binding: proof.checkpoint_binding,
      root_anchor_binding: proof.root_anchor_binding
    })
  );

  assert(proof.proof_hash === proofHashExpected, "proof_hash mismatch");

  assert(proof.subject.artifact_hash === hashes.artifactHash, "Artifact hash mismatch");
  assert(
    proof.subject.lifecycle_event_hash === hashes.lifecycleEventHash,
    "Lifecycle event hash mismatch"
  );
  assert(
    proof.subject.lifecycle_lineage_hash === hashes.lifecycleLineageHash,
    "Lifecycle lineage hash mismatch"
  );
  assert(
    proof.subject.trust_chain_hash === hashes.trustChainHash,
    "Trust chain hash mismatch"
  );

  const entry = log.entries[proof.log_entry.index];
  assert(!!entry, `Log entry at index ${proof.log_entry.index} not found`);
  assert(entry.entry_type === "grant_lifecycle_event", "Indexed log entry is not a lifecycle event");
  assert(entry.artifact.artifact_hash === hashes.artifactHash, "Log entry artifact hash mismatch");
  assert(entry.entry_hash === proof.log_entry.entry_hash, "Log entry hash mismatch");
  assert(getLeafHash(entry) === proof.log_entry.leaf_hash, "Log entry leaf hash mismatch");

  const rootFromProof = computeRootFromProof(
    proof.log_entry.leaf_hash,
    proof.inclusion_proof.siblings
  );

  assert(rootFromProof === proof.log_binding.log_root, "Proof root does not match log binding root");
  assert(rootFromProof === log.log_root, "Proof root does not match transparency log root");
  assert(
    Number(proof.inclusion_proof.tree_size) === Number(log.entry_count),
    "Proof tree size mismatch"
  );
  assert(
    Number(proof.log_binding.entry_count) === Number(log.entry_count),
    "Log binding entry count mismatch"
  );
  assert(proof.log_binding.head_entry_hash === log.head_entry_hash, "Head entry hash mismatch");

  const checkpointHash = fileHash(checkpointPath);
  const checkpointLogRoot =
    checkpoint.log_root ??
    checkpoint.transparency_log_root ??
    checkpoint.log?.root;

  const checkpointEntryCount =
    checkpoint.entry_count ??
    checkpoint.tree_size ??
    checkpoint.log_entry_count ??
    checkpoint.log?.entry_count;

  assert(proof.checkpoint_binding.checkpoint_hash === checkpointHash, "Checkpoint hash mismatch");
  assert(proof.checkpoint_binding.log_root === checkpointLogRoot, "Checkpoint binding log_root mismatch");
  assert(
    Number(proof.checkpoint_binding.entry_count) === Number(checkpointEntryCount),
    "Checkpoint binding entry_count mismatch"
  );
  assert(checkpointLogRoot === log.log_root, "Checkpoint log root does not match transparency log root");
  assert(
    Number(checkpointEntryCount) === Number(log.entry_count),
    "Checkpoint entry count does not match log entry count"
  );

  assert(
    proof.root_anchor_binding.network === "base-sepolia",
    "Root anchor binding network must be base-sepolia"
  );

  const output = {
    ok: true,
    verified_at: proof.created_at,
    artifact_hash: hashes.artifactHash,
    lifecycle_event_hash: hashes.lifecycleEventHash,
    lifecycle_lineage_hash: hashes.lifecycleLineageHash,
    trust_chain_hash: hashes.trustChainHash,
    log_index: proof.log_entry.index,
    log_root: log.log_root,
    checkpoint_hash: checkpointHash,
    root_anchor_network: proof.root_anchor_binding.network
  };

  process.stdout.write(`${JSON.stringify(canonicalize(output), null, 2)}\n`);
}

main();
