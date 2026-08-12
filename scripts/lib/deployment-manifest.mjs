/**
 * Shared canonical deployment manifest loader.
 *
 * Provides the single authoritative interface for loading and validating
 * deployments/base-sepolia.json. All repository code that needs canonical
 * contract addresses should import from this module rather than reading
 * the manifest directly.
 *
 * Key guarantees:
 *   - Path resolution is relative to this module's location, not process.cwd().
 *     The loader behaves correctly regardless of the caller's working directory.
 *   - Returns only after schema validation and semantic invariant checks pass.
 *   - Fails closed: missing file, malformed JSON, schema failure, wrong network,
 *     wrong chain ID, or unsupported schema version all throw descriptive errors.
 *   - No fallback addresses. No environment-variable overrides. No RPC calls.
 */

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

// ── Module-relative paths ─────────────────────────────────────────────────────
// Resolve from scripts/lib/ → repository root regardless of process.cwd().
const LIB_DIR   = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(LIB_DIR, "../..");

export const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, "deployments", "base-sepolia.json");
export const DEFAULT_SCHEMA_PATH   = path.join(REPO_ROOT, "schemas", "deployment-manifest-v1.schema.json");

// ── Semantic invariants ───────────────────────────────────────────────────────
export const SUPPORTED_SCHEMA_VERSION = 1;
export const EXPECTED_CHAIN_ID        = 84532;
export const EXPECTED_NETWORK_NAME    = "base-sepolia";

// ── AJV validator (lazy, cached per schema path) ──────────────────────────────
const _validatorCache = new Map();

function buildValidator(schemaPath) {
  if (_validatorCache.has(schemaPath)) return _validatorCache.get(schemaPath);

  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (e) {
    throw new Error(`Cannot load deployment manifest schema at ${schemaPath}: ${e.message}`);
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validator = ajv.compile(schema);
  _validatorCache.set(schemaPath, validator);
  return validator;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load, validate, and return the canonical deployment manifest.
 *
 * @param {object}  [options]
 * @param {string}  [options.manifestPath] Override the manifest file path.
 *   Defaults to deployments/base-sepolia.json relative to repository root.
 *   Intended for testing only — production callers should use the default.
 * @param {string}  [options.schemaPath]   Override the schema file path.
 *   Defaults to schemas/deployment-manifest-v1.schema.json relative to
 *   repository root. Intended for testing only.
 * @returns {object} The validated deployment manifest object.
 * @throws {Error}  On missing file, malformed JSON, schema validation failure,
 *   unsupported schemaVersion, wrong network name, or wrong chain ID.
 */
export function loadCanonicalDeployment({ manifestPath, schemaPath } = {}) {
  const mPath = manifestPath ?? DEFAULT_MANIFEST_PATH;
  const sPath = schemaPath   ?? DEFAULT_SCHEMA_PATH;

  // 1. Read file
  let raw;
  try {
    raw = fs.readFileSync(mPath, "utf8");
  } catch (e) {
    throw new Error(`Cannot read deployment manifest at ${mPath}: ${e.message}`);
  }

  // 2. Parse JSON
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Deployment manifest is not valid JSON (${mPath}): ${e.message}`);
  }

  // 3. JSON Schema validation
  const validate = buildValidator(sPath);
  if (!validate(manifest)) {
    const lines = validate.errors.map(err => {
      const loc   = err.instancePath || "(root)";
      const extra = err.params?.additionalProperty
        ? ` [unexpected: ${err.params.additionalProperty}]`
        : "";
      return `  ${loc}: ${err.message}${extra}`;
    });
    throw new Error(`Deployment manifest failed schema validation:\n${lines.join("\n")}`);
  }

  // 4. Semantic invariants (defence-in-depth beyond what the schema const enforces)
  if (manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion: ${JSON.stringify(manifest.schemaVersion)}` +
      ` (supported: ${SUPPORTED_SCHEMA_VERSION})`
    );
  }
  if (manifest.network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Unexpected chainId: ${manifest.network.chainId}` +
      ` (expected ${EXPECTED_CHAIN_ID} for ${EXPECTED_NETWORK_NAME})`
    );
  }
  if (manifest.network.name !== EXPECTED_NETWORK_NAME) {
    throw new Error(
      `Unexpected network name: "${manifest.network.name}"` +
      ` (expected "${EXPECTED_NETWORK_NAME}")`
    );
  }

  return manifest;
}
