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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(canonicalize(value), null, 2)}\n`);
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

function buildMerkleProof(leafHashes, targetIndex) {
  if (targetIndex < 0 || targetIndex >= leafHashes.length) {
    throw new Error(`Target index ${targetIndex} out of bounds for tree size ${leafHashes.length}`);
  }

  const siblings = [];
  let index = targetIndex;
  let level = [...leafHashes];

  while (level.length > 1) {
    const isRightNode = index % 2 === 1;
    const siblingIndex = isRightNode ? index - 1 : index + 1;

    if (siblingIndex < level.length) {
      siblings.push({
        position: isRightNode ? "left" : "right",
        hash: level[siblingIndex]
      });
    }

    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      if (!right) {
        next.push(left);
      } else {
        next.push(hashHexPair(left, right));
      }
    }

    index = Math.floor(index / 2);
    level = next;
  }

  return {
    tree_size: leafHashes.length,
    hash_algorithm: "sha256",
    odd_node_rule: "promote",
    siblings
  };
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

function findRootAnchorBinding(artifact, checkpointPath) {
  const rootAnchor =
    artifact.lifecycle_anchor_lineage_reference?.base_sepolia_root_anchor_reference ?? {};

  return {
    network: "base-sepolia",
    source: "grant-lifecycle-event:lifecycle_anchor_lineage_reference.base_sepolia_root_anchor_reference",
    tx_hash: rootAnchor.tx_hash,
    block_number: rootAnchor.block_number,
    chain_id: rootAnchor.chain_id,
    checkpoint_path: checkpointPath
  };
}

function main() {
  const args = parseArgs(process.argv);

  const artifactPath = args.artifact ?? "manifests/grants/grant-lifecycle-event.json";
  const logPath = args.log ?? "manifests/transparency/transparency-log.json";
  const checkpointPath = args.checkpoint ?? "manifests/transparency/checkpoint.json";
  const outPath = args.out ?? "manifests/transparency/lifecycle-inclusion-proof.json";

  if (!fs.existsSync(artifactPath)) throw new Error(`Missing lifecycle artifact: ${artifactPath}`);
  if (!fs.existsSync(logPath)) throw new Error(`Missing transparency log: ${logPath}`);
  if (!fs.existsSync(checkpointPath)) throw new Error(`Missing checkpoint: ${checkpointPath}`);

  const artifact = readJson(artifactPath);
  const log = readJson(logPath);
  const checkpoint = readJson(checkpointPath);

  if (artifact.schema !== "grant-audit-grant-lifecycle-event-v1") {
    throw new Error(`Unexpected lifecycle artifact schema: ${artifact.schema}`);
  }

  const hashes = extractLifecycleHashes(artifact);

  // Phase 7.20 artifact_hash is the canonical deterministic trust input.
  // Do not compare it to a naive full-file hash because the artifact embeds
  // deterministic hashes and is therefore self-referential.

  const matchedEntry = log.entries.find(
    (entry) =>
      entry?.entry_type === "grant_lifecycle_event" &&
      entry?.artifact?.artifact_hash === hashes.artifactHash
  );

  if (!matchedEntry) {
    throw new Error(`Lifecycle artifact hash ${hashes.artifactHash} not found in transparency log`);
  }

  const leafHashes = log.entries.map(getLeafHash);
  const proof = buildMerkleProof(leafHashes, matchedEntry.index);
  const recomputedRoot = computeRootFromProof(matchedEntry.leaf_hash, proof.siblings);

  if (recomputedRoot !== log.log_root) {
    throw new Error(
      `Inclusion proof root mismatch: recomputed=${recomputedRoot} log_root=${log.log_root}`
    );
  }

  const checkpointLogRoot =
    checkpoint.log_root ??
    checkpoint.transparency_log_root ??
    checkpoint.log?.root;

  const checkpointEntryCount =
    checkpoint.entry_count ??
    checkpoint.tree_size ??
    checkpoint.log_entry_count ??
    checkpoint.log?.entry_count;

  if (checkpointLogRoot !== log.log_root) {
    throw new Error(
      `Checkpoint log root mismatch: checkpoint=${checkpointLogRoot} log=${log.log_root}`
    );
  }

  if (Number(checkpointEntryCount) !== Number(log.entry_count)) {
    throw new Error(
      `Checkpoint entry count mismatch: checkpoint=${checkpointEntryCount} log=${log.entry_count}`
    );
  }

  const createdAt =
    artifact.recorded_at ??
    artifact.effective_at ??
    checkpoint.created_at ??
    matchedEntry.appended_at;

  const proofCore = {
    schema: "grant-audit-transparency-lifecycle-inclusion-proof-v1",
    proof_version: "1.0.0",
    created_at: createdAt,
    subject: {
      artifact_path: artifactPath,
      artifact_schema: artifact.schema,
      artifact_hash: hashes.artifactHash,
      lifecycle_event_hash: hashes.lifecycleEventHash,
      lifecycle_lineage_hash: hashes.lifecycleLineageHash,
      trust_chain_hash: hashes.trustChainHash,
      lifecycle_event_id: artifact.lifecycle_event_id,
      grant_id: artifact.grant_id,
      event_type: artifact.event_type,
      event_sequence: artifact.event_sequence
    },
    log_entry: {
      index: matchedEntry.index,
      entry_hash: matchedEntry.entry_hash,
      leaf_hash: matchedEntry.leaf_hash
    },
    inclusion_proof: proof,
    log_binding: {
      log_path: logPath,
      entry_count: log.entry_count,
      head_entry_hash: log.head_entry_hash,
      log_root: log.log_root
    },
    checkpoint_binding: {
      checkpoint_path: checkpointPath,
      checkpoint_schema: checkpoint.schema,
      checkpoint_hash: fileHash(checkpointPath),
      log_root: checkpointLogRoot,
      entry_count: Number(checkpointEntryCount)
    },
    root_anchor_binding: findRootAnchorBinding(artifact, checkpointPath)
  };

  const proofHash = sha256Hex(canonicalStringify(proofCore));
  const artifactOut = {
    ...proofCore,
    proof_hash: proofHash
  };

  writeJson(outPath, artifactOut);
  process.stdout.write(`${JSON.stringify(canonicalize(artifactOut), null, 2)}\n`);
}

main();
