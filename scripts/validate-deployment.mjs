#!/usr/bin/env node
/**
 * Deterministic validator for deployments/base-sepolia.json.
 *
 * Validates the canonical deployment manifest against its JSON Schema
 * and performs additional semantic checks that the schema alone cannot
 * express (e.g. chainId must equal exactly 84532 for Base Sepolia).
 *
 * Exits 0 on success. Exits non-zero on any validation failure.
 *
 * Usage:
 *   node scripts/validate-deployment.mjs
 *   npm run validate:deployment
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

// ── Load manifest and schema ──────────────────────────────────────────────────

const manifestPath = path.join(root, "deployments", "base-sepolia.json");
const schemaPath   = path.join(root, "schemas", "deployment-manifest-v1.schema.json");

if (!fs.existsSync(manifestPath)) fail(`Manifest not found: ${manifestPath}`);
if (!fs.existsSync(schemaPath))   fail(`Schema not found: ${schemaPath}`);

let manifest, schema;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (e) {
  fail(`Failed to parse manifest JSON: ${e.message}`);
}
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (e) {
  fail(`Failed to parse schema JSON: ${e.message}`);
}

// ── JSON Schema validation (strict: additionalProperties enforced) ────────────

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(schema);
if (!validate(manifest)) {
  console.error("Manifest failed JSON Schema validation:");
  for (const err of validate.errors) {
    const loc = err.instancePath || "(root)";
    console.error(`  ${loc}: ${err.message}`);
    if (err.params?.additionalProperty) {
      console.error(`    unexpected property: ${err.params.additionalProperty}`);
    }
  }
  process.exit(1);
}

// ── Semantic checks ───────────────────────────────────────────────────────────

const EXPECTED_CHAIN_ID = 84532;
const EXPECTED_NETWORK  = "base-sepolia";

if (manifest.network.chainId !== EXPECTED_CHAIN_ID) {
  fail(`chainId must be ${EXPECTED_CHAIN_ID} (Base Sepolia), got ${manifest.network.chainId}`);
}

if (manifest.network.name !== EXPECTED_NETWORK) {
  fail(`network.name must be "${EXPECTED_NETWORK}", got "${manifest.network.name}"`);
}

// Ethereum address checksum is not enforced here — the schema pattern already
// ensures 0x + 40 hex chars. Checksum enforcement belongs to a future PR.

// ── Report ────────────────────────────────────────────────────────────────────

console.log("PASS: deployment manifest valid");
console.log(`  schemaVersion:    ${manifest.schemaVersion}`);
console.log(`  network:          ${manifest.network.name} (chainId ${manifest.network.chainId})`);
console.log(`  phase:            ${manifest.release.phase}`);
console.log(`  referenceCommit:  ${manifest.release.referenceCommit}`);
console.log(`  IdentityRegistry: ${manifest.contracts.IdentityRegistry}`);
console.log(`  EquityToken:      ${manifest.contracts.EquityToken}`);
console.log(`  VestingContract:  ${manifest.contracts.VestingContract}`);
console.log(`  governance.safe:  ${manifest.governance.safe}`);
