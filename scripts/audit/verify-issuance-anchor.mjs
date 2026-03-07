#!/usr/bin/env node
import { readFile } from "node:fs/promises";
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
  node scripts/audit/verify-issuance-anchor.mjs \\
    --anchor manifests/transparency/issuance-anchor.json \\
    --target <path> \\
    [--checkpoint-finalization manifests/transparency/checkpoint-finalization.json]
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

function normalizeHex64(value, fieldName) {
  assert(typeof value === "string", `${fieldName} must be a string`);
  assert(/^[a-f0-9]{64}$/i.test(value), `${fieldName} must be a 64-char hex string`);
  return value.toLowerCase();
}

function normalizeTxHash(value, fieldName) {
  assert(typeof value === "string", `${fieldName} must be a string`);
  assert(/^0x[a-fA-F0-9]{64}$/.test(value), `${fieldName} must be a 0x-prefixed 32-byte hash`);
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
    (typeof threshold === "number" || (typeof threshold === "string" && /^[0-9]+$/.test(threshold))) &&
    (typeof verifiedWitnessCount === "number" || (typeof verifiedWitnessCount === "string" && /^[0-9]+$/.test(verifiedWitnessCount)))
  ) {
    return Number(verifiedWitnessCount) >= Number(threshold);
  }

  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.anchor || !args.target) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const anchorPath = args.anchor;
  const targetPath = args.target;
  const checkpointFinalizationPath =
    args["checkpoint-finalization"] || "manifests/transparency/checkpoint-finalization.json";

  const [anchorJson, targetJson, checkpointFinalizationJson] = await Promise.all([
    readJson(anchorPath),
    readJson(targetPath),
    readJson(checkpointFinalizationPath)
  ]);

  assert(
    anchorJson.schema === "grant-audit-transparency-issuance-anchor-v1",
    "anchor schema mismatch"
  );
  assert(anchorJson.anchor_version === "1.0.0", "anchor_version mismatch");
  assert(anchorJson.anchor_kind === "issuance-checkpoint-anchor", "anchor_kind mismatch");

  const targetHash = sha256Hex(stableStringify(targetJson));
  const finalizationArtifactHash = sha256Hex(stableStringify(checkpointFinalizationJson));

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

  const finalizedAt = firstDefined(checkpointFinalizationJson, ["finalized_at"]);
  assert(typeof finalizedAt === "string", "missing finalized_at in checkpoint finalization artifact");

  const finalizationStatus = deriveFinalizationStatus(checkpointFinalizationJson);
  assert(finalizationStatus === "finalized", "checkpoint finalization artifact is not finalized");

  const quorumMet = deriveQuorumMet(checkpointFinalizationJson);
  assert(quorumMet === true, "checkpoint finalization artifact quorum not satisfied");

  const rootAnchorChainId =
    firstDefined(checkpointFinalizationJson, [
      "root_anchor.chain_id",
      "checkpoint.root_anchor.chain_id",
      "onchain_anchor.chain_id"
    ]) ??
    firstDefined(anchorJson, [
      "checkpoint_reference.root_anchor.chain_id",
      "audit_chain.onchain_root_anchor.chain_id"
    ]);

  const rootAnchorBlockNumber =
    firstDefined(checkpointFinalizationJson, [
      "root_anchor.block_number",
      "checkpoint.root_anchor.block_number",
      "onchain_anchor.block_number"
    ]) ??
    firstDefined(anchorJson, [
      "checkpoint_reference.root_anchor.block_number",
      "audit_chain.onchain_root_anchor.block_number"
    ]);

  const rootAnchorTxHashRaw =
    firstDefined(checkpointFinalizationJson, [
      "root_anchor.tx_hash",
      "checkpoint.root_anchor.tx_hash",
      "onchain_anchor.tx_hash"
    ]) ??
    firstDefined(anchorJson, [
      "checkpoint_reference.root_anchor.tx_hash",
      "audit_chain.onchain_root_anchor.tx_hash"
    ]);

  assert(rootAnchorChainId !== undefined, "missing root_anchor.chain_id");
  assert(rootAnchorBlockNumber !== undefined, "missing root_anchor.block_number");
  assert(typeof rootAnchorTxHashRaw === "string", "missing root_anchor.tx_hash");

  const rootAnchorTxHash = normalizeTxHash(rootAnchorTxHashRaw, "root_anchor.tx_hash");

  assert(
    anchorJson.anchored_artifact.artifact_path === targetPath,
    "anchored artifact path mismatch"
  );
  assert(
    anchorJson.anchored_artifact.artifact_hash === targetHash,
    "anchored artifact hash mismatch"
  );

  const expectedDeterministicId = sha256Hex(
    stableStringify({
      artifact_hash: targetHash,
      checkpoint_hash: checkpointHash,
      finalization_artifact_hash: finalizationArtifactHash
    })
  );

  assert(
    anchorJson.anchor_deterministic_id === expectedDeterministicId,
    "anchor_deterministic_id mismatch"
  );

  assert(anchorJson.anchored_at === finalizedAt, "anchored_at must equal finalized_at");

  const checkpointReference = anchorJson.checkpoint_reference;
  assert(
    checkpointReference.schema === "grant-audit-transparency-issuance-checkpoint-reference-v1",
    "checkpoint reference schema mismatch"
  );
  assert(
    checkpointReference.reference_version === "1.0.0",
    "checkpoint reference version mismatch"
  );
  assert(
    checkpointReference.finalization_artifact_path === checkpointFinalizationPath,
    "finalization artifact path mismatch"
  );
  assert(
    checkpointReference.finalization_artifact_hash === finalizationArtifactHash,
    "finalization artifact hash mismatch"
  );
  assert(
    checkpointReference.finalized_at === finalizedAt,
    "checkpoint reference finalized_at mismatch"
  );
  assert(
    checkpointReference.finalization_status === "finalized",
    "checkpoint reference finalization_status mismatch"
  );
  assert(
    checkpointReference.quorum_met === true,
    "checkpoint reference quorum_met mismatch"
  );
  assert(
    checkpointReference.checkpoint_hash === checkpointHash,
    "checkpoint reference checkpoint_hash mismatch"
  );
  assert(
    checkpointReference.checkpoint_root === checkpointRoot,
    "checkpoint reference checkpoint_root mismatch"
  );
  assert(
    checkpointReference.log_root === logRoot,
    "checkpoint reference log_root mismatch"
  );
  assert(
    checkpointReference.root_anchor.tx_hash === rootAnchorTxHash,
    "checkpoint reference root anchor tx hash mismatch"
  );
  assert(
    String(checkpointReference.root_anchor.chain_id) === String(rootAnchorChainId),
    "checkpoint reference root anchor chain id mismatch"
  );
  assert(
    String(checkpointReference.root_anchor.block_number) === String(rootAnchorBlockNumber),
    "checkpoint reference root anchor block number mismatch"
  );

  assert(
    anchorJson.audit_chain.equity_artifact_hash === targetHash,
    "audit_chain equity_artifact_hash mismatch"
  );
  assert(
    anchorJson.audit_chain.finalized_checkpoint_hash === checkpointHash,
    "audit_chain finalized_checkpoint_hash mismatch"
  );
  assert(
    anchorJson.audit_chain.transparency_log_root === logRoot,
    "audit_chain transparency_log_root mismatch"
  );
  assert(
    anchorJson.audit_chain.onchain_root_anchor.tx_hash === rootAnchorTxHash,
    "audit_chain onchain root tx hash mismatch"
  );
  assert(
    String(anchorJson.audit_chain.onchain_root_anchor.chain_id) === String(rootAnchorChainId),
    "audit_chain onchain root chain id mismatch"
  );
  assert(
    String(anchorJson.audit_chain.onchain_root_anchor.block_number) === String(rootAnchorBlockNumber),
    "audit_chain onchain root block number mismatch"
  );

  const anchorBase = { ...anchorJson };
  delete anchorBase.anchor_hash;
  const expectedAnchorHash = sha256Hex(stableStringify(anchorBase));

  assert(anchorJson.anchor_hash === expectedAnchorHash, "anchor_hash mismatch");

  console.log(
    JSON.stringify(
      {
        ok: true,
        anchor_path: anchorPath,
        target_path: targetPath,
        checkpoint_finalization_path: checkpointFinalizationPath,
        target_hash: targetHash,
        checkpoint_hash: checkpointHash,
        checkpoint_root: checkpointRoot,
        log_root: logRoot,
        root_anchor_tx_hash: rootAnchorTxHash,
        anchor_hash: expectedAnchorHash,
        anchor_deterministic_id: expectedDeterministicId
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
