#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Ajv from "ajv";
import addFormats from "ajv-formats";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256HexFromFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(message, extra = {}) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
        ...extra
      },
      null,
      2
    )
  );
  process.exit(1);
}

const args = parseArgs(process.argv);
const manifestPath = args.manifest;
if (!manifestPath) fail("Missing required argument: --manifest");

const manifest = loadJson(manifestPath);

const lifecycleSchemaPath = path.resolve("schemas/grant-audit-packet-lifecycle-v1.schema.json");
const transparencySchemaPath = path.resolve("schemas/grant-audit-transparency-manifest-v1.schema.json");

const lifecycleSchema = loadJson(lifecycleSchemaPath);
const transparencySchema = loadJson(transparencySchemaPath);

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  schemas: [lifecycleSchema, transparencySchema]
});
addFormats(ajv);

const validate = ajv.getSchema("grant-audit-transparency-manifest-v1.schema.json");
if (!validate) fail("Unable to load transparency manifest schema");

if (!validate(manifest)) {
  fail("Schema validation failed", {
    schema: "grant-audit-transparency-manifest-verification-v1",
    validation_errors: validate.errors || []
  });
}

const staleReasons = [];
let fresh = true;

const expectedPacketManifestHash = args["packet-manifest-hash"];
if (
  expectedPacketManifestHash &&
  manifest.packet_manifest_hash !== expectedPacketManifestHash
) {
  fresh = false;
  staleReasons.push("packet_manifest_hash_mismatch");
}

if (manifest.lifecycle.status !== "active") {
  fresh = false;
  staleReasons.push(`lifecycle_status_${manifest.lifecycle.status}`);
}

if (manifest.lifecycle.superseded_by_packet_manifest_hash) {
  fresh = false;
  staleReasons.push("packet_superseded");
}

if (manifest.lifecycle.revoked_by_packet_manifest_hash) {
  fresh = false;
  staleReasons.push("packet_revoked");
}

const nowIso = args["now"] || new Date().toISOString();
const nowMs = Date.parse(nowIso);
const createdMs = Date.parse(manifest.created_at);
const ageSeconds = Math.floor((nowMs - createdMs) / 1000);

if (ageSeconds > manifest.freshness_policy.max_age_seconds) {
  fresh = false;
  staleReasons.push("max_age_exceeded");
}

const currentBlockNumber =
  args["current-block-number"] !== undefined
    ? Number(args["current-block-number"])
    : undefined;

let blockDrift = null;
if (currentBlockNumber !== undefined) {
  blockDrift = currentBlockNumber - manifest.state_binding.bound_block_number;
  if (blockDrift > manifest.freshness_policy.max_block_drift) {
    fresh = false;
    staleReasons.push("max_block_drift_exceeded");
  }
}

const currentPacketManifestHash = args["current-packet-manifest-hash"];
if (
  currentPacketManifestHash &&
  manifest.freshness_policy.invalidate_on_newer_packet &&
  currentPacketManifestHash !== manifest.packet_manifest_hash
) {
  fresh = false;
  staleReasons.push("newer_packet_exists");
}

const currentContractsHash = args["current-contracts-hash"];
if (
  currentContractsHash &&
  manifest.freshness_policy.invalidate_on_contracts_hash_change &&
  currentContractsHash !== manifest.fingerprints.contracts_hash
) {
  fresh = false;
  staleReasons.push("contracts_hash_changed");
}

const currentPolicySetHash = args["current-policy-set-hash"];
if (
  currentPolicySetHash &&
  manifest.freshness_policy.invalidate_on_policy_hash_change &&
  currentPolicySetHash !== manifest.fingerprints.policy_set_hash
) {
  fresh = false;
  staleReasons.push("policy_set_hash_changed");
}

const currentIssuerAdminSetHash = args["current-issuer-admin-set-hash"];
if (
  currentIssuerAdminSetHash &&
  manifest.freshness_policy.invalidate_on_admin_set_hash_change &&
  currentIssuerAdminSetHash !== manifest.fingerprints.issuer_admin_set_hash
) {
  fresh = false;
  staleReasons.push("issuer_admin_set_hash_changed");
}

const currentGrantsStateHash = args["current-grants-state-hash"];
if (
  currentGrantsStateHash &&
  manifest.freshness_policy.invalidate_on_grants_state_hash_change &&
  currentGrantsStateHash !== manifest.fingerprints.grants_state_hash
) {
  fresh = false;
  staleReasons.push("grants_state_hash_changed");
}

const trustPolicySignatureFile = manifest.artifacts.trust_policy_signature.path;
if (trustPolicySignatureFile && fs.existsSync(trustPolicySignatureFile)) {
  const actual = sha256HexFromFile(trustPolicySignatureFile);
  if (actual !== manifest.artifacts.trust_policy_signature.sha256) {
    fresh = false;
    staleReasons.push("trust_policy_signature_sha256_mismatch");
  }
}

const attestationBundleIntegrityFile =
  manifest.artifacts.attestation_bundle_integrity.path;
if (attestationBundleIntegrityFile && fs.existsSync(attestationBundleIntegrityFile)) {
  const actual = sha256HexFromFile(attestationBundleIntegrityFile);
  if (actual !== manifest.artifacts.attestation_bundle_integrity.sha256) {
    fresh = false;
    staleReasons.push("attestation_bundle_integrity_sha256_mismatch");
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: "grant-audit-transparency-manifest-verification-v1",
      fresh,
      stale: !fresh,
      stale_reasons: staleReasons,
      packet_manifest_hash: manifest.packet_manifest_hash,
      lifecycle_status: manifest.lifecycle.status,
      bound_block_number: manifest.state_binding.bound_block_number,
      current_block_number: currentBlockNumber ?? null,
      block_drift: blockDrift,
      age_seconds: ageSeconds,
      anchor_status: manifest.anchoring.anchor_status
    },
    null,
    2
  )
);
