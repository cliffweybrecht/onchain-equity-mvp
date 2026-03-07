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

function writeCanonicalJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${stableStringify(value)}\n`);
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

function normalizeDecimalString(raw) {
  assert(typeof raw === "string" && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(raw), `Invalid decimal string: ${raw}`);

  let sign = "";
  let value = raw;

  if (value.startsWith("-")) {
    sign = "-";
    value = value.slice(1);
  }

  let [intPart, fracPart = ""] = value.split(".");
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "") intPart = "0";

  fracPart = fracPart.replace(/0+$/, "");

  if (fracPart.length === 0) {
    return `${sign}${intPart}`;
  }

  return `${sign}${intPart}.${fracPart}`;
}

function extractTrustInputs(issuanceAnchor, checkpointFinalization) {
  const issuanceAnchorSchema = pickFirst(issuanceAnchor, [
    "schema"
  ]);

  const checkpointFinalizationSchema = pickFirst(checkpointFinalization, [
    "schema"
  ]);

  const finalizedCheckpointHashFromAnchor = pickFirst(issuanceAnchor, [
    "audit_chain.finalized_checkpoint_hash",
    "checkpoint_reference.finalized_checkpoint_hash",
    "checkpoint_reference.checkpoint_hash",
    "finalized_checkpoint_hash",
    "issuance_checkpoint_reference.finalized_checkpoint_hash",
    "issuance_checkpoint_reference.checkpoint_hash",
    "checkpoint_hash"
  ]);

  const finalizedCheckpointHashFromFinalization = pickFirst(checkpointFinalization, [
    "finalized_checkpoint_hash",
    "checkpoint_hash",
    "finalization.finalized_checkpoint_hash",
    "checkpoint.finalized_checkpoint_hash",
    "checkpoint.reference.checkpoint_hash"
  ]);

  const finalizedCheckpointHash = finalizedCheckpointHashFromAnchor || finalizedCheckpointHashFromFinalization;

  assert(typeof issuanceAnchorSchema === "string" && issuanceAnchorSchema.length > 0, "Could not extract issuance anchor schema.");
  assert(typeof checkpointFinalizationSchema === "string" && checkpointFinalizationSchema.length > 0, "Could not extract checkpoint finalization schema.");
  assert(typeof finalizedCheckpointHash === "string" && /^[a-f0-9]{64}$/.test(finalizedCheckpointHash), "Could not extract finalized checkpoint hash.");

  if (finalizedCheckpointHashFromAnchor && finalizedCheckpointHashFromFinalization) {
    assert(
      finalizedCheckpointHashFromAnchor === finalizedCheckpointHashFromFinalization,
      "Issuance anchor finalized checkpoint hash does not match checkpoint finalization artifact."
    );
  }

  const transparencyLogRoot = pickFirst(issuanceAnchor, [
    "audit_chain.transparency_log_root",
    "checkpoint_reference.transparency_log_root",
    "checkpoint_reference.log_root",
    "transparency_log_root",
    "log_root",
    "checkpoint_reference.root"
  ]) || pickFirst(checkpointFinalization, [
    "transparency_log_root",
    "log_root",
    "checkpoint.transparency_log_root"
  ]);

  assert(
    typeof transparencyLogRoot === "string" && /^[a-f0-9]{64}$/.test(transparencyLogRoot),
    "Could not extract transparency log root."
  );

  const network = pickFirst(issuanceAnchor, [
    "audit_chain.onchain_root_anchor.network",
    "checkpoint_reference.root_anchor.network",
    "onchain_root_anchor.network",
    "root_anchor.network",
    "base_sepolia_anchor.network",
    "network"
  ]);

  const chainIdRaw = pickFirst(issuanceAnchor, [
    "audit_chain.onchain_root_anchor.chain_id",
    "checkpoint_reference.root_anchor.chain_id",
    "onchain_root_anchor.chain_id",
    "root_anchor.chain_id",
    "base_sepolia_anchor.chain_id",
    "chain_id"
  ]);

  const blockNumberRaw = pickFirst(issuanceAnchor, [
    "audit_chain.onchain_root_anchor.block_number",
    "checkpoint_reference.root_anchor.block_number",
    "onchain_root_anchor.block_number",
    "root_anchor.block_number",
    "base_sepolia_anchor.block_number",
    "block_number"
  ]);

  const txHash = pickFirst(issuanceAnchor, [
    "audit_chain.onchain_root_anchor.tx_hash",
    "checkpoint_reference.root_anchor.tx_hash",
    "onchain_root_anchor.tx_hash",
    "root_anchor.tx_hash",
    "base_sepolia_anchor.tx_hash",
    "tx_hash"
  ]);

  assert(
    (typeof chainIdRaw === "string" && /^[0-9]+$/.test(chainIdRaw)) ||
      (Number.isInteger(chainIdRaw) && chainIdRaw > 0),
    "Could not extract on-chain anchor chain_id."
  );

  assert(
    (typeof blockNumberRaw === "string" && /^[0-9]+$/.test(blockNumberRaw)) ||
      (Number.isInteger(blockNumberRaw) && blockNumberRaw >= 0),
    "Could not extract on-chain anchor block_number."
  );

  assert(
    typeof txHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(txHash),
    "Could not extract on-chain anchor tx_hash."
  );

  const onchainRootAnchor = {
    chain_id: typeof chainIdRaw === "string" ? chainIdRaw : String(chainIdRaw),
    block_number: typeof blockNumberRaw === "string" ? blockNumberRaw : String(blockNumberRaw),
    tx_hash: txHash
  };

  if (typeof network === "string" && network.length > 0) {
    onchainRootAnchor.network = network;
  }

  return {
    issuance_anchor_schema: issuanceAnchorSchema,
    checkpoint_finalization_schema: checkpointFinalizationSchema,
    finalized_checkpoint_hash: finalizedCheckpointHash,
    transparency_log_root: transparencyLogRoot,
    onchain_root_anchor: onchainRootAnchor
  };
}

function buildUsage() {
  return [
    "Usage:",
    "node scripts/ops/grants/build-grant-issuance.mjs \\",
    "  --grant-id GRANT-2026-0001 \\",
    "  --issuer-id ISSUER-ACME \\",
    "  --beneficiary-id EMP-0001 \\",
    "  --plan-id PLAN-2026-RSU \\",
    "  --class-id COMMON \\",
    "  --security-type RSU \\",
    "  --share-quantity 1000 \\",
    "  --unit-price 0 \\",
    "  --currency USD \\",
    "  --issued-at 2026-03-07T00:00:00.000Z \\",
    "  --created-at 2026-03-07T00:00:00.000Z \\",
    "  --issuance-anchor manifests/transparency/issuance-anchor.json \\",
    "  --checkpoint-finalization manifests/transparency/checkpoint-finalization.json \\",
    "  --output manifests/grants/grant-issuance.json"
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const required = [
    "grant-id",
    "issuer-id",
    "beneficiary-id",
    "plan-id",
    "class-id",
    "security-type",
    "share-quantity",
    "unit-price",
    "currency",
    "issued-at"
  ];

  for (const key of required) {
    assert(args[key] !== undefined, `Missing required argument --${key}\n\n${buildUsage()}`);
  }

  const issuanceAnchorPath = args["issuance-anchor"] || "manifests/transparency/issuance-anchor.json";
  const checkpointFinalizationPath = args["checkpoint-finalization"] || "manifests/transparency/checkpoint-finalization.json";
  const outputPath = args.output || "manifests/grants/grant-issuance.json";

  const issuanceAnchor = readJson(issuanceAnchorPath);
  const checkpointFinalization = readJson(checkpointFinalizationPath);

  const trustInputs = extractTrustInputs(issuanceAnchor, checkpointFinalization);

  const issuanceAnchorHash = sha256Json(issuanceAnchor);
  const checkpointFinalizationHash = sha256Json(checkpointFinalization);

  const shareQuantity = Number(args["share-quantity"]);
  assert(Number.isSafeInteger(shareQuantity) && shareQuantity > 0, "share-quantity must be a positive safe integer.");

  const unitPrice = normalizeDecimalString(String(args["unit-price"]));
  const currency = String(args.currency).toUpperCase();

  assert(/^[A-Z]{3,10}$/.test(currency), "currency must be 3-10 uppercase letters.");
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(args["issued-at"]), "issued-at must be ISO8601 UTC with milliseconds.");
  const createdAt = args["created-at"] || args["issued-at"];
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt), "created-at must be ISO8601 UTC with milliseconds.");

  const issuanceAnchorReference = {
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

  const grant = {
    schema: "grant-audit-issuance-bound-grant-v1",
    grant_version: "1.0.0",
    lifecycle_state: "issued",
    grant_id: String(args["grant-id"]),
    issuer_id: String(args["issuer-id"]),
    beneficiary_id: String(args["beneficiary-id"]),
    plan_id: String(args["plan-id"]),
    class_id: String(args["class-id"]),
    security_type: String(args["security-type"]),
    share_quantity: shareQuantity,
    unit_price: unitPrice,
    currency,
    issued_at: String(args["issued-at"]),
    issuance_anchor_reference: issuanceAnchorReference
  };

  const issuanceBoundGrantHash = sha256Json(grant);
  const issuanceAnchorReferenceHash = sha256Json(issuanceAnchorReference);

  const binding = {
    binding_scope: "grant-issuance",
    binding_version: "1.0.0",
    issuance_bound_grant_hash: issuanceBoundGrantHash,
    issuance_anchor_reference_hash: issuanceAnchorReferenceHash,
    checkpoint_finalization_hash: checkpointFinalizationHash,
    finalized_checkpoint_hash: trustInputs.finalized_checkpoint_hash,
    transparency_log_root: trustInputs.transparency_log_root,
    onchain_root_anchor: trustInputs.onchain_root_anchor,
    trust_chain_hash: sha256Json({
      issuance_bound_grant_hash: issuanceBoundGrantHash,
      issuance_anchor_reference_hash: issuanceAnchorReferenceHash,
      checkpoint_finalization_hash: checkpointFinalizationHash,
      finalized_checkpoint_hash: trustInputs.finalized_checkpoint_hash,
      transparency_log_root: trustInputs.transparency_log_root,
      onchain_root_anchor: trustInputs.onchain_root_anchor
    })
  };

  const artifactCore = {
    schema: "grant-audit-grant-issuance-v1",
    artifact_version: "1.0.0",
    created_at: createdAt,
    grant,
    binding
  };

  const artifact = {
    ...artifactCore,
    artifact_hash: sha256Json(artifactCore)
  };

  writeCanonicalJson(outputPath, artifact);

  const result = {
    ok: true,
    phase: "7.19",
    output_path: normalizePathForRepo(outputPath),
    grant_id: grant.grant_id,
    issuance_anchor_path: issuanceAnchorReference.issuance_anchor_path,
    checkpoint_finalization_path: issuanceAnchorReference.checkpoint_finalization_path,
    issuance_bound_grant_hash: binding.issuance_bound_grant_hash,
    trust_chain_hash: binding.trust_chain_hash,
    artifact_hash: artifact.artifact_hash
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
