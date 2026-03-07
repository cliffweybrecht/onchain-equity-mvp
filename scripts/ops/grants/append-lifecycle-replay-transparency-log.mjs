import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
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

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function canonicalHash(value) {
  return sha256Hex(canonicalStringify(value));
}

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

function leafHash(index, entryHash) {
  return sha256Hex(`grant-audit-transparency-leaf-v1:${index}:${entryHash}`);
}

function nodeHash(left, right) {
  return sha256Hex(`grant-audit-transparency-node-v1:${left}:${right}`);
}

function buildMerkleRoot(entryHashes) {
  if (entryHashes.length === 0) {
    return sha256Hex("grant-audit-transparency-empty-log-v1");
  }

  let level = entryHashes.map((hash, index) => leafHash(index, hash));

  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(nodeHash(left, right));
    }
    level = next;
  }

  return level[0];
}

function entryHashFor(entry) {
  const base = { ...entry };
  delete base.entry_hash;
  return sha256Hex(`grant-audit-transparency-entry-v1:${canonicalStringify(base)}`);
}

function checkpointHashFor(checkpoint) {
  const base = { ...checkpoint };
  delete base.checkpoint_hash;
  return canonicalHash(base);
}

function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function getPath(obj, pathExpression) {
  const parts = pathExpression.split(".");
  let current = obj;

  for (const part of parts) {
    if (current == null || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function pickFirstPath(obj, paths) {
  for (const pathExpression of paths) {
    const value = getPath(obj, pathExpression);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function fileExists(filePath) {
  return typeof filePath === "string" && filePath.length > 0 && fs.existsSync(filePath);
}

function resolveExistingPath(candidates, baseDir = process.cwd()) {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue;

    const trimmed = candidate.trim();
    if (!trimmed) continue;

    const direct = trimmed;
    if (fileExists(direct)) {
      return direct;
    }

    const resolved = path.resolve(baseDir, trimmed);
    if (fileExists(resolved)) {
      return resolved;
    }
  }

  return null;
}

function hashJsonFile(filePath) {
  const value = readJson(filePath);
  return canonicalHash(value);
}

const args = parseArgs(process.argv);

const replayPath =
  args["replay-path"] ||
  "manifests/grants/lifecycle-replay-reconciliation.json";

const logPath =
  args["log-path"] ||
  "manifests/transparency/transparency-log.json";

const checkpointPath =
  args["checkpoint-path"] ||
  "manifests/transparency/checkpoint.json";

const outPath =
  args["out-path"] ||
  "manifests/transparency/lifecycle-replay-transparency-log-entry.json";

const transitionChainPathArg =
  args["transition-chain-path"] ||
  "manifests/grants/lifecycle-transition-chain.json";

const lifecycleSnapshotPathArg =
  args["snapshot-path"] ||
  "manifests/grants/lifecycle-state-snapshot.json";

const replay = readJson(replayPath);
const replayDir = path.dirname(path.resolve(replayPath));

let transparencyLog;
if (fs.existsSync(logPath)) {
  transparencyLog = readJson(logPath);
} else {
  transparencyLog = {
    schema: "grant-audit-transparency-log-v1",
    log_version: "1.0.0",
    created_at: replay.created_at || replay.updated_at || "2026-03-07T00:00:00.000Z",
    updated_at: replay.created_at || replay.updated_at || "2026-03-07T00:00:00.000Z",
    entry_count: 0,
    head_entry_hash: null,
    log_root: sha256Hex("grant-audit-transparency-empty-log-v1"),
    entries: []
  };
}

let checkpoint;
if (fs.existsSync(checkpointPath)) {
  checkpoint = readJson(checkpointPath);
} else {
  checkpoint = {
    schema: "grant-audit-transparency-log-checkpoint-v1",
    checkpoint_version: "1.0.0",
    created_at: replay.created_at || replay.updated_at || "2026-03-07T00:00:00.000Z",
    updated_at: replay.created_at || replay.updated_at || "2026-03-07T00:00:00.000Z",
    entry_count: 0,
    head_entry_hash: null,
    log_root: sha256Hex("grant-audit-transparency-empty-log-v1"),
    checkpoint_hash: null
  };
}

const appendedAt =
  args["appended-at"] ||
  replay.reconciled_at ||
  replay.updated_at ||
  replay.created_at ||
  transparencyLog.updated_at ||
  checkpoint.updated_at ||
  "2026-03-07T00:00:00.000Z";

const grantId = replay.grant_id;
const reconciliationStatus = replay.reconciliation_status;
const reconciliationHash = replay.reconciliation_hash;
const replayEntryCount =
  replay.entry_count ??
  replay.replay_entry_count ??
  0;

if (!grantId) {
  throw new Error("Missing grant_id in lifecycle replay reconciliation artifact.");
}
if (!reconciliationStatus) {
  throw new Error("Missing reconciliation_status in lifecycle replay reconciliation artifact.");
}
if (!reconciliationHash) {
  throw new Error("Missing reconciliation_hash in lifecycle replay reconciliation artifact.");
}

const sourceArtifactHash = canonicalHash(replay);

const lifecycleTransitionChainHash = pickFirst(
  replay.lifecycle_transition_chain_hash,
  replay.transition_chain_hash,
  replay.chain_hash,
  replay.source_transition_chain_hash,
  pickFirstPath(replay, [
    "lineage.lifecycle_transition_chain_hash",
    "lineage.transition_chain_hash",
    "lineage.chain_hash",
    "lineage.source_transition_chain_hash",
    "inputs.lifecycle_transition_chain_hash",
    "inputs.transition_chain_hash",
    "sources.lifecycle_transition_chain_hash",
    "source_artifacts.lifecycle_transition_chain_hash",
    "source_artifacts.transition_chain_hash",
    "artifacts.lifecycle_transition_chain_hash",
    "artifacts.transition_chain_hash"
  ])
);

const lifecycleStateSnapshotHash = pickFirst(
  replay.lifecycle_state_snapshot_hash,
  replay.snapshot_hash,
  replay.lifecycle_snapshot_hash,
  replay.source_snapshot_hash,
  pickFirstPath(replay, [
    "lineage.lifecycle_state_snapshot_hash",
    "lineage.snapshot_hash",
    "lineage.lifecycle_snapshot_hash",
    "lineage.source_snapshot_hash",
    "inputs.lifecycle_state_snapshot_hash",
    "inputs.snapshot_hash",
    "sources.lifecycle_state_snapshot_hash",
    "source_artifacts.lifecycle_state_snapshot_hash",
    "source_artifacts.snapshot_hash",
    "artifacts.lifecycle_state_snapshot_hash",
    "artifacts.snapshot_hash"
  ])
);

const transitionChainPathFromReplay = pickFirst(
  replay.lifecycle_transition_chain_path,
  replay.transition_chain_path,
  replay.source_transition_chain_path,
  pickFirstPath(replay, [
    "lineage.lifecycle_transition_chain_path",
    "lineage.transition_chain_path",
    "inputs.lifecycle_transition_chain_path",
    "inputs.transition_chain_path",
    "sources.lifecycle_transition_chain_path",
    "source_artifacts.lifecycle_transition_chain_path",
    "source_artifacts.transition_chain_path",
    "artifacts.lifecycle_transition_chain_path",
    "artifacts.transition_chain_path"
  ])
);

const lifecycleSnapshotPathFromReplay = pickFirst(
  replay.lifecycle_state_snapshot_path,
  replay.snapshot_path,
  replay.lifecycle_snapshot_path,
  replay.source_snapshot_path,
  pickFirstPath(replay, [
    "lineage.lifecycle_state_snapshot_path",
    "lineage.snapshot_path",
    "lineage.lifecycle_snapshot_path",
    "inputs.lifecycle_state_snapshot_path",
    "inputs.snapshot_path",
    "sources.lifecycle_state_snapshot_path",
    "source_artifacts.lifecycle_state_snapshot_path",
    "source_artifacts.snapshot_path",
    "artifacts.lifecycle_state_snapshot_path",
    "artifacts.snapshot_path"
  ])
);

const resolvedTransitionChainPath = resolveExistingPath(
  [
    transitionChainPathFromReplay,
    transitionChainPathArg,
    "manifests/grants/lifecycle-transition-chain.json"
  ],
  replayDir
);

const resolvedLifecycleSnapshotPath = resolveExistingPath(
  [
    lifecycleSnapshotPathFromReplay,
    lifecycleSnapshotPathArg,
    "manifests/grants/lifecycle-state-snapshot.json"
  ],
  replayDir
);

const finalLifecycleTransitionChainHash =
  lifecycleTransitionChainHash ||
  (resolvedTransitionChainPath ? hashJsonFile(resolvedTransitionChainPath) : null);

const finalLifecycleStateSnapshotHash =
  lifecycleStateSnapshotHash ||
  (resolvedLifecycleSnapshotPath ? hashJsonFile(resolvedLifecycleSnapshotPath) : null);

if (!finalLifecycleTransitionChainHash) {
  throw new Error(
    [
      "Missing lifecycle transition chain hash in replay artifact and unable to derive it from a manifest file.",
      "Checked for hash fields on the replay artifact and these path candidates:",
      `- replay-derived path: ${transitionChainPathFromReplay || "<none>"}`,
      `- arg/default path: ${transitionChainPathArg}`,
      `- resolved path: ${resolvedTransitionChainPath || "<none>"}`
    ].join("\n")
  );
}

if (!finalLifecycleStateSnapshotHash) {
  throw new Error(
    [
      "Missing lifecycle state snapshot hash in replay artifact and unable to derive it from a manifest file.",
      "Checked for hash fields on the replay artifact and these path candidates:",
      `- replay-derived path: ${lifecycleSnapshotPathFromReplay || "<none>"}`,
      `- arg/default path: ${lifecycleSnapshotPathArg}`,
      `- resolved path: ${resolvedLifecycleSnapshotPath || "<none>"}`
    ].join("\n")
  );
}

const replayTransparencyEntry = {
  schema: "grant-audit-transparency-lifecycle-replay-log-entry-v1",
  entry_version: "1.0.0",
  artifact_type: "lifecycle_replay_reconciliation",
  grant_id: grantId,
  reconciliation_status: reconciliationStatus,
  reconciliation_hash: reconciliationHash,
  replay_entry_count: replayEntryCount,
  source_artifact_schema: replay.schema || "grant-audit-lifecycle-replay-reconciliation-v1",
  source_artifact_hash: sourceArtifactHash,
  source_artifact_path: normalizePath(replayPath),
  lifecycle_transition_chain_hash: finalLifecycleTransitionChainHash,
  lifecycle_state_snapshot_hash: finalLifecycleStateSnapshotHash,
  lineage: {
    lifecycle_transition_chain_hash: finalLifecycleTransitionChainHash,
    lifecycle_state_snapshot_hash: finalLifecycleStateSnapshotHash,
    source_artifact_hash: sourceArtifactHash,
    lifecycle_transition_chain_path: resolvedTransitionChainPath
      ? normalizePath(path.relative(process.cwd(), resolvedTransitionChainPath))
      : null,
    lifecycle_state_snapshot_path: resolvedLifecycleSnapshotPath
      ? normalizePath(path.relative(process.cwd(), resolvedLifecycleSnapshotPath))
      : null
  }
};

writeJson(outPath, replayTransparencyEntry);

const replayTransparencyEntryHash = canonicalHash(replayTransparencyEntry);

const existingEntries = Array.isArray(transparencyLog.entries)
  ? transparencyLog.entries
  : [];

const prevEntryHash =
  existingEntries.length > 0
    ? existingEntries[existingEntries.length - 1].entry_hash || null
    : null;

const newLogEntryBase = {
  schema: "grant-audit-transparency-log-entry-v1",
  entry_version: "1.0.0",
  index: existingEntries.length,
  appended_at: appendedAt,
  prev_entry_hash: prevEntryHash,
  artifact_type: "lifecycle_replay_reconciliation",
  artifact_schema: replayTransparencyEntry.schema,
  artifact_manifest_path: normalizePath(outPath),
  artifact_hash: replayTransparencyEntryHash,
  grant_id: grantId,
  reconciliation_status: reconciliationStatus,
  reconciliation_hash: reconciliationHash
};

const newLogEntry = {
  ...newLogEntryBase,
  entry_hash: entryHashFor(newLogEntryBase)
};

const updatedEntries = [...existingEntries, newLogEntry];

const entryHashes = updatedEntries.map((entry) => {
  if (!entry.entry_hash) {
    return entryHashFor(entry);
  }
  return entry.entry_hash;
});

const updatedLog = {
  schema: transparencyLog.schema || "grant-audit-transparency-log-v1",
  log_version: transparencyLog.log_version || "1.0.0",
  created_at: transparencyLog.created_at || appendedAt,
  updated_at: appendedAt,
  entry_count: updatedEntries.length,
  head_entry_hash: entryHashes.length > 0 ? entryHashes[entryHashes.length - 1] : null,
  log_root: buildMerkleRoot(entryHashes),
  entries: updatedEntries
};

writeJson(logPath, updatedLog);

const updatedCheckpointBase = {
  schema: checkpoint.schema || "grant-audit-transparency-log-checkpoint-v1",
  checkpoint_version: checkpoint.checkpoint_version || "1.0.0",
  created_at: checkpoint.created_at || appendedAt,
  updated_at: appendedAt,
  entry_count: updatedLog.entry_count,
  head_entry_hash: updatedLog.head_entry_hash,
  log_root: updatedLog.log_root
};

const updatedCheckpoint = {
  ...updatedCheckpointBase,
  checkpoint_hash: checkpointHashFor(updatedCheckpointBase)
};

writeJson(checkpointPath, updatedCheckpoint);

const result = {
  phase: "7.26",
  artifact_type: "lifecycle_replay_reconciliation",
  grant_id: grantId,
  replay_transparency_entry_hash: replayTransparencyEntryHash,
  transparency_log_index: newLogEntry.index,
  transparency_log_entry_hash: newLogEntry.entry_hash,
  transparency_log_entry_count: updatedLog.entry_count,
  transparency_log_head_entry_hash: updatedLog.head_entry_hash,
  transparency_log_root: updatedLog.log_root,
  checkpoint_hash: updatedCheckpoint.checkpoint_hash,
  reconciliation_status: reconciliationStatus,
  reconciliation_hash: reconciliationHash,
  lifecycle_transition_chain_hash: finalLifecycleTransitionChainHash,
  lifecycle_state_snapshot_hash: finalLifecycleStateSnapshotHash
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
