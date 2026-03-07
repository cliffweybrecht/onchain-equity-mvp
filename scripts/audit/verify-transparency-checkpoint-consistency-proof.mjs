#!/usr/bin/env node
import fs from "fs";
import crypto from "crypto";
import Ajv2020 from "ajv/dist/2020.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function must(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function readFile(filePath) {
  return fs.readFileSync(filePath);
}

function readJson(filePath) {
  return JSON.parse(readFile(filePath).toString("utf8"));
}

function sha256Bytes(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function loadSchema(schemaPath) {
  return readJson(schemaPath);
}

function validateWithSchema(schemaPath, data, label) {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true
  });
  const schema = loadSchema(schemaPath);
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    const details = (validate.errors || [])
      .map((err) => `${err.instancePath || "/"} ${err.message}`)
      .join("; ");
    throw new Error(`${label} failed schema validation: ${details}`);
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function extractVerificationValidity(doc) {
  const candidates = [
    doc?.is_valid,
    doc?.valid,
    doc?.verification?.is_valid,
    doc?.verification?.valid,
    doc?.result?.is_valid,
    doc?.result?.valid
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  return null;
}

function verifyHashIfPresent(filePath, expectedHash) {
  if (!filePath || !expectedHash) {
    return true;
  }
  if (!fileExists(filePath)) {
    return false;
  }
  const actual = sha256Bytes(readFile(filePath));
  return actual === expectedHash;
}

function main() {
  const args = parseArgs(process.argv);

  const bridgePath = must(args["bridge"], "Missing --bridge");
  const bridgeSchemaPath =
    args["bridge-schema"] ||
    "schemas/grant-audit-transparency-checkpoint-consistency-v1.schema.json";
  const checkpointSchemaPath =
    args["checkpoint-schema"] ||
    "schemas/grant-audit-transparency-log-checkpoint-v1.schema.json";

  const bridge = readJson(bridgePath);

  validateWithSchema(
    bridgeSchemaPath,
    bridge,
    "checkpoint consistency bridge artifact"
  );

  const oldCheckpointPath = bridge.old_checkpoint.path;
  const newCheckpointPath = bridge.new_checkpoint.path;

  if (fileExists(oldCheckpointPath)) {
    const oldCheckpointDoc = readJson(oldCheckpointPath);
    validateWithSchema(
      checkpointSchemaPath,
      oldCheckpointDoc,
      "old checkpoint artifact"
    );
  }

  if (fileExists(newCheckpointPath)) {
    const newCheckpointDoc = readJson(newCheckpointPath);
    validateWithSchema(
      checkpointSchemaPath,
      newCheckpointDoc,
      "new checkpoint artifact"
    );
  }

  const checks = {
    old_checkpoint_sha256_matches_source: verifyHashIfPresent(
      bridge.old_checkpoint.path,
      bridge.old_checkpoint.sha256
    ),
    new_checkpoint_sha256_matches_source: verifyHashIfPresent(
      bridge.new_checkpoint.path,
      bridge.new_checkpoint.sha256
    ),
    consistency_proof_sha256_matches_source: verifyHashIfPresent(
      bridge.consistency_proof.path,
      bridge.consistency_proof.sha256
    ),
    consistency_proof_verification_sha256_matches_source:
      bridge.consistency_proof_verification
        ? verifyHashIfPresent(
            bridge.consistency_proof_verification.path,
            bridge.consistency_proof_verification.sha256
          )
        : true,

    old_checkpoint_entry_count_matches_proof_old_size:
      Number(bridge.old_checkpoint.entry_count) ===
      Number(bridge.consistency_proof.old_size),

    new_checkpoint_entry_count_matches_proof_new_size:
      Number(bridge.new_checkpoint.entry_count) ===
      Number(bridge.consistency_proof.new_size),

    old_checkpoint_log_root_matches_proof_old_root:
      bridge.old_checkpoint.log_root === bridge.consistency_proof.old_root,

    new_checkpoint_log_root_matches_proof_new_root:
      bridge.new_checkpoint.log_root === bridge.consistency_proof.new_root,

    old_checkpoint_head_cumulative_root_matches_proof_old_tail_cumulative_root:
      bridge.old_checkpoint.head_entry_cumulative_root ===
      bridge.consistency_proof.old_tail_cumulative_root,

    new_checkpoint_is_strict_extension:
      Number(bridge.new_checkpoint.entry_count) >
      Number(bridge.old_checkpoint.entry_count)
  };

  if (
    bridge.consistency_proof_verification?.path &&
    fileExists(bridge.consistency_proof_verification.path)
  ) {
    const verificationDoc = readJson(bridge.consistency_proof_verification.path);
    const validity = extractVerificationValidity(verificationDoc);
    checks.consistency_proof_verification_artifact_is_valid =
      typeof validity === "boolean" ? validity : true;
  } else if (bridge.consistency_proof_verification?.is_valid !== undefined) {
    checks.consistency_proof_verification_artifact_is_valid =
      bridge.consistency_proof_verification.is_valid === true;
  } else {
    checks.consistency_proof_verification_artifact_is_valid = true;
  }

  const isValid = Object.values(checks).every(Boolean);

  const result = {
    schema: "grant-audit-transparency-checkpoint-consistency-proof-verification-v1",
    verified_at: new Date().toISOString(),
    bridge_path: bridgePath,
    bridge_sha256: sha256Bytes(readFile(bridgePath)),
    is_valid: isValid,
    checks
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!isValid) {
    process.exit(1);
  }
}

main();
