#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const REQUIRED_PACKET_FILES = [
  "packet/sha256-manifest.json",
  "packet/inputs/grants-index.json",
  "packet/inputs/grants-registry-snapshot.json",
  "packet/inputs/grants-merkle-root.json",
  "packet/inputs/grants-state-snapshot.json"
];

const EXCLUDED_FROM_MANIFEST = new Set([
  "packet/audit-packet.json",
  "packet/sha256-manifest.json"
]);

function usage() {
  console.error(`
Usage:
  node scripts/audit/verify-audit-packet-signature.mjs <audit-packet.tgz> <signature.json> \\
    [--expected-key-id <signer-key-id>] \\
    [--expected-public-key <ed25519-public-key.pem>]
`);
}

function parseArgs(argv) {
  if (argv.length < 2) {
    usage();
    process.exit(1);
  }

  const args = {
    archivePath: argv[0],
    signaturePath: argv[1],
    expectedKeyId: null,
    expectedPublicKeyPath: null
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--expected-key-id") {
      args.expectedKeyId = argv[++i];
    } else if (arg === "--expected-public-key") {
      args.expectedPublicKeyPath = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeArchivePath(p) {
  const normalized = p.replace(/\\/g, "/");

  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error(`Unsafe archive path detected: ${p}`);
  }

  return normalized;
}

function listArchiveEntries(archivePath) {
  const stdout = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" });

  return stdout
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(normalizeArchivePath);
}

function extractArchiveFile(archivePath, entry) {
  return execFileSync("tar", ["-xOf", archivePath, entry], {
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024
  });
}

function assertRequiredPacketFiles(entries) {
  const files = new Set(entries.filter((e) => !e.endsWith("/")));

  for (const required of REQUIRED_PACKET_FILES) {
    if (!files.has(required)) {
      throw new Error(`Missing required packet file: ${required}`);
    }
  }
}

function normalizeManifestEntries(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be a JSON object");
  }

  if (!Array.isArray(manifest.files)) {
    throw new Error("Manifest files must be an array");
  }

  const normalizedEntries = [];

  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Manifest files array contains a non-object entry");
    }

    const filePath = normalizeArchivePath(entry.path);
    const hashValue = entry.sha256;

    if (!filePath) {
      throw new Error("Manifest entry missing path");
    }

    if (!/^[a-f0-9]{64}$/.test(hashValue)) {
      throw new Error(`Manifest hash for ${filePath} is not valid sha256 hex`);
    }

    normalizedEntries.push({
      path: filePath,
      sha256: hashValue
    });
  }

  return normalizedEntries;
}

function verifyPacketIntegrity(archivePath, entries) {
  assertRequiredPacketFiles(entries);

  const manifestBytes = extractArchiveFile(
    archivePath,
    "packet/sha256-manifest.json"
  );

  const manifestHash = sha256Hex(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const manifestEntries = normalizeManifestEntries(manifest);

  for (const entry of manifestEntries) {
    const file = entry.path;
    const expected = entry.sha256;

    if (EXCLUDED_FROM_MANIFEST.has(file)) {
      continue;
    }

    const data = extractArchiveFile(archivePath, file);
    const actual = sha256Hex(data);

    if (expected !== actual) {
      throw new Error(`Integrity check failed: ${file}`);
    }
  }

  return manifestHash;
}

function validateSignatureDocument(signatureDoc) {
  if (!signatureDoc || typeof signatureDoc !== "object" || Array.isArray(signatureDoc)) {
    throw new Error("Signature document must be a JSON object");
  }

  if (signatureDoc.schema !== "grant-audit-packet-signature-v1") {
    throw new Error(`Invalid signature schema: ${signatureDoc.schema}`);
  }

  if (signatureDoc.signature_algorithm !== "ed25519") {
    throw new Error(`Invalid signature algorithm: ${signatureDoc.signature_algorithm}`);
  }

  if (!/^[a-f0-9]{64}$/.test(signatureDoc.packet_manifest_hash)) {
    throw new Error("packet_manifest_hash must be sha256 hex");
  }

  if (
    !signatureDoc.signer ||
    typeof signatureDoc.signer !== "object" ||
    Array.isArray(signatureDoc.signer)
  ) {
    throw new Error("signer must be an object");
  }

  if (typeof signatureDoc.signer.key_id !== "string" || !signatureDoc.signer.key_id.trim()) {
    throw new Error("signer.key_id must be a non-empty string");
  }

  if (
    typeof signatureDoc.signer.public_key_pem !== "string" ||
    !signatureDoc.signer.public_key_pem.trim()
  ) {
    throw new Error("signer.public_key_pem must be a non-empty string");
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureDoc.signature)) {
    throw new Error("signature must be base64");
  }

  if (!Date.parse(signatureDoc.signed_at)) {
    throw new Error("signed_at must be a valid ISO-8601 timestamp");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.archivePath)) {
    throw new Error(`Audit packet archive not found: ${args.archivePath}`);
  }

  if (!fs.existsSync(args.signaturePath)) {
    throw new Error(`Signature file not found: ${args.signaturePath}`);
  }

  if (args.expectedPublicKeyPath && !fs.existsSync(args.expectedPublicKeyPath)) {
    throw new Error(`Expected public key file not found: ${args.expectedPublicKeyPath}`);
  }

  const entries = listArchiveEntries(args.archivePath);
  const manifestHash = verifyPacketIntegrity(args.archivePath, entries);

  const signatureDoc = JSON.parse(
    fs.readFileSync(args.signaturePath, "utf8")
  );

  validateSignatureDocument(signatureDoc);

  if (signatureDoc.packet_manifest_hash !== manifestHash) {
    throw new Error(
      `Packet manifest hash mismatch: signature=${signatureDoc.packet_manifest_hash} archive=${manifestHash}`
    );
  }

  if (args.expectedKeyId && signatureDoc.signer.key_id !== args.expectedKeyId) {
    throw new Error(
      `Signer key_id mismatch: expected=${args.expectedKeyId} actual=${signatureDoc.signer.key_id}`
    );
  }

  if (args.expectedPublicKeyPath) {
    const expectedKey = fs.readFileSync(args.expectedPublicKeyPath, "utf8").trim();
    const actualKey = signatureDoc.signer.public_key_pem.trim();

    if (expectedKey !== actualKey) {
      throw new Error("Signer public key mismatch");
    }
  }

  const payload = {
    schema: signatureDoc.schema,
    signature_algorithm: signatureDoc.signature_algorithm,
    packet_manifest_hash: signatureDoc.packet_manifest_hash,
    signer: signatureDoc.signer,
    signed_at: signatureDoc.signed_at
  };

  const payloadBytes = Buffer.from(canonicalize(payload), "utf8");
  const signatureBytes = Buffer.from(signatureDoc.signature, "base64");
  const publicKey = crypto.createPublicKey(signatureDoc.signer.public_key_pem);

  const verified = crypto.verify(
    null,
    payloadBytes,
    publicKey,
    signatureBytes
  );

  if (!verified) {
    throw new Error("Signature verification failed");
  }

  console.log("Signature verification successful");
  console.log(
    JSON.stringify(
      {
        ok: true,
        schema: signatureDoc.schema,
        signature_algorithm: signatureDoc.signature_algorithm,
        signer_key_id: signatureDoc.signer.key_id,
        packet_manifest_hash: manifestHash,
        signed_at: signatureDoc.signed_at,
        signature_verified: true,
        packet_integrity_verified: true,
        signer_provenance_verified: Boolean(
          args.expectedKeyId || args.expectedPublicKeyPath
        )
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
