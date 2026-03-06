#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as tar from "tar";
import {
  REQUIRED_PACKET_FILES,
  readJson,
  sha256File,
  normalizePacketPath,
  assertSafeArchiveEntries,
  assertDeterministicallySortedPaths,
  assertRequiredPacketFilesExist
} from "../lib/audit-packet-structure.mjs";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function validateSha256ManifestSchemaOrThrow(manifest) {
  const schemaPath = path.resolve(
    process.cwd(),
    "schemas/grant-audit-packet-sha256-manifest-v1.schema.json"
  );

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Missing schema file: ${schemaPath}`);
  }

  const schema = readJson(schemaPath);

  if (schema?.properties?.schema?.const !== "grant-audit-packet-sha256-manifest-v1") {
    throw new Error("Manifest schema file is malformed: unexpected schema const");
  }

  if (schema?.properties?.hash_algorithm?.const !== "sha256") {
    throw new Error("Manifest schema file is malformed: unexpected hash_algorithm const");
  }

  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("sha256-manifest.json must be a top-level object");
  }

  const allowedTopLevelKeys = new Set(["schema", "hash_algorithm", "files"]);
  for (const key of Object.keys(manifest)) {
    if (!allowedTopLevelKeys.has(key)) {
      throw new Error(`sha256-manifest.json has unexpected top-level property: ${key}`);
    }
  }

  if (manifest.schema !== "grant-audit-packet-sha256-manifest-v1") {
    throw new Error(
      `sha256-manifest.json schema must equal grant-audit-packet-sha256-manifest-v1, got ${manifest.schema}`
    );
  }

  if (manifest.hash_algorithm !== "sha256") {
    throw new Error(
      `sha256-manifest.json hash_algorithm must equal sha256, got ${manifest.hash_algorithm}`
    );
  }

  if (!Array.isArray(manifest.files) || manifest.files.length < 1) {
    throw new Error("sha256-manifest.json files must be a non-empty array");
  }

  for (let i = 0; i < manifest.files.length; i += 1) {
    const entry = manifest.files[i];

    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Manifest entry at index ${i} must be an object`);
    }

    const allowedEntryKeys = new Set(["path", "sha256"]);
    for (const key of Object.keys(entry)) {
      if (!allowedEntryKeys.has(key)) {
        throw new Error(`Manifest entry at index ${i} has unexpected property: ${key}`);
      }
    }

    if (typeof entry.path !== "string" || entry.path.length < 1) {
      throw new Error(`Manifest entry at index ${i} missing valid path`);
    }

    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Manifest entry at index ${i} missing valid sha256`);
    }

    normalizePacketPath(entry.path);
  }
}

async function main() {
  const archivePath = process.argv[2];
  if (!archivePath) {
    fail("Usage: node scripts/audit/replay-grant-audit.mjs <grant-audit-packet.tgz>");
  }

  const resolvedArchive = path.resolve(process.cwd(), archivePath);
  if (!fs.existsSync(resolvedArchive)) {
    fail(`Archive not found: ${resolvedArchive}`);
  }

  let archiveEntries = [];
  await tar.list({
    file: resolvedArchive,
    gzip: true,
    onentry: (entry) => {
      archiveEntries.push(entry.path);
    }
  });

  archiveEntries = assertSafeArchiveEntries(archiveEntries);
  assertDeterministicallySortedPaths(archiveEntries, "archive entries");
  assertRequiredPacketFilesExist(archiveEntries);

  const unpackDir = fs.mkdtempSync(path.join(os.tmpdir(), "grant-audit-replay-"));

  await tar.extract({
    file: resolvedArchive,
    cwd: unpackDir,
    gzip: true
  });

  for (const requiredPath of REQUIRED_PACKET_FILES) {
    const absPath = path.join(unpackDir, requiredPath);
    if (!fs.existsSync(absPath)) {
      fail(`Required extracted packet file missing: ${requiredPath}`);
    }
  }

  const auditPacketPath = path.join(unpackDir, "packet", "audit-packet.json");
  const auditPacket = readJson(auditPacketPath);

  const manifestRelPath =
    auditPacket?.integrity?.sha256_manifest || "packet/sha256-manifest.json";
  const normalizedManifestRelPath = normalizePacketPath(manifestRelPath);
  const manifestPath = path.join(unpackDir, normalizedManifestRelPath);

  if (!fs.existsSync(manifestPath)) {
    fail(`Missing sha256-manifest.json: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath);
  validateSha256ManifestSchemaOrThrow(manifest);

  const manifestHash = sha256File(manifestPath);
  const expectedManifestHash = auditPacket?.integrity?.sha256_manifest_hash;

  if (!expectedManifestHash) {
    fail("packet/audit-packet.json missing integrity.sha256_manifest_hash");
  }

  if (manifestHash !== expectedManifestHash) {
    fail(
      `Manifest hash mismatch: expected ${expectedManifestHash}, got ${manifestHash}`
    );
  }

  const manifestPaths = [];
  const seenPaths = new Set();

  for (const entry of manifest.files) {
    const normalizedEntryPath = normalizePacketPath(entry.path);

    if (
      normalizedEntryPath === "packet/sha256-manifest.json" ||
      normalizedEntryPath === "packet/audit-packet.json"
    ) {
      fail(
        "sha256 manifest must not include packet/sha256-manifest.json or packet/audit-packet.json"
      );
    }

    if (seenPaths.has(normalizedEntryPath)) {
      fail(`Duplicate manifest path: ${normalizedEntryPath}`);
    }
    seenPaths.add(normalizedEntryPath);
    manifestPaths.push(normalizedEntryPath);

    const targetPath = path.join(unpackDir, normalizedEntryPath);
    if (!fs.existsSync(targetPath)) {
      fail(`Required hashed file missing: ${normalizedEntryPath}`);
    }

    const actualHash = sha256File(targetPath);
    if (actualHash !== entry.sha256) {
      fail(
        `Hash mismatch for ${normalizedEntryPath}: expected ${entry.sha256}, got ${actualHash}`
      );
    }
  }

  assertDeterministicallySortedPaths(manifestPaths, "manifest file paths");

  console.log("Loaded packet");
  console.log(`Packet schema: ${auditPacket.schema}`);
  console.log(`Manifest path: ${normalizedManifestRelPath}`);
  console.log(`Manifest hash verified: ${manifestHash}`);
  console.log(`Verified ${manifest.files.length} manifest entr${manifest.files.length === 1 ? "y" : "ies"}`);
  console.log("Replay verification successful");
}

main().catch((err) => {
  fail(err?.stack || String(err));
});
