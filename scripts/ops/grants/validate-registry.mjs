#!/usr/bin/env node
/**
 * Validates:
 *  - manifests/grants/registry.json conforms to grant-registry-v1 schema
 *  - file is in canonical key order (deterministic serialization)
 *
 * Uses Ajv 2020 to support draft/2020-12 metaschema ($schema = https://json-schema.org/draft/2020-12/schema)
 */

import fs from "node:fs";
import crypto from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function readJson(p) {
  if (!fs.existsSync(p)) die(`Missing file: ${p}`);
  const raw = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(`Invalid JSON in ${p}: ${e.message}`);
  }
}

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;

  const keys = Object.keys(value).sort();
  const out = {};
  for (const k of keys) out[k] = canonicalize(value[k]);
  return out;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalPretty(value) {
  return JSON.stringify(canonicalize(value), null, 2) + "\n";
}

function sha256HexFromString(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function parseArgs(argv) {
  const out = {
    registryPath: "manifests/grants/registry.json",
    schemaPath: "schemas/grant-registry-v1.schema.json",
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === "--registry" && n) (out.registryPath = n, i++);
    else if (a === "--schema" && n) (out.schemaPath = n, i++);
    else if (a === "--help") {
      console.log(`
Usage:
  node scripts/ops/grants/validate-registry.mjs [--registry <path>] [--schema <path>]

Defaults:
  --registry manifests/grants/registry.json
  --schema   schemas/grant-registry-v1.schema.json
`);
      process.exit(0);
    } else {
      die(`Unknown arg: ${a}`);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);

  const registryRaw = fs.readFileSync(args.registryPath, "utf8");
  const registryJson = readJson(args.registryPath);

  // 1) Canonical serialization check (key ordering + 2-space indent)
  const expected = canonicalPretty(registryJson);
  if (registryRaw !== expected) {
    die(
      `Registry is not canonically formatted.\n` +
        `Fix by running: node scripts/ops/grants/build-registry.mjs\n`
    );
  }

  // 2) Schema validation (Draft 2020-12)
  const schema = readJson(args.schemaPath);

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  const validate = ajv.compile(schema);
  const ok = validate(registryJson);
  if (!ok) {
    const errs = (validate.errors || [])
      .map((e) => `${e.instancePath} ${e.message}`)
      .join("\n");
    die(`Schema validation failed:\n${errs}`);
  }

  // 3) Deterministic hash output (for CI / human checks)
  const canonical = canonicalStringify(registryJson);
  const sha = sha256HexFromString(canonical);

  console.log(`OK: ${args.registryPath} is canonical + schema-valid`);
  console.log(`Registry canonical sha256: ${sha}`);
}

main();
