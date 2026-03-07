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
const evidenceDir = path.join(repoRoot, "evidence", "phase-7.27");

const checkpoint = readJson(path.join(manifestsDir, "checkpoint.json"));
const transparencyLog = readJson(path.join(manifestsDir, "transparency-log.json"));
const checkpointWitnesses = readJson(path.join(manifestsDir, "checkpoint-witnesses.json"));
const checkpointFinalization = readJson(path.join(manifestsDir, "checkpoint-finalization.json"));
const rebinding = readJson(path.join(evidenceDir, "transparency-checkpoint-rebinding.json"));

const checkpointHash = sha256Hex(canonicalize(checkpoint));
const checkpointWitnessesHash = sha256Hex(canonicalize(checkpointWitnesses));
const checkpointFinalizationHash = sha256Hex(canonicalize(checkpointFinalization));
const transparencyLogRoot =
  checkpoint.transparency_log_root ||
  checkpoint.log_root ||
  transparencyLog.root ||
  transparencyLog.transparency_log_root;

if (rebinding.checkpoint.checkpoint_hash !== checkpointHash) {
  throw new Error("Rebinding checkpoint hash mismatch");
}
if (rebinding.checkpoint.transparency_log_root !== transparencyLogRoot) {
  throw new Error("Rebinding transparency log root mismatch");
}
if (rebinding.rebound_witnesses.artifact_hash !== checkpointWitnessesHash) {
  throw new Error("Rebinding witness artifact hash mismatch");
}
if (rebinding.rebound_finalization.artifact_hash !== checkpointFinalizationHash) {
  throw new Error("Rebinding finalization artifact hash mismatch");
}
if (checkpointFinalization.finalization_status !== "finalized") {
  throw new Error("Checkpoint finalization artifact is not finalized");
}

const recomputed = { ...rebinding };
const originalHash = rebinding.hashes.rebinding_hash;
delete recomputed.hashes;
const recomputedHash = sha256Hex(canonicalize(recomputed));

if (originalHash !== recomputedHash) {
  throw new Error(`Rebinding hash mismatch: expected ${recomputedHash}, got ${originalHash}`);
}

console.log(JSON.stringify({
  verification_status: "verified",
  checkpoint_hash: checkpointHash,
  transparency_log_root: transparencyLogRoot,
  rebound_witnesses_hash: checkpointWitnessesHash,
  rebound_finalization_hash: checkpointFinalizationHash,
  rebinding_hash: originalHash,
  finalization_status: checkpointFinalization.finalization_status
}, null, 2));
