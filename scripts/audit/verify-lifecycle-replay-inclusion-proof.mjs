import fs from "node:fs";
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

const args = parseArgs(process.argv);

const proofPath =
  args["proof-path"] ||
  "manifests/transparency/lifecycle-replay-inclusion-proof.json";

const replayEntryPath =
  args["replay-entry-path"] ||
  "manifests/transparency/lifecycle-replay-transparency-log-entry.json";

const logPath =
  args["log-path"] ||
  "manifests/transparency/transparency-log.json";

const checkpointPath =
  args["checkpoint-path"] ||
  "manifests/transparency/checkpoint.json";

const proof = readJson(proofPath);
const replayEntry = readJson(replayEntryPath);
const transparencyLog = readJson(logPath);
const checkpoint = readJson(checkpointPath);

const recomputedReplayLogEntryHash = canonicalHash(replayEntry);
if (recomputedReplayLogEntryHash !== proof.replay_log_entry_hash) {
  throw new Error("Proof replay_log_entry_hash does not match recomputed replay entry hash.");
}

const entries = Array.isArray(transparencyLog.entries) ? transparencyLog.entries : [];

if (proof.transparency_log.entry_index < 0 || proof.transparency_log.entry_index >= entries.length) {
  throw new Error("Transparency log entry_index is out of bounds.");
}

const indexedEntry = entries[proof.transparency_log.entry_index];
if (!indexedEntry) {
  throw new Error("Transparency log entry_index could not be resolved.");
}

if (indexedEntry.artifact_hash !== recomputedReplayLogEntryHash) {
  throw new Error("Transparency log entry artifact_hash does not match replay entry hash.");
}

const recomputedIndexedEntryHash = entryHashFor(indexedEntry);
if (recomputedIndexedEntryHash !== indexedEntry.entry_hash) {
  throw new Error(
    "Current lifecycle replay transparency log entry_hash does not match recomputed entry hash."
  );
}

if (indexedEntry.entry_hash !== proof.transparency_log.entry_hash) {
  throw new Error("Proof transparency_log.entry_hash does not match transparency log entry_hash.");
}

if (indexedEntry.index !== proof.transparency_log.entry_index) {
  throw new Error("Proof transparency_log.entry_index does not match transparency log entry index.");
}

if (indexedEntry.artifact_type !== "lifecycle_replay_reconciliation") {
  throw new Error("Indexed transparency log entry is not a lifecycle replay reconciliation artifact.");
}

const storedEntryHashes = entries.map((entry, idx) => {
  if (!entry || typeof entry !== "object") {
    throw new Error(`Transparency log entry at index ${idx} is invalid.`);
  }
  if (typeof entry.entry_hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.entry_hash)) {
    throw new Error(`Transparency log entry at index ${idx} is missing a valid entry_hash.`);
  }
  if (typeof entry.index !== "number" || entry.index !== idx) {
    throw new Error(`Transparency log entry index mismatch at array position ${idx}.`);
  }
  return entry.entry_hash;
});

const recomputedLogRoot = buildMerkleRoot(storedEntryHashes);
if (recomputedLogRoot !== transparencyLog.log_root) {
  throw new Error("Transparency log log_root does not match recomputed root from stored entry hashes.");
}

if (transparencyLog.entry_count !== storedEntryHashes.length) {
  throw new Error("Transparency log entry_count does not match actual entries length.");
}

const expectedHeadEntryHash =
  storedEntryHashes.length > 0 ? storedEntryHashes[storedEntryHashes.length - 1] : null;

if (transparencyLog.head_entry_hash !== expectedHeadEntryHash) {
  throw new Error("Transparency log head_entry_hash does not match final stored entry hash.");
}

if (proof.transparency_log.entry_count !== transparencyLog.entry_count) {
  throw new Error("Proof transparency_log.entry_count mismatch.");
}

if (proof.transparency_log.head_entry_hash !== transparencyLog.head_entry_hash) {
  throw new Error("Proof transparency_log.head_entry_hash mismatch.");
}

if (proof.transparency_log.log_root !== transparencyLog.log_root) {
  throw new Error("Proof transparency_log.log_root mismatch.");
}

const recomputedCheckpointHash = checkpointHashFor(checkpoint);
if (recomputedCheckpointHash !== checkpoint.checkpoint_hash) {
  throw new Error("Checkpoint checkpoint_hash does not match recomputed hash.");
}

if (checkpoint.entry_count !== transparencyLog.entry_count) {
  throw new Error("Checkpoint entry_count does not match transparency log.");
}

if (checkpoint.head_entry_hash !== transparencyLog.head_entry_hash) {
  throw new Error("Checkpoint head_entry_hash does not match transparency log.");
}

if (checkpoint.log_root !== transparencyLog.log_root) {
  throw new Error("Checkpoint log_root does not match transparency log.");
}

if (proof.checkpoint.entry_count !== checkpoint.entry_count) {
  throw new Error("Proof checkpoint.entry_count mismatch.");
}

if (proof.checkpoint.head_entry_hash !== checkpoint.head_entry_hash) {
  throw new Error("Proof checkpoint.head_entry_hash mismatch.");
}

if (proof.checkpoint.log_root !== checkpoint.log_root) {
  throw new Error("Proof checkpoint.log_root mismatch.");
}

if (proof.checkpoint.checkpoint_hash !== checkpoint.checkpoint_hash) {
  throw new Error("Proof checkpoint.checkpoint_hash mismatch.");
}

const proofBase = { ...proof };
delete proofBase.proof_hash;
const recomputedProofHash = canonicalHash(proofBase);

if (recomputedProofHash !== proof.proof_hash) {
  throw new Error("Proof proof_hash does not match recomputed proof hash.");
}

const result = {
  grant_id: proof.grant_id,
  transparency_log_entry_index: proof.transparency_log.entry_index,
  inclusion_status: "verified",
  replay_log_entry_hash: proof.replay_log_entry_hash,
  transparency_log_entry_hash: proof.transparency_log.entry_hash,
  transparency_log_root: proof.transparency_log.log_root,
  checkpoint_hash: proof.checkpoint.checkpoint_hash,
  proof_hash: proof.proof_hash
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
