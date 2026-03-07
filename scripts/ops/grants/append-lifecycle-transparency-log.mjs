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

function requireHex64(name, value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Missing or invalid ${name}: ${value}`);
  }
  return value;
}

function ensureLifecycleArtifactShape(artifact) {
  if (artifact.schema !== "grant-audit-grant-lifecycle-event-v1") {
    throw new Error(`Unexpected lifecycle artifact schema: ${artifact.schema}`);
  }
  if (!artifact.deterministic_hashes || typeof artifact.deterministic_hashes !== "object") {
    throw new Error("Lifecycle artifact missing deterministic_hashes object");
  }
  if (
    !artifact.lifecycle_anchor_lineage_reference ||
    typeof artifact.lifecycle_anchor_lineage_reference !== "object"
  ) {
    throw new Error("Lifecycle artifact missing lifecycle_anchor_lineage_reference object");
  }
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

function extractLineagePaths(artifact, logPath) {
  const lineage = artifact.lifecycle_anchor_lineage_reference ?? {};
  const issuanceAnchorReference = lineage.issuance_anchor_reference ?? {};
  const finalizedCheckpointReference = lineage.finalized_checkpoint_reference ?? {};

  return {
    issuanceArtifactPath:
      lineage.source_grant_issuance_path ?? "manifests/grants/grant-issuance.json",
    issuanceAnchorReferencePath:
      issuanceAnchorReference.issuance_anchor_path ??
      "manifests/transparency/issuance-anchor.json",
    checkpointReferencePath:
      finalizedCheckpointReference.path ?? "manifests/transparency/checkpoint-finalization.json",
    transparencyLogPath: logPath,
    rootAnchorNetwork: "base-sepolia"
  };
}

function getLeafHash(entry) {
  if (typeof entry.leaf_hash === "string") return entry.leaf_hash;
  if (typeof entry.merkle_leaf_hash === "string") return entry.merkle_leaf_hash;
  if (typeof entry.entry_hash === "string") return entry.entry_hash;
  return sha256Hex(canonicalStringify(entry));
}

function buildMerkleRoot(leafHashes) {
  if (leafHashes.length === 0) {
    return sha256Hex("");
  }

  let level = [...leafHashes];

  while (level.length > 1) {
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
    level = next;
  }

  return level[0];
}

function main() {
  const args = parseArgs(process.argv);

  const artifactPath = args.artifact ?? "manifests/grants/grant-lifecycle-event.json";
  const logPath = args.log ?? "manifests/transparency/transparency-log.json";
  const outPath = args.out ?? logPath;

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing lifecycle artifact: ${artifactPath}`);
  }
  if (!fs.existsSync(logPath)) {
    throw new Error(`Missing transparency log: ${logPath}`);
  }

  const lifecycleArtifact = readJson(artifactPath);
  ensureLifecycleArtifactShape(lifecycleArtifact);

  const hashes = extractLifecycleHashes(lifecycleArtifact);

  // Phase 7.20 artifact_hash is treated as the authoritative deterministic
  // subject hash. Do not require the final serialized file to hash to the same
  // value because the artifact contains self-referential deterministic_hashes.

  const log = readJson(logPath);

  if (!Array.isArray(log.entries)) {
    throw new Error("Transparency log must contain an entries array");
  }

  const existing = log.entries.find(
    (entry) =>
      entry?.entry_type === "grant_lifecycle_event" &&
      entry?.artifact?.artifact_hash === hashes.artifactHash
  );

  let nextLog;

  if (existing) {
    const recomputedLeafHashes = log.entries.map(getLeafHash);
    const recomputedRoot = buildMerkleRoot(recomputedLeafHashes);

    nextLog = {
      ...log,
      entry_count: log.entries.length,
      head_entry_hash:
        log.entries.length > 0
          ? log.entries[log.entries.length - 1].entry_hash
          : log.head_entry_hash,
      log_root: recomputedRoot
    };
  } else {
    const index = log.entries.length;
    const lineagePaths = extractLineagePaths(lifecycleArtifact, outPath);
    const appendedAt =
      lifecycleArtifact.recorded_at ??
      lifecycleArtifact.effective_at ??
      log.updated_at ??
      log.created_at;

    const entryCore = {
      schema: "grant-audit-transparency-lifecycle-log-entry-v1",
      entry_version: "1.0.0",
      entry_type: "grant_lifecycle_event",
      index,
      appended_at: appendedAt,
      artifact: {
        path: artifactPath,
        schema: lifecycleArtifact.schema,
        artifact_hash: hashes.artifactHash,
        lifecycle_event_hash: hashes.lifecycleEventHash,
        lifecycle_event_id: lifecycleArtifact.lifecycle_event_id,
        grant_id: lifecycleArtifact.grant_id,
        event_type: lifecycleArtifact.event_type,
        event_sequence: lifecycleArtifact.event_sequence
      },
      lineage: {
        lifecycle_lineage_hash: hashes.lifecycleLineageHash,
        trust_chain_hash: hashes.trustChainHash,
        issuance_artifact_path: lineagePaths.issuanceArtifactPath,
        issuance_anchor_reference_path: lineagePaths.issuanceAnchorReferencePath,
        checkpoint_reference_path: lineagePaths.checkpointReferencePath,
        transparency_log_path: lineagePaths.transparencyLogPath,
        root_anchor_network: lineagePaths.rootAnchorNetwork
      }
    };

    const entryHash = sha256Hex(canonicalStringify(entryCore));
    const leafHash = sha256Hex(
      canonicalStringify({
        entry_type: entryCore.entry_type,
        index: entryCore.index,
        artifact: entryCore.artifact,
        lineage: entryCore.lineage,
        entry_hash: entryHash
      })
    );

    const entry = {
      ...entryCore,
      entry_hash: entryHash,
      leaf_hash: leafHash
    };

    const entries = [...log.entries, entry];
    const leafHashes = entries.map(getLeafHash);
    const logRoot = buildMerkleRoot(leafHashes);

    nextLog = {
      ...log,
      updated_at: appendedAt,
      entry_count: entries.length,
      head_entry_hash: entryHash,
      log_root: logRoot,
      entries
    };
  }

  writeJson(outPath, nextLog);
  process.stdout.write(`${JSON.stringify(canonicalize(nextLog), null, 2)}\n`);
}

main();
