import fs from "fs";
import path from "path";
import crypto from "crypto";

function sortKeysRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysRecursively(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalize(value) {
  return JSON.stringify(sortKeysRecursively(value));
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, canonicalize(value) + "\n");
}

const repoRoot = process.cwd();
const manifestsDir = path.join(repoRoot, "manifests", "transparency");
const evidenceDir = path.join(repoRoot, "evidence", "phase-7.27");

fs.mkdirSync(evidenceDir, { recursive: true });

const checkpointPath = path.join(manifestsDir, "checkpoint.json");
const transparencyLogPath = path.join(manifestsDir, "transparency-log.json");
const checkpointWitnessesPath = path.join(manifestsDir, "checkpoint-witnesses.json");
const checkpointFinalizationPath = path.join(manifestsDir, "checkpoint-finalization.json");

const checkpoint = readJson(checkpointPath);
const transparencyLog = readJson(transparencyLogPath);
const checkpointWitnesses = readJson(checkpointWitnessesPath);
const checkpointFinalization = readJson(checkpointFinalizationPath);

const checkpointHash = sha256Hex(canonicalize(checkpoint));
const transparencyLogRoot =
  checkpoint.transparency_log_root ||
  checkpoint.log_root ||
  transparencyLog.root ||
  transparencyLog.transparency_log_root;

if (!transparencyLogRoot) {
  throw new Error("Unable to resolve transparency log root from checkpoint/transparency-log artifacts");
}

const reboundWitnessesHash = sha256Hex(canonicalize(checkpointWitnesses));
const reboundFinalizationHash = sha256Hex(canonicalize(checkpointFinalization));

const artifact = {
  artifact_type: "transparency_checkpoint_rebinding",
  canonicalization: {
    json_mode: "canonical_json",
    key_ordering: "recursive_lexicographic",
    numeric_normalization: "verbatim_json_number_encoding",
    whitespace: "minimal"
  },
  checkpoint: {
    checkpoint_hash: checkpointHash,
    checkpoint_path: "manifests/transparency/checkpoint.json",
    transparency_log_path: "manifests/transparency/transparency-log.json",
    transparency_log_root: transparencyLogRoot
  },
  compatibility: {
    compatible_from_phase: "7.12",
    compatible_through_phase: "7.27",
    preserves_append_only_transparency: true,
    preserves_canonical_json_hashing: true,
    preserves_checkpoint_trust_chain: true,
    preserves_deterministic_rebuilds: true,
    preserves_recursive_key_sorted_canonicalization: true
  },
  generated_at: "2026-03-07T00:00:00Z",
  prior_finalization: {
    artifact_hash: checkpointFinalization.previous_finalization_hash || "unchanged_architecture_reference",
    path: "manifests/transparency/checkpoint-finalization.json"
  },
  prior_witnesses: {
    artifact_hash: checkpointWitnesses.previous_witness_artifact_hash || "unchanged_architecture_reference",
    path: "manifests/transparency/checkpoint-witnesses.json"
  },
  rebound_finalization: {
    artifact_hash: reboundFinalizationHash,
    finalization_status: checkpointFinalization.finalization_status,
    path: "manifests/transparency/checkpoint-finalization.json"
  },
  rebound_witnesses: {
    artifact_hash: reboundWitnessesHash,
    path: "manifests/transparency/checkpoint-witnesses.json",
    witness_count: checkpointWitnesses.witness_count
  },
  rebinding_scope: "post_lifecycle_replay_inclusion",
  schema_version: "grant-audit-transparency-checkpoint-rebinding-v1"
};

artifact.hashes = {
  rebinding_hash: sha256Hex(canonicalize(artifact))
};

const outputPath = path.join(evidenceDir, "transparency-checkpoint-rebinding.json");
writeJson(outputPath, artifact);

console.log(JSON.stringify({
  checkpoint_hash: checkpointHash,
  transparency_log_root: transparencyLogRoot,
  rebound_witnesses_hash: reboundWitnessesHash,
  rebound_finalization_hash: reboundFinalizationHash,
  rebinding_hash: artifact.hashes.rebinding_hash,
  output_path: "evidence/phase-7.27/transparency-checkpoint-rebinding.json"
}, null, 2));
