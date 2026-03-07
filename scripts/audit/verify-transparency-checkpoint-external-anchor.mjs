#!/usr/bin/env node

import fs from "fs";
import crypto from "crypto";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      fail(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (isPlainObject(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }

  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256Hex(filePath) {
  return sha256Hex(fs.readFileSync(filePath));
}

function ensureRegex(name, value, regex, helpText) {
  if (!regex.test(value)) {
    fail(`${name} is invalid: ${value}${helpText ? ` (${helpText})` : ""}`);
  }
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function getNested(obj, dottedPath) {
  const parts = dottedPath.split(".");
  let cursor = obj;

  for (const part of parts) {
    if (cursor === undefined || cursor === null || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }

  return cursor;
}

function pickField(obj, candidatePaths) {
  for (const candidate of candidatePaths) {
    const value = getNested(obj, candidate);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function validateAnchorEntry(entry) {
  if (
    entry.schema !==
    "grant-audit-transparency-checkpoint-external-anchor-entry-v1"
  ) {
    fail(`Unexpected anchor entry schema: ${entry.schema}`);
  }

  if (entry.entry_version !== "1.0.0") {
    fail(`Unexpected anchor entry version: ${entry.entry_version}`);
  }

  const validTypes = new Set([
    "git_commit",
    "ipfs_cid",
    "base_tx",
    "ethereum_l1_tx"
  ]);

  const validNetworks = new Set([
    "git",
    "ipfs",
    "base-sepolia",
    "base-mainnet",
    "ethereum-sepolia",
    "ethereum-mainnet"
  ]);

  if (!validTypes.has(entry.anchor_type)) {
    fail(`Unsupported anchor_type: ${entry.anchor_type}`);
  }

  if (!validNetworks.has(entry.anchor_network)) {
    fail(`Unsupported anchor_network: ${entry.anchor_network}`);
  }

  if (!entry.anchor_identifier || typeof entry.anchor_identifier !== "string") {
    fail("anchor_identifier must be a non-empty string");
  }

  const core = {
    schema: entry.schema,
    entry_version: entry.entry_version,
    anchor_type: entry.anchor_type,
    anchor_network: entry.anchor_network,
    anchor_identifier: entry.anchor_identifier,
    ...(entry.anchor_locator ? { anchor_locator: entry.anchor_locator } : {})
  };

  const recomputed = sha256Hex(canonicalStringify(core));
  if (entry.anchor_entry_hash !== recomputed) {
    fail(
      `anchor_entry_hash mismatch for ${entry.anchor_type}: ${entry.anchor_entry_hash} !== ${recomputed}`
    );
  }

  if (entry.anchor_type === "git_commit") {
    ensureRegex(
      "git commit",
      entry.anchor_identifier,
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/,
      "must be a full 40- or 64-character hash"
    );
  }

  if (entry.anchor_type === "ipfs_cid") {
    ensureRegex(
      "ipfs cid",
      entry.anchor_identifier,
      /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{10,})$/,
      "must look like a CIDv0 or CIDv1"
    );
  }

  if (entry.anchor_type === "base_tx" || entry.anchor_type === "ethereum_l1_tx") {
    ensureRegex(
      "transaction hash",
      entry.anchor_identifier,
      /^0x[a-f0-9]{64}$/,
      "must be a 32-byte hex hash"
    );
  }

  return recomputed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const manifestPath =
    args.manifest || "manifests/transparency/checkpoint-external-anchor.json";
  const checkpointWitnessesPath = args["checkpoint-witnesses"];
  const checkpointFinalizationPath = args["checkpoint-finalization"];
  const checkpointRebindingPath = args["checkpoint-rebinding"];

  if (!fs.existsSync(manifestPath)) {
    fail(`Manifest not found: ${manifestPath}`);
  }

  if (!checkpointWitnessesPath) {
    fail("--checkpoint-witnesses is required");
  }

  if (!checkpointFinalizationPath) {
    fail("--checkpoint-finalization is required");
  }

  if (!fs.existsSync(checkpointWitnessesPath)) {
    fail(`Checkpoint witnesses file not found: ${checkpointWitnessesPath}`);
  }

  if (!fs.existsSync(checkpointFinalizationPath)) {
    fail(`Checkpoint finalization file not found: ${checkpointFinalizationPath}`);
  }

  if (checkpointRebindingPath && !fs.existsSync(checkpointRebindingPath)) {
    fail(`Checkpoint rebinding file not found: ${checkpointRebindingPath}`);
  }

  const manifest = readJson(manifestPath);
  const checkpointWitnesses = readJson(checkpointWitnessesPath);
  const checkpointFinalization = readJson(checkpointFinalizationPath);
  const checkpointRebinding = checkpointRebindingPath
    ? readJson(checkpointRebindingPath)
    : null;

  if (
    manifest.schema !== "grant-audit-transparency-checkpoint-external-anchor-v1"
  ) {
    fail(`Unexpected manifest schema: ${manifest.schema}`);
  }

  if (manifest.manifest_version !== "1.0.0") {
    fail(`Unexpected manifest version: ${manifest.manifest_version}`);
  }

  if (!Array.isArray(manifest.anchors) || manifest.anchors.length === 0) {
    fail("Manifest must contain at least one anchor entry");
  }

  if (manifest.anchor_count !== manifest.anchors.length) {
    fail(
      `anchor_count mismatch: ${manifest.anchor_count} !== ${manifest.anchors.length}`
    );
  }

  const checkpointHash = firstDefined(
    pickField(checkpointFinalization, [
      "checkpoint_hash",
      "finalized_checkpoint.checkpoint_hash",
      "checkpoint.checkpoint_hash",
      "checkpoint_commitment.checkpoint_hash",
      "finalization_payload.checkpoint_hash",
      "rebound_checkpoint.checkpoint_hash",
      "bound_checkpoint.checkpoint_hash"
    ]),
    pickField(checkpointWitnesses, [
      "checkpoint_hash",
      "checkpoint.checkpoint_hash",
      "checkpoint_commitment.checkpoint_hash",
      "signed_checkpoint.checkpoint_hash",
      "witnessed_checkpoint.checkpoint_hash"
    ]),
    checkpointRebinding
      ? pickField(checkpointRebinding, [
          "checkpoint_hash",
          "checkpoint.checkpoint_hash",
          "bound_checkpoint.checkpoint_hash",
          "rebound_checkpoint.checkpoint_hash"
        ])
      : undefined
  );

  const transparencyLogRoot = firstDefined(
    pickField(checkpointFinalization, [
      "transparency_log_root",
      "finalized_checkpoint.transparency_log_root",
      "checkpoint.transparency_log_root",
      "checkpoint_commitment.transparency_log_root",
      "finalization_payload.transparency_log_root",
      "rebound_checkpoint.transparency_log_root",
      "bound_checkpoint.transparency_log_root"
    ]),
    pickField(checkpointWitnesses, [
      "transparency_log_root",
      "checkpoint.transparency_log_root",
      "checkpoint_commitment.transparency_log_root",
      "signed_checkpoint.transparency_log_root",
      "witnessed_checkpoint.transparency_log_root"
    ]),
    checkpointRebinding
      ? pickField(checkpointRebinding, [
          "transparency_log_root",
          "checkpoint.transparency_log_root",
          "bound_checkpoint.transparency_log_root",
          "rebound_checkpoint.transparency_log_root"
        ])
      : undefined
  );

  if (!checkpointHash) {
    fail(
      "Could not resolve checkpoint_hash from finalization/witnesses/rebinding manifests"
    );
  }

  if (!transparencyLogRoot) {
    fail(
      "Could not resolve transparency_log_root from finalization/witnesses/rebinding manifests"
    );
  }

  if (manifest.checkpoint_hash !== checkpointHash) {
    fail(
      `checkpoint_hash mismatch: ${manifest.checkpoint_hash} !== ${checkpointHash}`
    );
  }

  if (manifest.transparency_log_root !== transparencyLogRoot) {
    fail(
      `transparency_log_root mismatch: ${manifest.transparency_log_root} !== ${transparencyLogRoot}`
    );
  }

  const checkpointWitnessesHash = fileSha256Hex(checkpointWitnessesPath);
  const checkpointFinalizationHash = fileSha256Hex(checkpointFinalizationPath);

  if (manifest.checkpoint_witnesses_hash !== checkpointWitnessesHash) {
    fail(
      `checkpoint_witnesses_hash mismatch: ${manifest.checkpoint_witnesses_hash} !== ${checkpointWitnessesHash}`
    );
  }

  if (manifest.checkpoint_finalization_hash !== checkpointFinalizationHash) {
    fail(
      `checkpoint_finalization_hash mismatch: ${manifest.checkpoint_finalization_hash} !== ${checkpointFinalizationHash}`
    );
  }

  if (checkpointRebinding) {
    const checkpointRebindingHash = fileSha256Hex(checkpointRebindingPath);

    if (manifest.checkpoint_rebinding_hash !== checkpointRebindingHash) {
      fail(
        `checkpoint_rebinding_hash mismatch: ${manifest.checkpoint_rebinding_hash} !== ${checkpointRebindingHash}`
      );
    }

    const rebindingCheckpointHash = pickField(checkpointRebinding, [
      "checkpoint_hash",
      "checkpoint.checkpoint_hash",
      "bound_checkpoint.checkpoint_hash"
    ]);

    const rebindingTransparencyLogRoot = pickField(checkpointRebinding, [
      "transparency_log_root",
      "checkpoint.transparency_log_root",
      "bound_checkpoint.transparency_log_root"
    ]);

    if (rebindingCheckpointHash && rebindingCheckpointHash !== checkpointHash) {
      fail(
        `Rebinding checkpoint_hash mismatch: ${rebindingCheckpointHash} !== ${checkpointHash}`
      );
    }

    if (
      rebindingTransparencyLogRoot &&
      rebindingTransparencyLogRoot !== transparencyLogRoot
    ) {
      fail(
        `Rebinding transparency_log_root mismatch: ${rebindingTransparencyLogRoot} !== ${transparencyLogRoot}`
      );
    }
  }

  for (const entry of manifest.anchors) {
    validateAnchorEntry(entry);
  }

  const recomputedAnchorSetHash = sha256Hex(canonicalStringify(manifest.anchors));
  if (manifest.anchor_set_hash !== recomputedAnchorSetHash) {
    fail(
      `anchor_set_hash mismatch: ${manifest.anchor_set_hash} !== ${recomputedAnchorSetHash}`
    );
  }

  const coreManifest = {
    schema: manifest.schema,
    manifest_version: manifest.manifest_version,
    checkpoint_hash: manifest.checkpoint_hash,
    transparency_log_root: manifest.transparency_log_root,
    checkpoint_witnesses_hash: manifest.checkpoint_witnesses_hash,
    checkpoint_finalization_hash: manifest.checkpoint_finalization_hash,
    ...(manifest.checkpoint_rebinding_hash
      ? { checkpoint_rebinding_hash: manifest.checkpoint_rebinding_hash }
      : {}),
    anchor_count: manifest.anchor_count,
    anchors: manifest.anchors,
    anchor_set_hash: manifest.anchor_set_hash
  };

  const recomputedExternalAnchorHash = sha256Hex(
    canonicalStringify(coreManifest)
  );

  if (manifest.external_anchor_hash !== recomputedExternalAnchorHash) {
    fail(
      `external_anchor_hash mismatch: ${manifest.external_anchor_hash} !== ${recomputedExternalAnchorHash}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        manifest_path: manifestPath,
        checkpoint_hash: manifest.checkpoint_hash,
        transparency_log_root: manifest.transparency_log_root,
        checkpoint_witnesses_hash: manifest.checkpoint_witnesses_hash,
        checkpoint_finalization_hash: manifest.checkpoint_finalization_hash,
        ...(manifest.checkpoint_rebinding_hash
          ? { checkpoint_rebinding_hash: manifest.checkpoint_rebinding_hash }
          : {}),
        anchor_count: manifest.anchor_count,
        anchor_set_hash: manifest.anchor_set_hash,
        external_anchor_hash: manifest.external_anchor_hash
      },
      null,
      2
    )
  );
}

main();
