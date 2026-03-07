#!/usr/bin/env node
import fs from "fs";
import path from "path";
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

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function writeJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${canonicalize(value)}\n`);
}

function loadSchema(schemaPath) {
  return readJson(schemaPath);
}

function validateWithSchema(schemaPath, data, label) {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false
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

function isBundleProofDoc(proofDoc) {
  return Array.isArray(proofDoc?.proofs);
}

function selectConsistencyProof(proofDoc, oldSize, newSize) {
  if (isBundleProofDoc(proofDoc)) {
    const match = proofDoc.proofs.find(
      (item) =>
        Number(item?.old_size) === Number(oldSize) &&
        Number(item?.new_size) === Number(newSize)
    );

    if (!match) {
      throw new Error(
        `No bundled consistency proof found for ${oldSize}->${newSize}`
      );
    }

    return {
      proof_schema:
        match.schema ||
        proofDoc.proof_item_schema ||
        proofDoc.proof_schema ||
        "grant-audit-transparency-log-consistency-proof-v1",
      proof_version:
        match.proof_version ||
        proofDoc.proof_version ||
        proofDoc.bundle_version ||
        "1.0.0",
      ...match
    };
  }

  if (
    Number(proofDoc?.old_size) === Number(oldSize) &&
    Number(proofDoc?.new_size) === Number(newSize)
  ) {
    return proofDoc;
  }

  throw new Error(
    `Consistency proof file does not contain a matching proof for ${oldSize}->${newSize}`
  );
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

function normalizeCheckpoint(filePath, checkpointDoc) {
  return {
    path: filePath,
    sha256: sha256Bytes(readFile(filePath)),
    entry_count: Number(checkpointDoc.entry_count),
    log_root: checkpointDoc.log_root,
    head_entry_hash: checkpointDoc.head_entry_hash,
    head_entry_cumulative_root: checkpointDoc.head_entry_cumulative_root,
    checkpoint_created_at: checkpointDoc.created_at
  };
}

function normalizeProof(filePath, proofDoc, oldSize, newSize) {
  const selected = selectConsistencyProof(proofDoc, oldSize, newSize);

  const proofArray =
    selected.proof ||
    selected.proof_hashes ||
    selected.prefix_entry_hashes ||
    selected.appended_entry_hashes ||
    [];

  if (!Array.isArray(proofArray)) {
    throw new Error("Selected consistency proof has no proof array");
  }

  const normalized = {
    path: filePath,
    sha256: sha256Bytes(readFile(filePath)),
    proof_schema:
      selected.schema ||
      selected.proof_schema ||
      proofDoc.schema ||
      "grant-audit-transparency-log-consistency-proof-v1",
    proof_version:
      selected.proof_version ||
      proofDoc.proof_version ||
      proofDoc.bundle_version ||
      "1.0.0",
    old_size: Number(selected.old_size),
    new_size: Number(selected.new_size),
    old_root: selected.old_root,
    new_root: selected.new_root,
    old_tail_cumulative_root: selected.old_tail_cumulative_root,
    proof: proofArray
  };

  const missing = [];
  for (const key of [
    "old_size",
    "new_size",
    "old_root",
    "new_root",
    "old_tail_cumulative_root"
  ]) {
    if (
      normalized[key] === undefined ||
      normalized[key] === null ||
      normalized[key] === ""
    ) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Selected consistency proof is missing required fields: ${missing.join(
        ", "
      )}`
    );
  }

  return normalized;
}

function maybeValidateProofArtifact(proofSchemaPath, proofDoc) {
  if (isBundleProofDoc(proofDoc)) {
    return;
  }
  validateWithSchema(
    proofSchemaPath,
    proofDoc,
    "consistency proof artifact"
  );
}

function buildVerificationChecks(oldCheckpoint, newCheckpoint, proof) {
  return {
    old_checkpoint_entry_count_matches_proof_old_size:
      oldCheckpoint.entry_count === proof.old_size,
    new_checkpoint_entry_count_matches_proof_new_size:
      newCheckpoint.entry_count === proof.new_size,
    old_checkpoint_log_root_matches_proof_old_root:
      oldCheckpoint.log_root === proof.old_root,
    new_checkpoint_log_root_matches_proof_new_root:
      newCheckpoint.log_root === proof.new_root,
    old_checkpoint_head_cumulative_root_matches_proof_old_tail_cumulative_root:
      oldCheckpoint.head_entry_cumulative_root === proof.old_tail_cumulative_root,
    new_checkpoint_is_strict_extension:
      newCheckpoint.entry_count > oldCheckpoint.entry_count
  };
}

function main() {
  const args = parseArgs(process.argv);

  const oldCheckpointPath = must(
    args["old-checkpoint"],
    "Missing --old-checkpoint"
  );
  const newCheckpointPath = must(
    args["new-checkpoint"],
    "Missing --new-checkpoint"
  );
  const proofPath = must(args["proof"], "Missing --proof");
  const outPath = must(args["out"], "Missing --out");

  const checkpointSchemaPath =
    args["checkpoint-schema"] ||
    "schemas/grant-audit-transparency-log-checkpoint-v1.schema.json";
  const proofSchemaPath =
    args["proof-schema"] ||
    "schemas/grant-audit-transparency-log-consistency-proof-v1.schema.json";
  const bridgeSchemaPath =
    args["bridge-schema"] ||
    "schemas/grant-audit-transparency-checkpoint-consistency-v1.schema.json";

  const oldCheckpointDoc = readJson(oldCheckpointPath);
  const newCheckpointDoc = readJson(newCheckpointPath);
  const proofDoc = readJson(proofPath);

  validateWithSchema(
    checkpointSchemaPath,
    oldCheckpointDoc,
    "old checkpoint artifact"
  );
  validateWithSchema(
    checkpointSchemaPath,
    newCheckpointDoc,
    "new checkpoint artifact"
  );

  maybeValidateProofArtifact(proofSchemaPath, proofDoc);

  const oldCheckpoint = normalizeCheckpoint(oldCheckpointPath, oldCheckpointDoc);
  const newCheckpoint = normalizeCheckpoint(newCheckpointPath, newCheckpointDoc);
  const proof = normalizeProof(
    proofPath,
    proofDoc,
    oldCheckpoint.entry_count,
    newCheckpoint.entry_count
  );

  const checks = buildVerificationChecks(oldCheckpoint, newCheckpoint, proof);

  const bridge = {
    schema: "grant-audit-transparency-checkpoint-consistency-v1",
    bridge_version: "1.0.0",
    created_at: new Date().toISOString(),
    old_checkpoint: oldCheckpoint,
    new_checkpoint: newCheckpoint,
    consistency_proof: proof,
    verification: {
      append_only: Object.values(checks).every(Boolean),
      checks
    }
  };

  if (args["proof-verification"]) {
    const proofVerificationPath = args["proof-verification"];
    const proofVerificationDoc = readJson(proofVerificationPath);
    const validity = extractVerificationValidity(proofVerificationDoc);

    bridge.consistency_proof_verification = {
      path: proofVerificationPath,
      sha256: sha256Bytes(readFile(proofVerificationPath)),
      ...(typeof validity === "boolean" ? { is_valid: validity } : {})
    };
  }

  validateWithSchema(bridgeSchemaPath, bridge, "checkpoint consistency bridge");

  writeJson(outPath, bridge);
  process.stdout.write(`${JSON.stringify(bridge, null, 2)}\n`);
}

main();
