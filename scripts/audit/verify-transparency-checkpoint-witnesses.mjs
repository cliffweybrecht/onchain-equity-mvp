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
  if (value && typeof value === "object" && !(value instanceof Date)) {
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
    fail(
      `Unexpected checkpoint schema "${checkpoint.schema}" in ${checkpointPath}`
    );
  }

  if (!/^[a-f0-9]{64}$/.test(checkpoint.log_root)) {
    fail(`Checkpoint log_root must be 64-char lowercase hex in ${checkpointPath}`);
  }

  const cumulativeRoot = getCheckpointCumulativeRoot(checkpoint);
  if (!cumulativeRoot) {
    fail(
      `Checkpoint missing cumulative root field (expected one of cumulative_root, checkpoint_cumulative_root, transparency_cumulative_root, head_entry_cumulative_root, root_chain_hash, cumulative_hash, checkpoint_root_chain_hash, cumulativeRoot, rootChainHash) in ${checkpointPath}`
    );
  }

  if (!/^[a-f0-9]{64}$/.test(cumulativeRoot)) {
    fail(
      `Checkpoint cumulative root must be 64-char lowercase hex in ${checkpointPath}`
    );
  }

  if (!Number.isInteger(checkpoint.entry_count) || checkpoint.entry_count < 0) {
    fail(`Checkpoint entry_count must be a non-negative integer in ${checkpointPath}`);
  }
}

function validateBundle(bundle, bundlePath) {
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

const args = parseArgs(process.argv);

const checkpointPath =
  args.checkpoint || "manifests/transparency/checkpoint.json";
const bundlePath =
  args.bundle || "manifests/transparency/checkpoint-witnesses.json";

ensureFile(checkpointPath, "checkpoint");
ensureFile(bundlePath, "bundle");

const checkpoint = readJson(checkpointPath);
const bundle = readJson(bundlePath);

validateCheckpoint(checkpoint, checkpointPath);
validateBundle(bundle, bundlePath);

const checkpointCanonical = stableStringify(checkpoint);
const checkpointHash = sha256Hex(Buffer.from(checkpointCanonical, "utf8"));
const checkpointCumulativeRoot = getCheckpointCumulativeRoot(checkpoint);

if (bundle.checkpoint.checkpoint_hash !== checkpointHash) {
  fail(
    `Checkpoint hash mismatch: bundle=${bundle.checkpoint.checkpoint_hash} computed=${checkpointHash}`
  );
}

if (bundle.checkpoint.log_root !== checkpoint.log_root) {
  fail(
    `Checkpoint log_root mismatch: bundle=${bundle.checkpoint.log_root} checkpoint=${checkpoint.log_root}`
  );
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
  fail(
    `Signing payload hash mismatch: bundle=${bundle.signing_payload.payload_hash} computed=${payloadHash}`
  );
}

const seenWitnessIds = new Set();
const results = [];

for (const witness of bundle.witnesses) {
  if (!witness || typeof witness !== "object") {
    fail("Encountered invalid witness entry");
  }

  if (witness.schema !== "grant-audit-transparency-witness-signature-v1") {
    fail(`Witness ${witness.witness_id || "<unknown>"} has unexpected schema`);
  }

  if (!witness.witness_id || typeof witness.witness_id !== "string") {
    fail("Witness entry missing witness_id");
  }

  if (seenWitnessIds.has(witness.witness_id)) {
    fail(`Duplicate witness_id in bundle: ${witness.witness_id}`);
  }
  seenWitnessIds.add(witness.witness_id);

  if (witness.payload_hash !== payloadHash) {
    fail(
      `Witness ${witness.witness_id} payload_hash mismatch: ${witness.payload_hash} != ${payloadHash}`
    );
  }

  if (witness.checkpoint_hash !== checkpointHash) {
    fail(
      `Witness ${witness.witness_id} checkpoint_hash mismatch: ${witness.checkpoint_hash} != ${checkpointHash}`
    );
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

  ensureFile(
    witness.public_key_pem_path,
    `public key for witness ${witness.witness_id}`
  );

  const publicKeyPem = normalizePem(
    fs.readFileSync(witness.public_key_pem_path, "utf8")
  );
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

  results.push({
    witness_id: witness.witness_id,
    display_name: witness.display_name,
    signed_at: witness.signed_at,
    public_key_fingerprint_sha256: publicKeyFingerprint,
    verified: true
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checkpoint_path: checkpointPath,
      bundle_path: bundlePath,
      checkpoint_hash: checkpointHash,
      checkpoint_cumulative_root: checkpointCumulativeRoot,
      checkpoint_log_root: checkpoint.log_root,
      checkpoint_entry_count: checkpoint.entry_count,
      payload_hash: payloadHash,
      witness_count: results.length,
      witnesses: results
    },
    null,
    2
  )
);
