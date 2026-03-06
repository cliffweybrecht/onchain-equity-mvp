#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensure(condition, message) {
  if (!condition) fail(message);
}

function loadBuild(rootDir, label) {
  const packetPath = path.join(rootDir, "packet.json");
  ensure(fs.existsSync(packetPath), `${label}: missing ${packetPath}`);

  const packet = readJson(packetPath);
  ensure(packet?.schema === "grant-audit-packet-v1", `${label}: unexpected packet schema`);
  ensure(packet?.integrity?.sha256_manifest, `${label}: missing integrity.sha256_manifest`);
  ensure(packet?.integrity?.sha256_manifest_hash, `${label}: missing integrity.sha256_manifest_hash`);

  const manifestRelativePath = packet.integrity.sha256_manifest;
  const manifestPath = path.join(rootDir, manifestRelativePath);
  ensure(fs.existsSync(manifestPath), `${label}: missing manifest at ${manifestPath}`);

  const manifestRaw = fs.readFileSync(manifestPath);
  const manifestHash = sha256(manifestRaw);

  ensure(
    manifestHash === packet.integrity.sha256_manifest_hash,
    `${label}: recorded manifest hash does not match actual manifest hash`
  );

  return {
    label,
    rootDir,
    packetPath,
    packet,
    manifestRelativePath,
    manifestPath,
    manifestRaw,
    manifestHash
  };
}

const [build1Root, build2Root] = process.argv.slice(2);

if (!build1Root || !build2Root) {
  fail(
    "Usage: node scripts/audit/verify-audit-packet-reproducibility.mjs <build-1-unpacked-root> <build-2-unpacked-root>"
  );
}

const a = loadBuild(build1Root, "build-1");
const b = loadBuild(build2Root, "build-2");

ensure(
  a.manifestRelativePath === b.manifestRelativePath,
  "manifest path differs between builds"
);

ensure(
  a.manifestHash === b.manifestHash,
  "manifest hash differs between builds"
);

ensure(
  a.manifestRaw.equals(b.manifestRaw),
  "manifest file contents differ between builds"
);

const output = {
  schema: a.packet.schema,
  packet_version: a.packet.packet_version,
  manifest_path: a.manifestRelativePath,
  manifest_hash: a.manifestHash,
  build_1_recorded_manifest_hash: a.packet.integrity.sha256_manifest_hash,
  build_2_recorded_manifest_hash: b.packet.integrity.sha256_manifest_hash,
  manifest_contents_match: true,
  integrity_outputs_match: true
};

console.log("Reproducibility verification successful");
console.log(JSON.stringify(output, null, 2));
