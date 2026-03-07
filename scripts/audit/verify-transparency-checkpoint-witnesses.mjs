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

function verifySignature(publicKeyPem, messageHex, signatureBase64) {
  const verifier = crypto.createVerify("SHA256");
  verifier.update(Buffer.from(messageHex, "utf8"));
  verifier.end();
  return verifier.verify(publicKeyPem, Buffer.from(signatureBase64, "base64"));
}

const repoRoot = process.cwd();
const manifestsDir = path.join(repoRoot, "manifests", "transparency");

const checkpointPath = path.join(manifestsDir, "checkpoint.json");
const witnessPath = path.join(manifestsDir, "checkpoint-witnesses.json");

const checkpoint = readJson(checkpointPath);
const witnessArtifact = readJson(witnessPath);

const checkpointHash = sha256Hex(canonicalize(checkpoint));

if (witnessArtifact.checkpoint_hash !== checkpointHash) {
  throw new Error(`Checkpoint hash mismatch: witness artifact=${witnessArtifact.checkpoint_hash}, actual=${checkpointHash}`);
}

const recomputedArtifact = { ...witnessArtifact };
delete recomputedArtifact.artifact_hash;
const recomputedArtifactHash = sha256Hex(canonicalize(recomputedArtifact));

if (witnessArtifact.artifact_hash !== recomputedArtifactHash) {
  throw new Error(`Witness artifact hash mismatch: expected ${recomputedArtifactHash}, got ${witnessArtifact.artifact_hash}`);
}

let verifiedCount = 0;

for (const witness of witnessArtifact.witnesses) {
  const publicKeyPath = path.join(repoRoot, witness.public_key_path);
  if (!fs.existsSync(publicKeyPath)) {
    throw new Error(`Missing witness public key: ${publicKeyPath}`);
  }

  const publicKeyPem = fs.readFileSync(publicKeyPath, "utf8");
  const ok = verifySignature(publicKeyPem, checkpointHash, witness.signature_base64);
  if (!ok) {
    throw new Error(`Invalid witness signature for ${witness.witness_id}`);
  }

  if (witness.checkpoint_hash !== checkpointHash) {
    throw new Error(`Witness ${witness.witness_id} signed mismatched checkpoint hash`);
  }

  verifiedCount += 1;
}

if (verifiedCount < witnessArtifact.signed_witness_threshold) {
  throw new Error(`Verified witness count ${verifiedCount} is below threshold ${witnessArtifact.signed_witness_threshold}`);
}

console.log(JSON.stringify({
  verification_status: "verified",
  checkpoint_hash: checkpointHash,
  witness_artifact_hash: witnessArtifact.artifact_hash,
  verified_witness_count: verifiedCount,
  signed_witness_threshold: witnessArtifact.signed_witness_threshold
}, null, 2));
