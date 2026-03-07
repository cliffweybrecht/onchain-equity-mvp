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
  if (Array.isArray(value)) return value.map(sortKeysDeep);
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

const args = parseArgs(process.argv);

const replayEntryPath =
  args["replay-entry-path"] ||
  "manifests/transparency/lifecycle-replay-transparency-log-entry.json";

const logPath =
  args["log-path"] ||
  "manifests/transparency/transparency-log.json";

const checkpointPath =
  args["checkpoint-path"] ||
  "manifests/transparency/checkpoint.json";

const outPath =
  args["out-path"] ||
  "manifests/transparency/lifecycle-replay-inclusion-proof.json";

const replayEntry = readJson(replayEntryPath);
const transparencyLog = readJson(logPath);
const checkpoint = readJson(checkpointPath);

const replayLogEntryHash = canonicalHash(replayEntry);

const matchingEntry = (transparencyLog.entries || []).find(
  (entry) =>
    entry.artifact_type === "lifecycle_replay_reconciliation" &&
    entry.artifact_hash === replayLogEntryHash
);

if (!matchingEntry) {
  throw new Error(
    "Lifecycle replay transparency entry was not found in transparency-log.json."
  );
}

if (checkpoint.entry_count !== transparencyLog.entry_count) {
  throw new Error("Checkpoint entry_count does not match transparency log entry_count.");
}

if (checkpoint.head_entry_hash !== transparencyLog.head_entry_hash) {
  throw new Error("Checkpoint head_entry_hash does not match transparency log head_entry_hash.");
}

if (checkpoint.log_root !== transparencyLog.log_root) {
  throw new Error("Checkpoint log_root does not match transparency log log_root.");
}

const proofBase = {
  schema: "grant-audit-transparency-lifecycle-replay-inclusion-proof-v1",
  proof_version: "1.0.0",
  grant_id: replayEntry.grant_id,
  artifact_type: "lifecycle_replay_reconciliation",
  reconciliation_hash: replayEntry.reconciliation_hash,
  replay_log_entry_hash: replayLogEntryHash,
  transparency_log: {
    path: logPath.replace(/\\/g, "/"),
    entry_index: matchingEntry.index,
    entry_hash: matchingEntry.entry_hash,
    entry_count: transparencyLog.entry_count,
    head_entry_hash: transparencyLog.head_entry_hash,
    log_root: transparencyLog.log_root
  },
  checkpoint: {
    path: checkpointPath.replace(/\\/g, "/"),
    entry_count: checkpoint.entry_count,
    head_entry_hash: checkpoint.head_entry_hash,
    log_root: checkpoint.log_root,
    checkpoint_hash: checkpoint.checkpoint_hash
  },
  lineage: {
    lifecycle_transition_chain_hash: replayEntry.lifecycle_transition_chain_hash,
    lifecycle_state_snapshot_hash: replayEntry.lifecycle_state_snapshot_hash,
    source_artifact_hash: replayEntry.source_artifact_hash
  }
};

const proof = {
  ...proofBase,
  proof_hash: canonicalHash(proofBase)
};

writeJson(outPath, proof);

const result = {
  phase: "7.26",
  artifact_type: "lifecycle_replay_reconciliation",
  grant_id: proof.grant_id,
  transparency_log_entry_index: proof.transparency_log.entry_index,
  transparency_log_entry_hash: proof.transparency_log.entry_hash,
  transparency_log_root: proof.transparency_log.log_root,
  checkpoint_hash: proof.checkpoint.checkpoint_hash,
  proof_hash: proof.proof_hash
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
