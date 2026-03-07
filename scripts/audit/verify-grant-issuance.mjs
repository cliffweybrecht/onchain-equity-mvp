#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getAtPath(obj, dottedPath) {
  const segments = dottedPath.split(".");
  let current = obj;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function pickFirst(obj, paths) {
  for (const candidate of paths) {
    const value = getAtPath(obj, candidate);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function normalizePathForRepo(filePath) {
  return path.relative(process.cwd(), path.resolve(filePath)).split(path.sep).join("/");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

function extractTrustInputs(issuanceAnchor, checkpointFinalization) {
  const issuanceAnchorSchema = pickFirst(issuanceAnchor, [
    "schema"
  ]);

  const checkpointFinalizationSchema = pickFirst(checkpointFinalization, [
    "schema"
  ]);

  const finalizedCheckpointHash = pickFirst(issuanceAnchor, [
    "audit_chain.finalized_checkpoint_hash",
    "checkpoint_reference.checkpoint_hash"
  ]);

  const transparencyLogRoot = pickFirst(issuanceAnchor, [
    "audit_chain.transparency_log_root",
    "checkpoint_reference.log_root"
  ]);

  assert(typeof finalizedCheckpointHash === "string", "Missing finalized checkpoint hash");
  assert(typeof transparencyLogRoot === "string", "Missing transparency log root");

  const chainId = pickFirst(issuanceAnchor, [
    "audit_chain.onchain_root_anchor.chain_id",
    "checkpoint_reference.root_anchor.chain_id"
  ]);

  const blockNumber = pickFirst(issuanceAnchor, [
    "audit_chain.onchain_root_anchor.block_number",
    "checkpoint_reference.root_anchor.block_number"
  ]);

  const txHash = pickFirst(issuanceAnchor, [
    "audit_chain.onchain_root_anchor.tx_hash",
    "checkpoint_reference.root_anchor.tx_hash"
  ]);

  assert(chainId !== undefined, "Missing chain_id");
  assert(blockNumber !== undefined, "Missing block_number");
  assert(typeof txHash === "string", "Missing tx_hash");

  const onchainRootAnchor = {
    chain_id: String(chainId),
    block_number: String(blockNumber),
    tx_hash: txHash
  };

  return {
    issuance_anchor_schema: issuanceAnchorSchema,
    checkpoint_finalization_schema: checkpointFinalizationSchema,
    finalized_checkpoint_hash: finalizedCheckpointHash,
    transparency_log_root: transparencyLogRoot,
    onchain_root_anchor: onchainRootAnchor
  };
}

function validateArtifactShape(artifact) {

  assert(artifact.schema === "grant-audit-grant-issuance-v1", "Invalid artifact schema");
  assert(artifact.artifact_version === "1.0.0", "Invalid artifact version");

  const grant = artifact.grant;

  assert(grant.schema === "grant-audit-issuance-bound-grant-v1", "Invalid grant schema");

  const ref = grant.issuance_anchor_reference;

  assert(ref.schema === "grant-audit-transparency-issuance-anchor-reference-v1", "Invalid anchor reference schema");

  const rootAnchor = ref.onchain_root_anchor;

  assert(rootAnchor, "Missing root anchor");

  assert(rootAnchor.chain_id !== undefined, "Missing chain_id");

  assert(rootAnchor.block_number !== undefined, "Missing block_number");

  assert(typeof rootAnchor.tx_hash === "string", "Invalid tx_hash");

}

async function main() {

  const args = parseArgs(process.argv.slice(2));

  const artifactPath = args.artifact || "manifests/grants/grant-issuance.json";

  const artifact = readJson(artifactPath);

  validateArtifactShape(artifact);

  const issuanceAnchorPath =
    artifact.grant.issuance_anchor_reference.issuance_anchor_path;

  const checkpointFinalizationPath =
    artifact.grant.issuance_anchor_reference.checkpoint_finalization_path;

  const issuanceAnchor = readJson(issuanceAnchorPath);
  const checkpointFinalization = readJson(checkpointFinalizationPath);

  const trustInputs =
    extractTrustInputs(issuanceAnchor, checkpointFinalization);

  const issuanceAnchorHash =
    sha256Json(issuanceAnchor);

  const checkpointFinalizationHash =
    sha256Json(checkpointFinalization);

  const expectedReference = {
    schema: "grant-audit-transparency-issuance-anchor-reference-v1",
    reference_version: "1.0.0",
    issuance_anchor_path: normalizePathForRepo(issuanceAnchorPath),
    issuance_anchor_schema: trustInputs.issuance_anchor_schema,
    issuance_anchor_hash: issuanceAnchorHash,
    checkpoint_finalization_path: normalizePathForRepo(checkpointFinalizationPath),
    checkpoint_finalization_schema: trustInputs.checkpoint_finalization_schema,
    checkpoint_finalization_hash: checkpointFinalizationHash,
    finalized_checkpoint_hash: trustInputs.finalized_checkpoint_hash,
    transparency_log_root: trustInputs.transparency_log_root,
    onchain_root_anchor: trustInputs.onchain_root_anchor
  };

  assert(
    stableStringify(artifact.grant.issuance_anchor_reference) ===
      stableStringify(expectedReference),
    "Issuance anchor reference mismatch"
  );

  const expectedGrantHash =
    sha256Json(artifact.grant);

  const expectedReferenceHash =
    sha256Json(artifact.grant.issuance_anchor_reference);

  const expectedBinding = {
    binding_scope: "grant-issuance",
    binding_version: "1.0.0",
    issuance_bound_grant_hash: expectedGrantHash,
    issuance_anchor_reference_hash: expectedReferenceHash,
    checkpoint_finalization_hash: checkpointFinalizationHash,
    finalized_checkpoint_hash: trustInputs.finalized_checkpoint_hash,
    transparency_log_root: trustInputs.transparency_log_root,
    onchain_root_anchor: trustInputs.onchain_root_anchor,
    trust_chain_hash: sha256Json({
      issuance_bound_grant_hash: expectedGrantHash,
      issuance_anchor_reference_hash: expectedReferenceHash,
      checkpoint_finalization_hash: checkpointFinalizationHash,
      finalized_checkpoint_hash: trustInputs.finalized_checkpoint_hash,
      transparency_log_root: trustInputs.transparency_log_root,
      onchain_root_anchor: trustInputs.onchain_root_anchor
    })
  };

  assert(
    stableStringify(artifact.binding) ===
      stableStringify(expectedBinding),
    "Binding mismatch"
  );

  const artifactCore = {
    schema: artifact.schema,
    artifact_version: artifact.artifact_version,
    created_at: artifact.created_at,
    grant: artifact.grant,
    binding: artifact.binding
  };

  const expectedArtifactHash =
    sha256Json(artifactCore);

  assert(
    expectedArtifactHash === artifact.artifact_hash,
    "artifact_hash mismatch"
  );

  const result = {
    ok: true,
    phase: "7.19",
    artifact_path: normalizePathForRepo(artifactPath),
    grant_id: artifact.grant.grant_id,
    issuance_bound_grant_hash: artifact.binding.issuance_bound_grant_hash,
    trust_chain_hash: artifact.binding.trust_chain_hash,
    artifact_hash: artifact.artifact_hash
  };

  process.stdout.write(
    JSON.stringify(result, null, 2) + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(error.stack + "\n");
  process.exit(1);
});
