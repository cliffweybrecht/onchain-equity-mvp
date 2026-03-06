#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { readJson, normalizePacketPath } from "../lib/audit-packet-structure.mjs";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const manifestArg = process.argv[2];
if (!manifestArg) {
  fail("Usage: node scripts/audit/check-audit-packet-manifest-schema.mjs <manifest-path>");
}

const manifestPath = path.resolve(process.cwd(), manifestArg);
if (!fs.existsSync(manifestPath)) {
  fail(`Manifest not found: ${manifestPath}`);
}

const schemaPath = path.resolve(
  process.cwd(),
  "schemas/grant-audit-packet-sha256-manifest-v1.schema.json"
);
if (!fs.existsSync(schemaPath)) {
  fail(`Schema not found: ${schemaPath}`);
}

const schema = readJson(schemaPath);
const manifest = readJson(manifestPath);

if (schema?.properties?.schema?.const !== "grant-audit-packet-sha256-manifest-v1") {
  fail("Schema file malformed: unexpected schema const");
}

if (schema?.properties?.hash_algorithm?.const !== "sha256") {
  fail("Schema file malformed: unexpected hash_algorithm const");
}

if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
  fail("Manifest must be a top-level object");
}

const allowedTopLevelKeys = new Set(["schema", "hash_algorithm", "files"]);
for (const key of Object.keys(manifest)) {
  if (!allowedTopLevelKeys.has(key)) {
    fail(`Manifest has unexpected top-level property: ${key}`);
  }
}

if (manifest.schema !== "grant-audit-packet-sha256-manifest-v1") {
  fail(`Manifest schema must equal grant-audit-packet-sha256-manifest-v1, got ${manifest.schema}`);
}

if (manifest.hash_algorithm !== "sha256") {
  fail(`Manifest hash_algorithm must equal sha256, got ${manifest.hash_algorithm}`);
}

if (!Array.isArray(manifest.files) || manifest.files.length < 1) {
  fail("Manifest files must be a non-empty array");
}

for (let i = 0; i < manifest.files.length; i += 1) {
  const entry = manifest.files[i];

  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    fail(`Manifest entry at index ${i} must be an object`);
  }

  const allowedEntryKeys = new Set(["path", "sha256"]);
  for (const key of Object.keys(entry)) {
    if (!allowedEntryKeys.has(key)) {
      fail(`Manifest entry at index ${i} has unexpected property: ${key}`);
    }
  }

  if (typeof entry.path !== "string" || entry.path.length < 1) {
    fail(`Manifest entry at index ${i} missing valid path`);
  }

  normalizePacketPath(entry.path);

  if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    fail(`Manifest entry at index ${i} missing valid sha256`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: manifest.schema,
      hash_algorithm: manifest.hash_algorithm,
      file_count: manifest.files.length
    },
    null,
    2
  )
);
