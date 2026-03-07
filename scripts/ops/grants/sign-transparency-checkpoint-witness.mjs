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

  const required = [
    "schema",
    "created_at",
    "entry_count",
    "log_root"
  ];

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

  const cumulativeRoot = getCheckpointCumulativeRoot(checkpoint);

  if (!cumulativeRoot) {
    fail(
      `Checkpoint missing cumulative root (tried cumulative_root, checkpoint_cumulative_root, transparency_cumulative_root, head_entry_cumulative_root, root_chain_hash, cumulative_hash, checkpoint_root_chain_hash, cumulativeRoot, rootChainHash)`
    );
  }

  if (!/^[a-f0-9]{64}$/.test(cumulativeRoot)) {
    fail(`Invalid cumulative root format in ${checkpointPath}`);
  }

  if (!/^[a-f0-9]{64}$/.test(checkpoint.log_root)) {
    fail(`Invalid log_root format in ${checkpointPath}`);
  }

  if (!Number.isInteger(checkpoint.entry_count) || checkpoint.entry_count < 0) {
    fail(`entry_count must be a non-negative integer in ${checkpointPath}`);
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

const args = parseArgs(process.argv);

const checkpointPath =
  args.checkpoint || "manifests/transparency/checkpoint.json";
const outputPath =
  args.output || "manifests/transparency/checkpoint-witnesses.json";
const witnessId = args["witness-id"];
const displayName = args["display-name"] || witnessId;
const privateKeyPath = args["private-key"];
const publicKeyPath = args["public-key"];
const signedAt = resolveIsoTimestamp(
  args["signed-at"] || new Date().toISOString()
);

ensureFile(checkpointPath, "checkpoint");
ensureFile(privateKeyPath, "private-key");
ensureFile(publicKeyPath, "public-key");

if (!witnessId) {
  fail("Missing --witness-id");
}

const checkpoint = readJson(checkpointPath);
validateCheckpoint(checkpoint, checkpointPath);

const checkpointCanonical = stableStringify(checkpoint);
const checkpointHash = sha256Hex(Buffer.from(checkpointCanonical, "utf8"));

const signingPayload = buildSigningPayload(checkpoint, checkpointHash);
const payloadCanonical = stableStringify(signingPayload);
const payloadHash = sha256Hex(Buffer.from(payloadCanonical, "utf8"));

const privateKeyPem = normalizePem(fs.readFileSync(privateKeyPath, "utf8"));
const publicKeyPem = normalizePem(fs.readFileSync(publicKeyPath, "utf8"));
const publicKeyFingerprint = sha256Hex(Buffer.from(publicKeyPem, "utf8"));

const signature = crypto
  .sign("RSA-SHA256", Buffer.from(payloadCanonical, "utf8"), privateKeyPem)
  .toString("base64");

const witnessEntry = {
  schema: "grant-audit-transparency-witness-signature-v1",
  signature_version: "1.0.0",
  witness_id: witnessId,
  display_name: displayName,
  key_algorithm: "RSA-SHA256",
  public_key_pem_path: publicKeyPath,
  public_key_fingerprint_sha256: publicKeyFingerprint,
  signature_algorithm: "RSA-SHA256",
  signature_encoding: "base64",
  signed_at: signedAt,
  payload_hash: payloadHash,
  checkpoint_hash: checkpointHash,
  checkpoint_cumulative_root: getCheckpointCumulativeRoot(checkpoint),
  checkpoint_log_root: checkpoint.log_root,
  checkpoint_entry_count: checkpoint.entry_count,
  signature
};

let witnesses = [];
let createdAt = signedAt;

if (fs.existsSync(outputPath)) {
  const existing = readJson(outputPath);
  if (Array.isArray(existing.witnesses)) {
    witnesses = existing.witnesses.filter((w) => w.witness_id !== witnessId);
  }
  if (existing.created_at) {
    createdAt = existing.created_at;
  }
}

witnesses.push(witnessEntry);
witnesses.sort((a, b) => a.witness_id.localeCompare(b.witness_id));

const bundle = {
  schema: "grant-audit-transparency-checkpoint-witnesses-v1",
  artifact_version: "1.0.0",
  created_at: createdAt,
  updated_at: signedAt,
  checkpoint: {
    path: checkpointPath,
    checkpoint_hash: checkpointHash,
    checkpoint_created_at: checkpoint.created_at,
    entry_count: checkpoint.entry_count,
    log_root: checkpoint.log_root,
    cumulative_root: getCheckpointCumulativeRoot(checkpoint)
  },
  signing_payload: {
    schema: "grant-audit-transparency-checkpoint-witness-signing-payload-v1",
    payload_version: "1.0.0",
    canonicalization: "deterministic-recursive-key-sorted-json",
    hash_algorithm: "SHA-256",
    payload_hash: payloadHash
  },
  witnesses
};

writeJson(outputPath, bundle);

console.log(
  JSON.stringify(
    {
      ok: true,
      output: outputPath,
      witness_id: witnessId,
      checkpoint_hash: checkpointHash,
      checkpoint_cumulative_root: getCheckpointCumulativeRoot(checkpoint),
      payload_hash: payloadHash,
      witness_count: witnesses.length
    },
    null,
    2
  )
);
