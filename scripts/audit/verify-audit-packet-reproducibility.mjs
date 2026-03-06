#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as tar from "tar";
import {
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

async function listArchiveEntries(archivePath) {
  const entries = [];

  await tar.list({
    file: archivePath,
    gzip: true,
    onentry: (entry) => {
      entries.push(entry.path);
    }
  });

  return entries;
}

async function extractArchive(archivePath, destDir) {
  await tar.extract({
    file: archivePath,
    cwd: destDir,
    gzip: true
  });
}

function loadBuild(buildLabel, archivePath) {
  const resolvedArchive = path.resolve(process.cwd(), archivePath);
  if (!fs.existsSync(resolvedArchive)) {
    fail(`${buildLabel}: archive not found: ${resolvedArchive}`);
  }

  return resolvedArchive;
}

async function inspectBuild(buildLabel, archivePath) {
  const archiveEntriesRaw = await listArchiveEntries(archivePath);
  const archiveEntries = assertSafeArchiveEntries(archiveEntriesRaw);
  assertDeterministicallySortedPaths(archiveEntries, `${buildLabel}: archive entries`);
  assertRequiredPacketFilesExist(archiveEntries);

  const unpackDir = fs.mkdtempSync(path.join(os.tmpdir(), `grant-audit-repro-${buildLabel}-`));
  await extractArchive(archivePath, unpackDir);

  const auditPacketPath = path.join(unpackDir, "packet", "audit-packet.json");
  if (!fs.existsSync(auditPacketPath)) {
    fail(`${buildLabel}: missing packet/audit-packet.json`);
  }

  const manifestPath = path.join(unpackDir, "packet", "sha256-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    fail(`${buildLabel}: missing packet/sha256-manifest.json`);
  }

  const auditPacket = readJson(auditPacketPath);
  const manifest = readJson(manifestPath);

  if (!Array.isArray(manifest.files)) {
    fail(`${buildLabel}: packet/sha256-manifest.json missing files array`);
  }

  const manifestPaths = manifest.files.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      fail(`${buildLabel}: invalid manifest entry at index ${index}`);
    }
    if (typeof entry.path !== "string" || typeof entry.sha256 !== "string") {
      fail(`${buildLabel}: invalid manifest entry shape at index ${index}`);
    }
    return normalizePacketPath(entry.path);
  });

  assertDeterministicallySortedPaths(manifestPaths, `${buildLabel}: manifest file paths`);

  const manifestHash = sha256File(manifestPath);
  const integrityManifestHash = auditPacket?.integrity?.sha256_manifest_hash;
  if (!integrityManifestHash) {
    fail(`${buildLabel}: packet/audit-packet.json missing integrity.sha256_manifest_hash`);
  }

  if (manifestHash !== integrityManifestHash) {
    fail(
      `${buildLabel}: manifest hash mismatch: expected ${integrityManifestHash}, got ${manifestHash}`
    );
  }

  return {
    auditPacket,
    manifest,
    manifestHash,
    archiveEntries
  };
}

async function main() {
  const archiveAArg = process.argv[2];
  const archiveBArg = process.argv[3];

  if (!archiveAArg || !archiveBArg) {
    fail(
      "Usage: node scripts/audit/verify-audit-packet-reproducibility.mjs <build-1.tgz> <build-2.tgz>"
    );
  }

  const archiveA = loadBuild("build-1", archiveAArg);
  const archiveB = loadBuild("build-2", archiveBArg);

  const build1 = await inspectBuild("build-1", archiveA);
  const build2 = await inspectBuild("build-2", archiveB);

  const manifestContentsMatch =
    JSON.stringify(build1.manifest) === JSON.stringify(build2.manifest);

  const integrityOutputsMatch =
    build1.auditPacket?.integrity?.sha256_manifest ===
      build2.auditPacket?.integrity?.sha256_manifest &&
    build1.auditPacket?.integrity?.sha256_manifest_hash ===
      build2.auditPacket?.integrity?.sha256_manifest_hash;

  if (!manifestContentsMatch) {
    fail("Manifest contents do not match between builds");
  }

  if (!integrityOutputsMatch) {
    fail("Integrity outputs do not match between builds");
  }

  console.log(
    JSON.stringify(
      {
        schema: "grant-audit-packet-v1",
        packet_version: "1.0.0",
        manifest_path: "packet/sha256-manifest.json",
        manifest_hash: build1.manifestHash,
        manifest_contents_match: true,
        integrity_outputs_match: true
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  fail(err?.stack || String(err));
});
