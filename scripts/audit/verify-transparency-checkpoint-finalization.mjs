#!/usr/bin/env node

import fs from "fs";
import crypto from "crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
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

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function ensureFile(filePath, label) {
  if (!filePath) fail(`Missing required ${label}`);
  if (!fs.existsSync(filePath)) fail(`${label} not found: ${filePath}`);
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map(stableSort);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = stableSort(value[key]);
    }
    return result;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSort(value));
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizePem(pem) {
  return `${pem.replace(/\r\n/g, "\n").trim()}\n`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getCheckpointCumulativeRoot(checkpoint) {
  const candidates = [
    checkpoint.cumulative_root,
    checkpoint.checkpoint_cumulative_root,
    checkpoint.transparency_cumulative_root,
    checkpoint.head_entry_cumulative_root,
    checkpoint.root_chain_hash,
    checkpoint.cumulative_hash,
    checkpoint.checkpoint_root_chain_hash,
    checkpoint.cumulativeRoot,
    checkpoint.rootChainHash
  ];

  for (const value of candidates) {
    if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) {
      return value;
    }
  }

  return null;
}

function buildSigningPayload(checkpoint, checkpointHash) {
  return {
    schema: "grant-audit-transparency-checkpoint-witness-signing-payload-v1",
    payload_version: "1.0.0",
    checkpoint_hash: checkpointHash,
    checkpoint_cumulative_root: getCheckpointCumulativeRoot(checkpoint),
    checkpoint_log_root: checkpoint.log_root,
    checkpoint_entry_count: checkpoint.entry_count
  };
}

function validateCheckpoint(checkpoint, checkpointPath) {
  if (!checkpoint || typeof checkpoint !== "object") {
    fail(`Invalid checkpoint JSON: ${checkpointPath}`);
  }

  const required = ["schema", "created_at", "entry_count", "log_root"];
  for (const field of required) {
    if (!(field in checkpoint)) {
      fail(`Checkpoint missing required field "${field}" in ${checkpointPath}`);
    }
  }

  if (checkpoint.schema !== "grant-audit-transparency-log-checkpoint-v1") {
    fail(`Unexpected checkpoint schema "${checkpoint.schema}" in ${checkpointPath}`);
  }

  if (!/^[a-f0-9]{64}$/.test(checkpoint.log_root)) {
    fail(`Checkpoint log_root must be 64-char lowercase hex in ${checkpointPath}`);
  }

  const cumulativeRoot = getCheckpointCumulativeRoot(checkpoint);
  if (!cumulativeRoot) {
    fail(
      `Checkpoint missing cumulative root field in ${checkpointPath}`
    );
  }

  if (!/^[a-f0-9]{64}$/.test(cumulativeRoot)) {
    fail(`Checkpoint cumulative root must be 64-char lowercase hex in ${checkpointPath}`);
  }

  if (!Number.isInteger(checkpoint.entry_count) || checkpoint.entry_count < 0) {
    fail(`Checkpoint entry_count must be a non-negative integer in ${checkpointPath}`);
  }
}

function validatePolicy(policy, policyPath) {
  if (!policy || typeof policy !== "object") {
    fail(`Invalid finalization policy JSON: ${policyPath}`);
  }

  if (policy.schema !== "grant-audit-transparency-checkpoint-finalization-policy-v1") {
    fail(`Unexpected finalization policy schema in ${policyPath}`);
  }

  if (policy.policy_version !== "1.0.0") {
    fail(`Unexpected finalization policy version in ${policyPath}`);
  }

  if (!Number.isInteger(policy.threshold) || policy.threshold < 1) {
    fail(`Policy threshold must be an integer >= 1 in ${policyPath}`);
  }

  if (!Array.isArray(policy.authorized_witnesses) || policy.authorized_witnesses.length === 0) {
    fail(`Policy authorized_witnesses must be a non-empty array in ${policyPath}`);
  }

  if (policy.threshold > policy.authorized_witnesses.length) {
    fail(`Policy threshold exceeds authorized witness count in ${policyPath}`);
  }

  const seen = new Set();
  for (const witness of policy.authorized_witnesses) {
    if (!witness || typeof witness !== "object") {
      fail(`Policy contains invalid authorized witness entry`);
    }

    const required = [
      "witness_id",
      "display_name",
      "public_key_pem_path",
      "public_key_fingerprint_sha256"
    ];

    for (const field of required) {
      if (!(field in witness)) {
        fail(`Authorized witness missing required field "${field}"`);
      }
    }

    if (seen.has(witness.witness_id)) {
      fail(`Duplicate authorized witness_id in policy: ${witness.witness_id}`);
    }
    seen.add(witness.witness_id);

    ensureFile(witness.public_key_pem_path, `authorized witness public key ${witness.witness_id}`);
    const pem = normalizePem(fs.readFileSync(witness.public_key_pem_path, "utf8"));
    const fingerprint = sha256Hex(Buffer.from(pem, "utf8"));
    if (fingerprint !== witness.public_key_fingerprint_sha256) {
      fail(`Authorized witness fingerprint mismatch for ${witness.witness_id}`);
    }
  }
}

