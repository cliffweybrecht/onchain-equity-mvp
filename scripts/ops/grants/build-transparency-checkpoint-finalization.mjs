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

const checkpointPath = path.join(manifestsDir, "checkpoint.json");
const checkpointWitnessesPath = path.join(manifestsDir, "checkpoint-witnesses.json");
const finalizationPolicyPath = path.join(manifestsDir, "checkpoint-finalization-policy.json");
const outputPath = path.join(manifestsDir, "checkpoint-finalization.json");

const checkpoint = readJson(checkpointPath);
const checkpointWitnesses = readJson(checkpointWitnessesPath);
const finalizationPolicy = readJson(finalizationPolicyPath);

const checkpointHash = sha256Hex(canonicalize(checkpoint));
const checkpointWitnessesHash = sha256Hex(canonicalize(checkpointWitnesses));

if (checkpointWitnesses.checkpoint_hash !== checkpointHash) {
  throw new Error("Checkpoint witnesses artifact is not bound to the current checkpoint");
}

const threshold = finalizationPolicy.required_witness_threshold;
const witnessCount = checkpointWitnesses.witness_count;

if (witnessCount < threshold) {
  throw new Error(`Witness count ${witnessCount} is below required threshold ${threshold}`);
}

const artifact = {
  artifact_type: "transparency_checkpoint_finalization",
  canonicalization: {
    json_mode: "canonical_json",
    key_ordering: "recursive_lexicographic",
    numeric_normalization: "verbatim_json_number_encoding",
    whitespace: "minimal"
  },
  checkpoint_finalization_policy_hash: sha256Hex(canonicalize(finalizationPolicy)),
  checkpoint_finalization_policy_path: "manifests/transparency/checkpoint-finalization-policy.json",
  checkpoint_hash: checkpointHash,
  checkpoint_path: "manifests/transparency/checkpoint.json",
  checkpoint_witnesses_hash: checkpointWitnessesHash,
  checkpoint_witnesses_path: "manifests/transparency/checkpoint-witnesses.json",
  finalization_status: "finalized",
  satisfied_witness_count: witnessCount,
  schema_version: "grant-audit-transparency-checkpoint-finalization-v1",
  signed_witness_threshold: threshold
};

artifact.artifact_hash = sha256Hex(canonicalize(artifact));

writeJson(outputPath, artifact);

console.log(JSON.stringify({
  checkpoint_hash: checkpointHash,
  checkpoint_witnesses_hash: checkpointWitnessesHash,
  finalization_status: artifact.finalization_status,
  output_path: "manifests/transparency/checkpoint-finalization.json",
  artifact_hash: artifact.artifact_hash
}, null, 2));
