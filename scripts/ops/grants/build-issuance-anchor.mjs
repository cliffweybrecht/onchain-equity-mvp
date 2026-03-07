#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function usage() {
  console.error(`
Usage:
  node scripts/ops/grants/build-issuance-anchor.mjs \\
    --target <path> \\
    --artifact-type <type> \\
    [--artifact-schema <schema>] \\
    [--issuance-id <id>] \\
    [--grant-id <id>] \\
    [--checkpoint-finalization manifests/transparency/checkpoint-finalization.json] \\
    [--root-anchor-chain-id <id>] \\
    [--root-anchor-block-number <num>] \\
    [--root-anchor-tx-hash <0x...>] \\
    [--output manifests/transparency/issuance-anchor.json]
`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function getByPath(obj, dottedPath) {
  return dottedPath.split(".").reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

function firstDefined(obj, candidates) {
  for (const candidate of candidates) {
    const value = getByPath(obj, candidate);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function normalizeInteger(value, fieldName) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number(value);
  throw new Error(`Invalid integer value for ${fieldName}`);
}

function normalizeHex64(value, fieldName) {
  assert(typeof value === "string", `${fieldName} must be a string`);
  assert(/^[a-f0-9]{64}$/i.test(value), `${fieldName} must be a 64-char hex string`);
  return value.toLowerCase();
}

function normalizeTxHash(value, fieldName) {
  assert(typeof value === "string", `${fieldName} must be a string`);
  assert(/^0x[a-fA-F0-9]{64}$/.test(value), `${fieldName} must be a 0x-prefixed 32-byte tx hash`);
  return value;
}

function deriveFinalizationStatus(finalizationJson) {
  const quorumSatisfied = firstDefined(finalizationJson, [
    "quorum_status.satisfied",
    "quorum_status.finalized",
    "quorum_met",
    "quorum.satisfied"
  ]);

  const finalizedAt = firstDefined(finalizationJson, ["finalized_at"]);
  const checkpointHash = firstDefined(finalizationJson, ["checkpoint.checkpoint_hash"]);
  const logRoot = firstDefined(finalizationJson, ["checkpoint.log_root"]);
  const cumulativeRoot = firstDefined(finalizationJson, ["checkpoint.cumulative_root"]);

  if (
    quorumSatisfied === true &&
    typeof finalizedAt === "string" &&
    finalizedAt.length > 0 &&
    typeof checkpointHash === "string" &&
    typeof logRoot === "string" &&
    typeof cumulativeRoot === "string"
  ) {
    return "finalized";
  }

  return "unfinalized";
}

function deriveQuorumMet(finalizationJson) {
  const explicitQuorum = firstDefined(finalizationJson, [
    "quorum_status.satisfied",
    "quorum_met",
    "quorum.satisfied"
  ]);

  if (typeof explicitQuorum === "boolean") {
    return explicitQuorum;
  }

  const threshold = firstDefined(finalizationJson, [
    "finalization_policy.threshold",
    "threshold",
    "quorum.threshold"
  ]);

  const verifiedWitnessCount = firstDefined(finalizationJson, [
    "quorum_status.verified_witness_count",
    "witness_count"
  ]);

  if (
    (typeof threshold === "number" ||
      (typeof threshold === "string" && /^[0-9]+$/.test(threshold))) &&
    (typeof verifiedWitnessCount === "number" ||
      (typeof verifiedWitnessCount === "string" && /^[0-9]+$/.test(verifiedWitnessCount)))
  ) {
    return Number(verifiedWitnessCount) >= Number(threshold);
  }

  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.target || !args["artifact-type"]) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const targetPath = args.target;
  const artifactType = args["artifact-type"];
  const artifactSchema = args["artifact-schema"];
  const issuanceId = args["issuance-id"];
  const grantId = args["grant-id"];
  const checkpointFinalizationPath =
    args["checkpoint-finalization"] || "manifests/transparency/checkpoint-finalization.json";
  const outputPath = args.output || "manifests/transparency/issuance-anchor.json";

  const [targetJson, checkpointFinalizationJson] = await Promise.all([
    readJson(targetPath),
    readJson(checkpointFinalizationPath)
  ]);

  const targetHash = sha256Hex(stableStringify(targetJson));
  const finalizationArtifactHash = sha256Hex(stableStringify(checkpointFinalizationJson));

  const finalizationSchema =
    firstDefined(checkpointFinalizationJson, ["schema"]) ||
    "grant-audit-transparency-checkpoint-finalization-v1";

  const finalizedAt = firstDefined(checkpointFinalizationJson, ["finalized_at"]);
  assert(typeof finalizedAt === "string", "checkpoint finalization artifact missing finalized_at");

  const finalizationStatus = deriveFinalizationStatus(checkpointFinalizationJson);
  assert(finalizationStatus === "finalized", "checkpoint finalization artifact is not finalized");

  const quorumMet = deriveQuorumMet(checkpointFinalizationJson);
  assert(quorumMet === true, "checkpoint finalization artifact did not satisfy quorum");

  const threshold = normalizeInteger(
    firstDefined(checkpointFinalizationJson, ["finalization_policy.threshold"]),
    "threshold"
  );

  const witnessCount = normalizeInteger(
    firstDefined(checkpointFinalizationJson, [
      "quorum_status.verified_witness_count"
    ]) ??
      (Array.isArray(checkpointFinalizationJson.verified_witnesses)
        ? checkpointFinalizationJson.verified_witnesses.length
        : 0),
    "witness_count"
  );

  const checkpointSchema = "grant-audit-transparency-log-checkpoint-v1";

  const checkpointHash = normalizeHex64(
    firstDefined(checkpointFinalizationJson, ["checkpoint.checkpoint_hash"]),
    "checkpoint_hash"
  );

  const checkpointRoot = normalizeHex64(
    firstDefined(checkpointFinalizationJson, ["checkpoint.cumulative_root"]),
    "checkpoint_root"
  );

  const logRoot = normalizeHex64(
    firstDefined(checkpointFinalizationJson, ["checkpoint.log_root"]),
    "log_root"
  );

  const entryCount = normalizeInteger(
    firstDefined(checkpointFinalizationJson, ["checkpoint.entry_count"]),
    "entry_count"
  );

  const rootAnchorChainId =
    args["root-anchor-chain-id"] ??
    firstDefined(checkpointFinalizationJson, [
      "root_anchor.chain_id",
      "checkpoint.root_anchor.chain_id",
      "onchain_anchor.chain_id"
    ]);

  const rootAnchorBlockNumber =
    args["root-anchor-block-number"] ??
    firstDefined(checkpointFinalizationJson, [
      "root_anchor.block_number",
      "checkpoint.root_anchor.block_number",
      "onchain_anchor.block_number"
    ]);

  const rootAnchorTxHash =
    args["root-anchor-tx-hash"] ??
    firstDefined(checkpointFinalizationJson, [
      "root_anchor.tx_hash",
      "checkpoint.root_anchor.tx_hash",
      "onchain_anchor.tx_hash"
    ]);

  assert(rootAnchorChainId !== undefined, "missing root_anchor.chain_id");
  assert(rootAnchorBlockNumber !== undefined, "missing root_anchor.block_number");
  assert(typeof rootAnchorTxHash === "string", "missing root_anchor.tx_hash");

  const normalizedRootAnchorTxHash = normalizeTxHash(rootAnchorTxHash, "root_anchor.tx_hash");

  const checkpointReference = {
    schema: "grant-audit-transparency-issuance-checkpoint-reference-v1",
    reference_version: "1.0.0",
    finalization_artifact_path: checkpointFinalizationPath,
    finalization_artifact_hash: finalizationArtifactHash,
    finalization_schema: finalizationSchema,
    finalized_at: finalizedAt,
    finalization_status: "finalized",
    quorum_met: true,
    threshold,
    witness_count: witnessCount,
    checkpoint_schema: checkpointSchema,
    checkpoint_hash: checkpointHash,
    checkpoint_root: checkpointRoot,
    log_root: logRoot,
    entry_count: entryCount,
    root_anchor: {
      chain_id: rootAnchorChainId,
      block_number: rootAnchorBlockNumber,
      tx_hash: normalizedRootAnchorTxHash
    }
  };

  const anchoredArtifact = {
    artifact_path: targetPath,
    artifact_type: artifactType,
    artifact_hash: targetHash
  };

  if (artifactSchema) {
    anchoredArtifact.artifact_schema = artifactSchema;
  }

  if (issuanceId) {
    anchoredArtifact.issuance_id = issuanceId;
  }

  if (grantId) {
    anchoredArtifact.grant_id = grantId;
  }

  const anchorDeterministicId = sha256Hex(
    stableStringify({
      artifact_hash: targetHash,
      checkpoint_hash: checkpointHash,
      finalization_artifact_hash: finalizationArtifactHash
    })
  );

  const anchorArtifactBase = {
    schema: "grant-audit-transparency-issuance-anchor-v1",
    anchor_version: "1.0.0",
    anchor_kind: "issuance-checkpoint-anchor",
    anchor_deterministic_id: anchorDeterministicId,
    anchored_at: finalizedAt,
    anchored_artifact: anchoredArtifact,
    checkpoint_reference: checkpointReference,
    audit_chain: {
      equity_artifact_hash: targetHash,
      finalized_checkpoint_hash: checkpointHash,
      transparency_log_root: logRoot,
      onchain_root_anchor: {
        chain_id: rootAnchorChainId,
        block_number: rootAnchorBlockNumber,
        tx_hash: normalizedRootAnchorTxHash
      }
    }
  };

  const anchorHash = sha256Hex(stableStringify(anchorArtifactBase));
  const anchorArtifact = {
    ...anchorArtifactBase,
    anchor_hash: anchorHash
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(anchorArtifact, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: outputPath,
        anchor_hash: anchorHash,
        anchor_deterministic_id: anchorDeterministicId,
        anchored_artifact_path: targetPath,
        anchored_artifact_hash: targetHash,
        checkpoint_finalization_path: checkpointFinalizationPath,
        checkpoint_finalization_hash: finalizationArtifactHash,
        checkpoint_hash: checkpointHash,
        checkpoint_root: checkpointRoot,
        log_root: logRoot,
        root_anchor_tx_hash: normalizedRootAnchorTxHash
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