function validateFinalizationArtifact(artifact, artifactPath) {
  if (!artifact || typeof artifact !== "object") {
    fail(`Invalid finalization artifact JSON: ${artifactPath}`);
  }

  if (artifact.schema !== "grant-audit-transparency-checkpoint-finalization-v1") {
    fail(`Unexpected finalization artifact schema in ${artifactPath}`);
  }

  if (artifact.artifact_version !== "1.0.0") {
    fail(`Unexpected finalization artifact version in ${artifactPath}`);
  }

  if (!artifact.checkpoint || typeof artifact.checkpoint !== "object") {
    fail(`Finalization artifact missing checkpoint object in ${artifactPath}`);
  }

  if (!artifact.signing_payload || typeof artifact.signing_payload !== "object") {
    fail(`Finalization artifact missing signing_payload object in ${artifactPath}`);
  }

  if (!artifact.finalization_policy || typeof artifact.finalization_policy !== "object") {
    fail(`Finalization artifact missing finalization_policy object in ${artifactPath}`);
  }

  if (!artifact.quorum_status || typeof artifact.quorum_status !== "object") {
    fail(`Finalization artifact missing quorum_status object in ${artifactPath}`);
  }

  if (!Array.isArray(artifact.verified_witnesses)) {
    fail(`Finalization artifact verified_witnesses must be an array in ${artifactPath}`);
  }
}

const args = parseArgs(process.argv);

const checkpointPath = args.checkpoint || "manifests/transparency/checkpoint.json";
const policyPath = args.policy || "manifests/transparency/checkpoint-finalization-policy.json";
const artifactPath = args.artifact || "manifests/transparency/checkpoint-finalization.json";

ensureFile(checkpointPath, "checkpoint");
ensureFile(policyPath, "policy");
ensureFile(artifactPath, "artifact");

const checkpoint = readJson(checkpointPath);
const policy = readJson(policyPath);
const artifact = readJson(artifactPath);

validateCheckpoint(checkpoint, checkpointPath);
validatePolicy(policy, policyPath);
validateFinalizationArtifact(artifact, artifactPath);

const checkpointCanonical = stableStringify(checkpoint);
const checkpointHash = sha256Hex(Buffer.from(checkpointCanonical, "utf8"));
const checkpointCumulativeRoot = getCheckpointCumulativeRoot(checkpoint);

const signingPayload = buildSigningPayload(checkpoint, checkpointHash);
const payloadCanonical = stableStringify(signingPayload);
const payloadHash = sha256Hex(Buffer.from(payloadCanonical, "utf8"));

const policyCanonical = stableStringify(policy);
const policyHash = sha256Hex(Buffer.from(policyCanonical, "utf8"));

if (artifact.checkpoint.path !== checkpointPath) {
  fail(`Artifact checkpoint path mismatch: ${artifact.checkpoint.path} != ${checkpointPath}`);
}

if (artifact.checkpoint.checkpoint_hash !== checkpointHash) {
  fail(`Artifact checkpoint hash mismatch`);
}

if (artifact.checkpoint.checkpoint_created_at !== checkpoint.created_at) {
  fail(`Artifact checkpoint_created_at mismatch`);
}

if (artifact.checkpoint.entry_count !== checkpoint.entry_count) {
  fail(`Artifact checkpoint entry_count mismatch`);
}

if (artifact.checkpoint.log_root !== checkpoint.log_root) {
  fail(`Artifact checkpoint log_root mismatch`);
}

if (artifact.checkpoint.cumulative_root !== checkpointCumulativeRoot) {
  fail(`Artifact checkpoint cumulative_root mismatch`);
}

if (artifact.signing_payload.schema !== "grant-audit-transparency-checkpoint-witness-signing-payload-v1") {
  fail(`Artifact signing_payload schema mismatch`);
}

if (artifact.signing_payload.payload_hash !== payloadHash) {
  fail(`Artifact signing_payload payload_hash mismatch`);
}

if (artifact.finalization_policy.schema !== "grant-audit-transparency-checkpoint-finalization-policy-v1") {
  fail(`Artifact finalization_policy schema mismatch`);
}

if (artifact.finalization_policy.policy_path !== policyPath) {
  fail(`Artifact finalization_policy policy_path mismatch`);
}

if (artifact.finalization_policy.policy_hash !== policyHash) {
  fail(`Artifact finalization_policy policy_hash mismatch`);
}

if (artifact.finalization_policy.threshold !== policy.threshold) {
  fail(`Artifact finalization_policy threshold mismatch`);
}

if (artifact.finalization_policy.eligible_witness_count !== policy.authorized_witnesses.length) {
  fail(`Artifact finalization_policy eligible_witness_count mismatch`);
}

const policyWitnessesById = new Map();
for (const witness of policy.authorized_witnesses) {
  policyWitnessesById.set(witness.witness_id, witness);
}

const seenVerified = new Set();
const verifiedWitnessIds = [];

