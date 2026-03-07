#!/usr/bin/env node

import fs from "fs";
import path from "path";
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveIsoTimestamp(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    fail(`Invalid timestamp: ${value}`);
  }
  return d.toISOString();
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
      "Checkpoint missing cumulative root field (expected one of cumulative_root, checkpoint_cumulative_root, transparency_cumulative_root, head_entry_cumulative_root, root_chain_hash, cumulative_hash, checkpoint_root_chain_hash, cumulativeRoot, rootChainHash)"
    );
  }

  if (!/^[a-f0-9]{64}$/.test(cumulativeRoot)) {
    fail(`Checkpoint cumulative root must be 64-char lowercase hex in ${checkpointPath}`);
  }

  if (!Number.isInteger(checkpoint.entry_count) || checkpoint.entry_count < 0) {
    fail(`Checkpoint entry_count must be a non-negative integer in ${checkpointPath}`);
  }
}

function validateWitnessBundle(bundle, bundlePath) {
  if (!bundle || typeof bundle !== "object") {
    fail(`Invalid witness bundle JSON: ${bundlePath}`);
  }

  if (bundle.schema !== "grant-audit-transparency-checkpoint-witnesses-v1") {
    fail(`Unexpected witness bundle schema in ${bundlePath}`);
  }

  if (bundle.artifact_version !== "1.0.0") {
    fail(`Unexpected witness bundle artifact_version in ${bundlePath}`);
  }

  if (!bundle.checkpoint || typeof bundle.checkpoint !== "object") {
    fail(`Witness bundle missing checkpoint object in ${bundlePath}`);
  }

  if (!bundle.signing_payload || typeof bundle.signing_payload !== "object") {
    fail(`Witness bundle missing signing_payload object in ${bundlePath}`);
  }

  if (!Array.isArray(bundle.witnesses)) {
    fail(`Witness bundle witnesses field must be an array in ${bundlePath}`);
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
    fail(
      `Policy threshold ${policy.threshold} exceeds authorized witness count ${policy.authorized_witnesses.length}`
    );
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

    if (!/^[a-f0-9]{64}$/.test(witness.public_key_fingerprint_sha256)) {
      fail(`Invalid public_key_fingerprint_sha256 for authorized witness ${witness.witness_id}`);
    }

    ensureFile(witness.public_key_pem_path, `authorized witness public key ${witness.witness_id}`);
    const pem = normalizePem(fs.readFileSync(witness.public_key_pem_path, "utf8"));
    const fingerprint = sha256Hex(Buffer.from(pem, "utf8"));

    if (fingerprint !== witness.public_key_fingerprint_sha256) {
      fail(`Authorized witness fingerprint mismatch for ${witness.witness_id}`);
    }
  }
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

function verifyWitnessSignature(witness, payloadCanonical) {
  ensureFile(witness.public_key_pem_path, `public key for witness ${witness.witness_id}`);
  const publicKeyPem = normalizePem(fs.readFileSync(witness.public_key_pem_path, "utf8"));
  const publicKeyFingerprint = sha256Hex(Buffer.from(publicKeyPem, "utf8"));

  if (publicKeyFingerprint !== witness.public_key_fingerprint_sha256) {
    fail(`Witness ${witness.witness_id} public key fingerprint mismatch`);
  }

  const ok = crypto.verify(
    "RSA-SHA256",
    Buffer.from(payloadCanonical, "utf8"),
    publicKeyPem,
    Buffer.from(witness.signature, "base64")
  );

  if (!ok) {
    fail(`Witness ${witness.witness_id} signature verification failed`);
  }

  return true;
}

const args = parseArgs(process.argv);

const checkpointPath = args.checkpoint || "manifests/transparency/checkpoint.json";
const bundlePath = args.bundle || "manifests/transparency/checkpoint-witnesses.json";
const policyPath = args.policy || "manifests/transparency/checkpoint-finalization-policy.json";
const outputPath = args.output || "manifests/transparency/checkpoint-finalization.json";
const finalizedAt = resolveIsoTimestamp(args["finalized-at"] || new Date().toISOString());

ensureFile(checkpointPath, "checkpoint");
ensureFile(bundlePath, "bundle");
ensureFile(policyPath, "policy");

const checkpoint = readJson(checkpointPath);
const bundle = readJson(bundlePath);
const policy = readJson(policyPath);

validateCheckpoint(checkpoint, checkpointPath);
validateWitnessBundle(bundle, bundlePath);
validatePolicy(policy, policyPath);

const checkpointCanonical = stableStringify(checkpoint);
const checkpointHash = sha256Hex(Buffer.from(checkpointCanonical, "utf8"));
const checkpointCumulativeRoot = getCheckpointCumulativeRoot(checkpoint);

if (bundle.checkpoint.checkpoint_hash !== checkpointHash) {
  fail(`Checkpoint hash mismatch: bundle=${bundle.checkpoint.checkpoint_hash} computed=${checkpointHash}`);
}

if (bundle.checkpoint.log_root !== checkpoint.log_root) {
  fail(`Checkpoint log_root mismatch: bundle=${bundle.checkpoint.log_root} checkpoint=${checkpoint.log_root}`);
}

if (bundle.checkpoint.cumulative_root !== checkpointCumulativeRoot) {
  fail(
    `Checkpoint cumulative_root mismatch: bundle=${bundle.checkpoint.cumulative_root} checkpoint=${checkpointCumulativeRoot}`
  );
}

if (bundle.checkpoint.entry_count !== checkpoint.entry_count) {
  fail(
    `Checkpoint entry_count mismatch: bundle=${bundle.checkpoint.entry_count} checkpoint=${checkpoint.entry_count}`
  );
}

const signingPayload = buildSigningPayload(checkpoint, checkpointHash);
const payloadCanonical = stableStringify(signingPayload);
const payloadHash = sha256Hex(Buffer.from(payloadCanonical, "utf8"));

if (bundle.signing_payload.payload_hash !== payloadHash) {
  fail(`Signing payload hash mismatch: bundle=${bundle.signing_payload.payload_hash} computed=${payloadHash}`);
}

const policyCanonical = stableStringify(policy);
const policyHash = sha256Hex(Buffer.from(policyCanonical, "utf8"));

const bundleWitnessesById = new Map();
for (const witness of bundle.witnesses) {
  if (!witness || typeof witness !== "object") {
    fail("Encountered invalid witness entry in bundle");
  }

  if (bundleWitnessesById.has(witness.witness_id)) {
    fail(`Duplicate witness_id in bundle: ${witness.witness_id}`);
  }

  bundleWitnessesById.set(witness.witness_id, witness);
}

const verifiedWitnesses = [];

for (const authorized of policy.authorized_witnesses) {
  const witness = bundleWitnessesById.get(authorized.witness_id);
  if (!witness) {
    continue;
  }

  if (witness.schema !== "grant-audit-transparency-witness-signature-v1") {
    fail(`Witness ${witness.witness_id} has unexpected schema`);
  }

  if (witness.payload_hash !== payloadHash) {
    fail(`Witness ${witness.witness_id} payload_hash mismatch`);
  }

  if (witness.checkpoint_hash !== checkpointHash) {
    fail(`Witness ${witness.witness_id} checkpoint_hash mismatch`);
  }

  if (witness.checkpoint_cumulative_root !== checkpointCumulativeRoot) {
    fail(`Witness ${witness.witness_id} cumulative_root mismatch`);
  }

  if (witness.checkpoint_log_root !== checkpoint.log_root) {
    fail(`Witness ${witness.witness_id} log_root mismatch`);
  }

  if (witness.checkpoint_entry_count !== checkpoint.entry_count) {
    fail(`Witness ${witness.witness_id} entry_count mismatch`);
  }

  if (witness.public_key_pem_path !== authorized.public_key_pem_path) {
    fail(`Witness ${witness.witness_id} public_key_pem_path mismatch vs policy`);
  }

  if (witness.public_key_fingerprint_sha256 !== authorized.public_key_fingerprint_sha256) {
    fail(`Witness ${witness.witness_id} public_key_fingerprint_sha256 mismatch vs policy`);
  }

  verifyWitnessSignature(witness, payloadCanonical);
  verifiedWitnesses.push(witness);
}

verifiedWitnesses.sort((a, b) => a.witness_id.localeCompare(b.witness_id));

const verifiedWitnessIds = verifiedWitnesses.map((w) => w.witness_id);
const missingWitnessIds = policy.authorized_witnesses
  .map((w) => w.witness_id)
  .filter((witnessId) => !verifiedWitnessIds.includes(witnessId));

const quorumSatisfied = verifiedWitnesses.length >= policy.threshold;

if (!quorumSatisfied) {
  fail(
    `Checkpoint finalization quorum not satisfied: verified=${verifiedWitnesses.length} required=${policy.threshold}`
  );
}

let createdAt = finalizedAt;
if (fs.existsSync(outputPath)) {
  const existing = readJson(outputPath);
  if (existing.created_at) {
    createdAt = existing.created_at;
  }
}

const finalizationArtifact = {
  schema: "grant-audit-transparency-checkpoint-finalization-v1",
  artifact_version: "1.0.0",
  created_at: createdAt,
  finalized_at: finalizedAt,
  checkpoint: {
    path: checkpointPath,
    checkpoint_hash: checkpointHash,
    checkpoint_created_at: checkpoint.created_at,
    entry_count: checkpoint.entry_count,
    log_root: checkpoint.log_root,
    cumulative_root: checkpointCumulativeRoot
  },
  signing_payload: {
    schema: "grant-audit-transparency-checkpoint-witness-signing-payload-v1",
    payload_version: "1.0.0",
    canonicalization: "deterministic-recursive-key-sorted-json",
    hash_algorithm: "SHA-256",
    payload_hash: payloadHash
  },
  finalization_policy: {
    schema: "grant-audit-transparency-checkpoint-finalization-policy-v1",
    policy_version: "1.0.0",
    policy_path: policyPath,
    policy_hash: policyHash,
    threshold: policy.threshold,
    eligible_witness_count: policy.authorized_witnesses.length,
    authorized_witnesses: policy.authorized_witnesses
  },
  quorum_status: {
    satisfied: true,
    required_witness_count: policy.threshold,
    verified_witness_count: verifiedWitnesses.length,
    eligible_witness_count: policy.authorized_witnesses.length,
    verified_witness_ids: verifiedWitnessIds,
    missing_witness_ids: missingWitnessIds
  },
  verified_witnesses: verifiedWitnesses
};

writeJson(outputPath, finalizationArtifact);

console.log(
  JSON.stringify(
    {
      ok: true,
      output: outputPath,
      finalized_at: finalizedAt,
      checkpoint_hash: checkpointHash,
      checkpoint_cumulative_root: checkpointCumulativeRoot,
      payload_hash: payloadHash,
      policy_hash: policyHash,
      threshold: policy.threshold,
      verified_witness_count: verifiedWitnesses.length,
      eligible_witness_count: policy.authorized_witnesses.length,
      verified_witness_ids: verifiedWitnessIds
    },
    null,
    2
  )
);
