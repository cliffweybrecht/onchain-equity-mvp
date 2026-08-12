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

// ── Private: module-relative paths ───────────────────────────────────────────
// Resolve from scripts/lib/ → repository root regardless of process.cwd().
const LIB_DIR  = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(LIB_DIR, "../..");

const MANIFEST_PATH = path.join(REPO_ROOT, "deployments", "base-sepolia.json");
const SCHEMA_PATH   = path.join(REPO_ROOT, "schemas", "deployment-manifest-v1.schema.json");

// ── Private: semantic invariants ─────────────────────────────────────────────
const SUPPORTED_SCHEMA_VERSION = 1;
const EXPECTED_CHAIN_ID        = 84532;
const EXPECTED_NETWORK_NAME    = "base-sepolia";

// ── Private: AJV validator (lazy, cached) ────────────────────────────────────
let _validator = null;

function getValidator() {
  if (_validator) return _validator;
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  } catch (e) {
    throw new Error(`Cannot load deployment manifest schema at ${SCHEMA_PATH}: ${e.message}`);
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  _validator = ajv.compile(schema);
  return _validator;
}

// ── Private: file-loading pipeline ───────────────────────────────────────────

function _loadFromPath(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    throw new Error(`Cannot read deployment manifest at ${filePath}: ${e.message}`);
  }

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Deployment manifest is not valid JSON (${filePath}): ${e.message}`);
  }

  return validateManifestData(obj);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load, validate, and return the canonical deployment manifest.
 *
 * Always loads deployments/base-sepolia.json relative to the repository root.
 * Path resolution is module-relative — behaves correctly from any cwd.
 *
 * @returns {object} The validated deployment manifest.
 * @throws {Error}  On missing file, malformed JSON, schema validation failure,
 *   unsupported schemaVersion, wrong network name, or wrong chain ID.
 */
export function loadCanonicalDeployment() {
  return _loadFromPath(MANIFEST_PATH);
}

/**
 * Validate a parsed deployment manifest object.
 *
 * Performs JSON Schema validation and semantic invariant checks on a
 * caller-supplied object. Intended for testing fixture data without
 * mutating or loading from the canonical manifest path.
 *
 * Production callers should use loadCanonicalDeployment() instead.
 *
 * @param {unknown} obj  Candidate manifest object to validate.
 * @returns {object}     The validated manifest (same reference as input).
 * @throws {Error}       On schema failure, unsupported schemaVersion,
 *   wrong network name, or wrong chain ID.
 */
export function validateManifestData(obj) {
  const validate = getValidator();
  if (!validate(obj)) {
    const lines = validate.errors.map(err => {
      const loc   = err.instancePath || "(root)";
      const extra = err.params?.additionalProperty
        ? ` [unexpected: ${err.params.additionalProperty}]`
        : "";
      return `  ${loc}: ${err.message}${extra}`;
    });
    throw new Error(`Deployment manifest failed schema validation:\n${lines.join("\n")}`);
  }

  // Semantic invariants — defence-in-depth beyond the schema const
  if (obj.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion: ${JSON.stringify(obj.schemaVersion)}` +
      ` (supported: ${SUPPORTED_SCHEMA_VERSION})`
    );
  }
  if (obj.network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Unexpected chainId: ${obj.network.chainId}` +
      ` (expected ${EXPECTED_CHAIN_ID} for ${EXPECTED_NETWORK_NAME})`
    );
  }
  if (obj.network.name !== EXPECTED_NETWORK_NAME) {
    throw new Error(
      `Unexpected network name: "${obj.network.name}"` +
      ` (expected "${EXPECTED_NETWORK_NAME}")`
    );
  }

  return obj;
}
