#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import * as tar from "tar";

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeRel(filePath) {
  return filePath.split(path.sep).join("/");
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
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

  const unpackDir = fs.mkdtempSync(path.join(os.tmpdir(), "grant-audit-replay-"));

  await tar.extract({
    file: resolvedArchive,
    cwd: unpackDir,
    gzip: true
  });

  const packetJsonPath = path.join(unpackDir, "packet.json");
  if (!fs.existsSync(packetJsonPath)) {
    fail(`Missing packet.json: ${packetJsonPath}`);
  }

  const packet = readJson(packetJsonPath);

  const manifestRelPath =
    packet?.integrity?.sha256_manifest || "packet/sha256-manifest.json";
  const manifestPath = path.join(unpackDir, manifestRelPath);

  if (!fs.existsSync(manifestPath)) {
    fail(`Missing sha256-manifest.json: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath);

  if (!Array.isArray(manifest.files)) {
    fail("sha256-manifest.json missing files array");
  }

  const manifestHash = sha256File(manifestPath);
  const expectedManifestHash = packet?.integrity?.sha256_manifest_hash;

  if (!expectedManifestHash) {
    fail("packet.json missing integrity.sha256_manifest_hash");
  }

  if (manifestHash !== expectedManifestHash) {
    fail(
      `Manifest hash mismatch: expected ${expectedManifestHash}, got ${manifestHash}`
    );
  }

  const forbiddenManifestPaths = new Set([
    "packet.json",
    "packet/sha256-manifest.json"
  ]);

  const seenPaths = new Set();

  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== "string" || typeof entry.sha256 !== "string") {
      fail("Invalid manifest entry shape");
    }

    if (forbiddenManifestPaths.has(entry.path)) {
      fail(`sha256 manifest must not include ${entry.path}`);
    }

    if (seenPaths.has(entry.path)) {
      fail(`Duplicate manifest path: ${entry.path}`);
    }
    seenPaths.add(entry.path);

    const targetPath = path.join(unpackDir, entry.path);
    if (!fs.existsSync(targetPath)) {
      fail(`Manifest entry missing file: ${entry.path}`);
    }

    const actualHash = sha256File(targetPath);
    if (actualHash !== entry.sha256) {
      fail(
        `Hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${actualHash}`
      );
    }
  }

  console.log("Loaded packet");
  console.log(`Packet schema: ${packet.schema}`);
  console.log(`Manifest path: ${manifestRelPath}`);
  console.log(`Manifest hash verified: ${manifestHash}`);
  console.log(`Verified ${manifest.files.length} manifest entr${manifest.files.length === 1 ? "y" : "ies"}`);
  console.log("Replay verification successful");
}

main().catch((err) => {
  fail(err?.stack || String(err));
});
