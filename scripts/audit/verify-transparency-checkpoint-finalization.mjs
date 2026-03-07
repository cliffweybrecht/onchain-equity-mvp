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

const repoRoot = process.cwd();
const manifestsDir = path.join(repoRoot, "manifests", "transparency");

const checkpoint = readJson(path.join(manifestsDir, "checkpoint.json"));
const checkpointWitnesses = readJson(path.join(manifestsDir, "checkpoint-witnesses.json"));
const finalizationPolicy = readJson(path.join(manifestsDir, "checkpoint-finalization-policy.json"));
const finalization = readJson(path.join(manifestsDir, "checkpoint-finalization.json"));

const checkpointHash = sha256Hex(canonicalize(checkpoint));
const checkpointWitnessesHash = sha256Hex(canonicalize(checkpointWitnesses));
const finalizationPolicyHash = sha256Hex(canonicalize(finalizationPolicy));

if (finalization.checkpoint_hash !== checkpointHash) {
  throw new Error("Finalization checkpoint hash mismatch");
}
if (finalization.checkpoint_witnesses_hash !== checkpointWitnessesHash) {
  throw new Error("Finalization checkpoint witnesses hash mismatch");
}
if (finalization.checkpoint_finalization_policy_hash !== finalizationPolicyHash) {
  throw new Error("Finalization policy hash mismatch");
}
if (finalization.finalization_status !== "finalized") {
  throw new Error(`Unexpected finalization status: ${finalization.finalization_status}`);
}
if (checkpointWitnesses.witness_count < finalizationPolicy.required_witness_threshold) {
  throw new Error("Witness threshold not met under finalization policy");
}
if (finalization.satisfied_witness_count < finalization.signed_witness_threshold) {
  throw new Error("Finalization satisfied witness count is below signed threshold");
}

const recomputedFinalization = { ...finalization };
delete recomputedFinalization.artifact_hash;
const recomputedHash = sha256Hex(canonicalize(recomputedFinalization));

if (finalization.artifact_hash !== recomputedHash) {
  throw new Error(`Finalization artifact hash mismatch: expected ${recomputedHash}, got ${finalization.artifact_hash}`);
}

console.log(JSON.stringify({
  verification_status: "verified",
  checkpoint_hash: checkpointHash,
  checkpoint_witnesses_hash: checkpointWitnessesHash,
  checkpoint_finalization_hash: finalization.artifact_hash,
  finalization_status: finalization.finalization_status,
  satisfied_witness_count: finalization.satisfied_witness_count,
  signed_witness_threshold: finalization.signed_witness_threshold
}, null, 2));
