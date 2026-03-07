#!/usr/bin/env node

import fs from "fs";
import crypto from "crypto";

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function deepSort(value) {
  if (Array.isArray(value)) {
    return value.map(deepSort);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = deepSort(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stringifyCanonical(value) {
  return JSON.stringify(deepSort(value), null, 2);
}

function canonicalHash(value) {
  return sha256Hex(stringifyCanonical(value));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const args = parseArgs(process.argv);

  const artifactPath = args["artifact"] || "manifests/grants/grant-lifecycle-event.json";
  const issuanceArtifactPath = args["issuance-artifact"] || "manifests/grants/grant-issuance.json";

  const artifact = readJson(artifactPath);
  const issuanceArtifact = readJson(issuanceArtifactPath);

  assert(
    artifact.schema === "grant-audit-grant-lifecycle-event-v1",
    "Invalid lifecycle event artifact schema"
  );

  assert(
    artifact.lifecycle_anchor_lineage_reference &&
      artifact.lifecycle_anchor_lineage_reference.schema ===
        "grant-audit-lifecycle-anchor-lineage-reference-v1",
    "Invalid lifecycle anchor lineage reference schema"
  );

  const lineageReference = artifact.lifecycle_anchor_lineage_reference;

  const recomputedLineageHash = canonicalHash({
    schema: lineageReference.schema,
    lineage_version: lineageReference.lineage_version,
    grant_id: lineageReference.grant_id,
    source_grant_issuance_path: lineageReference.source_grant_issuance_path,
    source_grant_issuance_artifact_hash: lineageReference.source_grant_issuance_artifact_hash,
    source_grant_issuance_trust_chain_hash: lineageReference.source_grant_issuance_trust_chain_hash,
    source_issuance_bound_grant_hash: lineageReference.source_issuance_bound_grant_hash,
    issuance_anchor_reference: lineageReference.issuance_anchor_reference,
    finalized_checkpoint_reference: lineageReference.finalized_checkpoint_reference,
    transparency_log_root_reference: lineageReference.transparency_log_root_reference,
    base_sepolia_root_anchor_reference: lineageReference.base_sepolia_root_anchor_reference
  });

  assert(
    recomputedLineageHash === lineageReference.lineage_hash,
    "Lifecycle lineage hash mismatch"
  );

  const issuanceArtifactHash =
    issuanceArtifact?.artifact_hash ||
    issuanceArtifact?.deterministic_hashes?.artifact_hash;

  const issuanceTrustChainHash =
    issuanceArtifact?.binding?.trust_chain_hash ||
    issuanceArtifact?.trust_chain_hash ||
    issuanceArtifact?.deterministic_hashes?.trust_chain_hash;

  const issuanceBoundGrantHash =
    issuanceArtifact?.binding?.issuance_bound_grant_hash ||
    issuanceArtifact?.issuance_bound_grant_hash ||
    issuanceArtifact?.deterministic_hashes?.issuance_bound_grant_hash;

  assert(
    lineageReference.source_grant_issuance_artifact_hash === issuanceArtifactHash,
    "Source grant issuance artifact hash mismatch"
  );

  assert(
    lineageReference.source_grant_issuance_trust_chain_hash === issuanceTrustChainHash,
    "Source grant issuance trust chain hash mismatch"
  );

  assert(
    lineageReference.source_issuance_bound_grant_hash === issuanceBoundGrantHash,
    "Source issuance bound grant hash mismatch"
  );

  const expectedIssuanceAnchorReference =
    issuanceArtifact?.grant?.issuance_anchor_reference ||
    issuanceArtifact?.issuance_anchor_reference ||
    issuanceArtifact?.references?.issuance_anchor_reference;

  assert(
    stringifyCanonical(lineageReference.issuance_anchor_reference) ===
      stringifyCanonical(expectedIssuanceAnchorReference),
    "Issuance anchor reference mismatch"
  );

  const expectedFinalizedCheckpointReference = {
    schema: expectedIssuanceAnchorReference.checkpoint_finalization_schema,
    path: expectedIssuanceAnchorReference.checkpoint_finalization_path,
    checkpoint_finalization_hash: expectedIssuanceAnchorReference.checkpoint_finalization_hash,
    finalized_checkpoint_hash: expectedIssuanceAnchorReference.finalized_checkpoint_hash
  };

  assert(
    stringifyCanonical(lineageReference.finalized_checkpoint_reference) ===
      stringifyCanonical(expectedFinalizedCheckpointReference),
    "Finalized checkpoint reference mismatch"
  );

  const expectedTransparencyLogRootReference = {
    transparency_log_root: expectedIssuanceAnchorReference.transparency_log_root
  };

  assert(
    stringifyCanonical(lineageReference.transparency_log_root_reference) ===
      stringifyCanonical(expectedTransparencyLogRootReference),
    "Transparency log root reference mismatch"
  );

  const expectedBaseSepoliaRootAnchorReference =
    expectedIssuanceAnchorReference.onchain_root_anchor;

  assert(
    stringifyCanonical(lineageReference.base_sepolia_root_anchor_reference) ===
      stringifyCanonical(expectedBaseSepoliaRootAnchorReference),
    "Base Sepolia root anchor reference mismatch"
  );

  const recomputedLifecycleEventHash = canonicalHash({
    schema: artifact.schema,
    event_version: artifact.event_version,
    event_type: artifact.event_type,
    recorded_at: artifact.recorded_at,
    grant_id: artifact.grant_id,
    lifecycle_event_id: artifact.lifecycle_event_id,
    event_sequence: artifact.event_sequence,
    effective_at: artifact.effective_at,
    state_transition: artifact.state_transition,
    quantity: artifact.quantity,
    consideration: artifact.consideration,
    references: artifact.references
  });

  assert(
    recomputedLifecycleEventHash === artifact.deterministic_hashes.lifecycle_event_hash,
    "Lifecycle event hash mismatch"
  );

  assert(
    artifact.deterministic_hashes.lifecycle_lineage_hash === lineageReference.lineage_hash,
    "Lifecycle lineage hash reference mismatch"
  );

  const recomputedTrustChainHash = canonicalHash({
    grant_id: artifact.grant_id,
    lifecycle_event_hash: artifact.deterministic_hashes.lifecycle_event_hash,
    lifecycle_lineage_hash: artifact.deterministic_hashes.lifecycle_lineage_hash,
    source_grant_issuance_artifact_hash: lineageReference.source_grant_issuance_artifact_hash,
    source_grant_issuance_trust_chain_hash: lineageReference.source_grant_issuance_trust_chain_hash,
    source_issuance_bound_grant_hash: lineageReference.source_issuance_bound_grant_hash,
    issuance_anchor_reference: lineageReference.issuance_anchor_reference,
    finalized_checkpoint_reference: lineageReference.finalized_checkpoint_reference,
    transparency_log_root_reference: lineageReference.transparency_log_root_reference,
    base_sepolia_root_anchor_reference: lineageReference.base_sepolia_root_anchor_reference
  });

  assert(
    recomputedTrustChainHash === artifact.deterministic_hashes.trust_chain_hash,
    "Trust chain hash mismatch"
  );

  const recomputedArtifactHash = canonicalHash({
    schema: artifact.schema,
    event_version: artifact.event_version,
    event_type: artifact.event_type,
    recorded_at: artifact.recorded_at,
    grant_id: artifact.grant_id,
    lifecycle_event_id: artifact.lifecycle_event_id,
    event_sequence: artifact.event_sequence,
    effective_at: artifact.effective_at,
    state_transition: artifact.state_transition,
    quantity: artifact.quantity,
    consideration: artifact.consideration,
    references: artifact.references,
    lifecycle_anchor_lineage_reference: artifact.lifecycle_anchor_lineage_reference,
    deterministic_hashes: {
      lifecycle_event_hash: artifact.deterministic_hashes.lifecycle_event_hash,
      lifecycle_lineage_hash: artifact.deterministic_hashes.lifecycle_lineage_hash,
      trust_chain_hash: artifact.deterministic_hashes.trust_chain_hash
    }
  });

  assert(
    recomputedArtifactHash === artifact.deterministic_hashes.artifact_hash,
    "Artifact hash mismatch"
  );

  process.stdout.write(
    [
      "Phase 7.20 lifecycle event artifact verified successfully.",
      `artifact_path: ${artifactPath}`,
      `issuance_artifact_path: ${issuanceArtifactPath}`,
      `lifecycle_event_hash: ${artifact.deterministic_hashes.lifecycle_event_hash}`,
      `lifecycle_lineage_hash: ${artifact.deterministic_hashes.lifecycle_lineage_hash}`,
      `trust_chain_hash: ${artifact.deterministic_hashes.trust_chain_hash}`,
      `artifact_hash: ${artifact.deterministic_hashes.artifact_hash}`
    ].join("\n") + "\n"
  );
}

main();
