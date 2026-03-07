#!/usr/bin/env node

import fs from "fs";
import path from "path";
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, stringifyCanonical(value) + "\n");
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

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required string: ${label}`);
  }
  return value;
}

function getNested(obj, candidate) {
  const parts = candidate.split(".");
  let cursor = obj;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function requiredHashFromCandidates(obj, candidates, label) {
  for (const candidate of candidates) {
    const value = getNested(obj, candidate);
    if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) {
      return value;
    }
  }
  throw new Error(`Could not resolve required 64-char hex hash for ${label}`);
}

function requiredObjectFromCandidates(obj, candidates, label) {
  for (const candidate of candidates) {
    const value = getNested(obj, candidate);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  throw new Error(`Could not resolve required object for ${label}`);
}

function buildLifecycleLineageReference({
  grantId,
  issuanceArtifactPath,
  issuanceArtifact
}) {
  const sourceGrantIssuanceArtifactHash = requiredHashFromCandidates(
    issuanceArtifact,
    [
      "artifact_hash",
      "deterministic_hashes.artifact_hash"
    ],
    "source_grant_issuance_artifact_hash"
  );

  const sourceGrantIssuanceTrustChainHash = requiredHashFromCandidates(
    issuanceArtifact,
    [
      "binding.trust_chain_hash",
      "trust_chain_hash",
      "deterministic_hashes.trust_chain_hash"
    ],
    "source_grant_issuance_trust_chain_hash"
  );

  const sourceIssuanceBoundGrantHash = requiredHashFromCandidates(
    issuanceArtifact,
    [
      "binding.issuance_bound_grant_hash",
      "issuance_bound_grant_hash",
      "deterministic_hashes.issuance_bound_grant_hash"
    ],
    "source_issuance_bound_grant_hash"
  );

  const issuanceAnchorReference = requiredObjectFromCandidates(
    issuanceArtifact,
    [
      "grant.issuance_anchor_reference",
      "issuance_anchor_reference",
      "references.issuance_anchor_reference"
    ],
    "issuance_anchor_reference"
  );

  const finalizedCheckpointReference = {
    schema: issuanceAnchorReference.checkpoint_finalization_schema,
    path: issuanceAnchorReference.checkpoint_finalization_path,
    checkpoint_finalization_hash: issuanceAnchorReference.checkpoint_finalization_hash,
    finalized_checkpoint_hash: issuanceAnchorReference.finalized_checkpoint_hash
  };

  const transparencyLogRootReference = {
    transparency_log_root: issuanceAnchorReference.transparency_log_root
  };

  const baseSepoliaRootAnchorReference = issuanceAnchorReference.onchain_root_anchor;

  const referenceBase = {
    schema: "grant-audit-lifecycle-anchor-lineage-reference-v1",
    lineage_version: "1.0.0",
    grant_id: grantId,
    source_grant_issuance_path: issuanceArtifactPath,
    source_grant_issuance_artifact_hash: sourceGrantIssuanceArtifactHash,
    source_grant_issuance_trust_chain_hash: sourceGrantIssuanceTrustChainHash,
    source_issuance_bound_grant_hash: sourceIssuanceBoundGrantHash,
    issuance_anchor_reference: issuanceAnchorReference,
    finalized_checkpoint_reference: finalizedCheckpointReference,
    transparency_log_root_reference: transparencyLogRootReference,
    base_sepolia_root_anchor_reference: baseSepoliaRootAnchorReference
  };

  const lineageHash = canonicalHash(referenceBase);

  return {
    ...referenceBase,
    lineage_hash: lineageHash
  };
}

function main() {
  const args = parseArgs(process.argv);

  const issuanceArtifactPath = requiredString(
    args["issuance-artifact"] || "manifests/grants/grant-issuance.json",
    "issuance-artifact"
  );

  const outputPath = requiredString(
    args["out"] || "manifests/grants/grant-lifecycle-event.json",
    "out"
  );

  const evidencePath = requiredString(
    args["evidence-out"] || "evidence/phase-7.20/grant-lifecycle-event.json",
    "evidence-out"
  );

  const grantId = requiredString(args["grant-id"], "grant-id");
  const lifecycleEventId = requiredString(args["lifecycle-event-id"], "lifecycle-event-id");
  const eventType = requiredString(args["event-type"], "event-type");
  const recordedAt = requiredString(args["recorded-at"], "recorded-at");
  const effectiveAt = requiredString(args["effective-at"], "effective-at");
  const fromState = requiredString(args["from-state"], "from-state");
  const toState = requiredString(args["to-state"], "to-state");
  const reasonCode = requiredString(args["reason-code"], "reason-code");
  const unit = requiredString(args["unit"], "unit");
  const delta = requiredString(args["delta"], "delta");
  const currency = requiredString(args["currency"] || "USD", "currency");
  const amount = requiredString(args["amount"] || "0", "amount");
  const eventSequenceRaw = requiredString(args["event-sequence"], "event-sequence");

  const eventSequence = Number(eventSequenceRaw);
  if (!Number.isInteger(eventSequence) || eventSequence < 0) {
    throw new Error("event-sequence must be a non-negative integer");
  }

  const issuanceArtifact = readJson(issuanceArtifactPath);

  const lifecycleAnchorLineageReference = buildLifecycleLineageReference({
    grantId,
    issuanceArtifactPath,
    issuanceArtifact
  });

  const lifecycleEventBase = {
    schema: "grant-audit-grant-lifecycle-event-v1",
    event_version: "1.0.0",
    event_type: eventType,
    recorded_at: recordedAt,
    grant_id: grantId,
    lifecycle_event_id: lifecycleEventId,
    event_sequence: eventSequence,
    effective_at: effectiveAt,
    state_transition: {
      from_state: fromState,
      to_state: toState,
      reason_code: reasonCode,
      ...(args["state-notes"] ? { notes: args["state-notes"] } : {})
    },
    quantity: {
      unit,
      delta,
      ...(args["post-event-balance"] ? { post_event_balance: args["post-event-balance"] } : {})
    },
    consideration: {
      currency,
      amount,
      ...(args["price-per-unit"] ? { price_per_unit: args["price-per-unit"] } : {})
    },
    references: {
      ...(args["grant-document-uri"] ? { grant_document_uri: args["grant-document-uri"] } : {}),
      ...(args["cap-table-entry-id"] ? { cap_table_entry_id: args["cap-table-entry-id"] } : {}),
      ...(args["settlement-reference-id"] ? { settlement_reference_id: args["settlement-reference-id"] } : {}),
      ...(args["exercise-notice-id"] ? { exercise_notice_id: args["exercise-notice-id"] } : {}),
      ...(args["transfer-reference-id"] ? { transfer_reference_id: args["transfer-reference-id"] } : {}),
      ...(args["operator"] ? { operator: args["operator"] } : {}),
      ...(args["reference-notes"] ? { notes: args["reference-notes"] } : {})
    },
    lifecycle_anchor_lineage_reference: lifecycleAnchorLineageReference
  };

  const lifecycleEventHash = canonicalHash({
    schema: lifecycleEventBase.schema,
    event_version: lifecycleEventBase.event_version,
    event_type: lifecycleEventBase.event_type,
    recorded_at: lifecycleEventBase.recorded_at,
    grant_id: lifecycleEventBase.grant_id,
    lifecycle_event_id: lifecycleEventBase.lifecycle_event_id,
    event_sequence: lifecycleEventBase.event_sequence,
    effective_at: lifecycleEventBase.effective_at,
    state_transition: lifecycleEventBase.state_transition,
    quantity: lifecycleEventBase.quantity,
    consideration: lifecycleEventBase.consideration,
    references: lifecycleEventBase.references
  });

  const lifecycleLineageHash = lifecycleAnchorLineageReference.lineage_hash;

  const trustChainHash = canonicalHash({
    grant_id: grantId,
    lifecycle_event_hash: lifecycleEventHash,
    lifecycle_lineage_hash: lifecycleLineageHash,
    source_grant_issuance_artifact_hash: lifecycleAnchorLineageReference.source_grant_issuance_artifact_hash,
    source_grant_issuance_trust_chain_hash: lifecycleAnchorLineageReference.source_grant_issuance_trust_chain_hash,
    source_issuance_bound_grant_hash: lifecycleAnchorLineageReference.source_issuance_bound_grant_hash,
    issuance_anchor_reference: lifecycleAnchorLineageReference.issuance_anchor_reference,
    finalized_checkpoint_reference: lifecycleAnchorLineageReference.finalized_checkpoint_reference,
    transparency_log_root_reference: lifecycleAnchorLineageReference.transparency_log_root_reference,
    base_sepolia_root_anchor_reference: lifecycleAnchorLineageReference.base_sepolia_root_anchor_reference
  });

  const artifactBase = {
    ...lifecycleEventBase,
    deterministic_hashes: {
      lifecycle_event_hash: lifecycleEventHash,
      lifecycle_lineage_hash: lifecycleLineageHash,
      trust_chain_hash: trustChainHash
    }
  };

  const artifactHash = canonicalHash(artifactBase);

  const finalArtifact = {
    ...artifactBase,
    deterministic_hashes: {
      ...artifactBase.deterministic_hashes,
      artifact_hash: artifactHash
    }
  };

  ensureDir(path.dirname(outputPath));
  ensureDir(path.dirname(evidencePath));

  writeJson(outputPath, finalArtifact);
  writeJson(evidencePath, finalArtifact);

  process.stdout.write(
    [
      "Phase 7.20 lifecycle event artifact built successfully.",
      `output_path: ${outputPath}`,
      `evidence_path: ${evidencePath}`,
      `lifecycle_event_hash: ${lifecycleEventHash}`,
      `lifecycle_lineage_hash: ${lifecycleLineageHash}`,
      `trust_chain_hash: ${trustChainHash}`,
      `artifact_hash: ${artifactHash}`
    ].join("\n") + "\n"
  );
}

main();