for (const witness of artifact.verified_witnesses) {
  if (!witness || typeof witness !== "object") {
    fail(`Artifact contains invalid verified witness entry`);
  }

  if (witness.schema !== "grant-audit-transparency-witness-signature-v1") {
    fail(`Verified witness ${witness.witness_id || ""} has unexpected schema`);
  }

  if (!witness.witness_id || typeof witness.witness_id !== "string") {
    fail(`Verified witness missing witness_id`);
  }

  if (seenVerified.has(witness.witness_id)) {
    fail(`Duplicate verified witness_id in artifact: ${witness.witness_id}`);
  }
  seenVerified.add(witness.witness_id);

  const policyWitness = policyWitnessesById.get(witness.witness_id);
  if (!policyWitness) {
    fail(`Verified witness ${witness.witness_id} is not authorized by policy`);
  }

  if (witness.payload_hash !== payloadHash) {
    fail(`Verified witness ${witness.witness_id} payload_hash mismatch`);
  }

  if (witness.checkpoint_hash !== checkpointHash) {
    fail(`Verified witness ${witness.witness_id} checkpoint_hash mismatch`);
  }

  if (witness.checkpoint_cumulative_root !== checkpointCumulativeRoot) {
    fail(`Verified witness ${witness.witness_id} checkpoint_cumulative_root mismatch`);
  }

  if (witness.checkpoint_log_root !== checkpoint.log_root) {
    fail(`Verified witness ${witness.witness_id} checkpoint_log_root mismatch`);
  }

  if (witness.checkpoint_entry_count !== checkpoint.entry_count) {
    fail(`Verified witness ${witness.witness_id} checkpoint_entry_count mismatch`);
  }

  if (witness.public_key_pem_path !== policyWitness.public_key_pem_path) {
    fail(`Verified witness ${witness.witness_id} public_key_pem_path mismatch`);
  }

  if (witness.public_key_fingerprint_sha256 !== policyWitness.public_key_fingerprint_sha256) {
    fail(`Verified witness ${witness.witness_id} public_key_fingerprint_sha256 mismatch`);
  }

  ensureFile(witness.public_key_pem_path, `public key for verified witness ${witness.witness_id}`);
  const publicKeyPem = normalizePem(fs.readFileSync(witness.public_key_pem_path, "utf8"));
  const publicKeyFingerprint = sha256Hex(Buffer.from(publicKeyPem, "utf8"));

  if (publicKeyFingerprint !== witness.public_key_fingerprint_sha256) {
    fail(`Verified witness ${witness.witness_id} public key fingerprint mismatch`);
  }

  const ok = crypto.verify(
    "RSA-SHA256",
    Buffer.from(payloadCanonical, "utf8"),
    publicKeyPem,
    Buffer.from(witness.signature, "base64")
  );

  if (!ok) {
    fail(`Verified witness ${witness.witness_id} signature verification failed`);
  }

  verifiedWitnessIds.push(witness.witness_id);
}

verifiedWitnessIds.sort();

const missingWitnessIds = policy.authorized_witnesses
  .map((w) => w.witness_id)
  .filter((witnessId) => !verifiedWitnessIds.includes(witnessId));

const quorumSatisfied = verifiedWitnessIds.length >= policy.threshold;

if (artifact.quorum_status.satisfied !== quorumSatisfied) {
  fail(`Artifact quorum_status.satisfied mismatch`);
}

if (artifact.quorum_status.required_witness_count !== policy.threshold) {
  fail(`Artifact quorum_status.required_witness_count mismatch`);
}

if (artifact.quorum_status.verified_witness_count !== verifiedWitnessIds.length) {
  fail(`Artifact quorum_status.verified_witness_count mismatch`);
}

if (artifact.quorum_status.eligible_witness_count !== policy.authorized_witnesses.length) {
  fail(`Artifact quorum_status.eligible_witness_count mismatch`);
}

if (
  JSON.stringify([...artifact.quorum_status.verified_witness_ids].sort()) !==
  JSON.stringify(verifiedWitnessIds)
) {
  fail(`Artifact quorum_status.verified_witness_ids mismatch`);
}

if (
  JSON.stringify([...artifact.quorum_status.missing_witness_ids].sort()) !==
  JSON.stringify([...missingWitnessIds].sort())
) {
  fail(`Artifact quorum_status.missing_witness_ids mismatch`);
}

if (!quorumSatisfied) {
  fail(
    `Finalization quorum not satisfied: verified=${verifiedWitnessIds.length} required=${policy.threshold}`
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checkpoint_path: checkpointPath,
      policy_path: policyPath,
      artifact_path: artifactPath,
      checkpoint_hash: checkpointHash,
      checkpoint_cumulative_root: checkpointCumulativeRoot,
      payload_hash: payloadHash,
      policy_hash: policyHash,
      threshold: policy.threshold,
      verified_witness_count: verifiedWitnessIds.length,
      eligible_witness_count: policy.authorized_witnesses.length,
      verified_witness_ids: verifiedWitnessIds,
      missing_witness_ids: missingWitnessIds,
      quorum_satisfied: true
    },
    null,
    2
  )
);
