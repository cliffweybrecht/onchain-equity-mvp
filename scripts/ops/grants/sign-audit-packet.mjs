#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
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
  node scripts/ops/grants/sign-audit-packet.mjs <audit-packet.tgz> \\
    --private-key <ed25519-private-key.pem> \\
    --key-id <signer-key-id> \\
    [--signed-at <ISO-8601>] \\
    [--out <packet-signature.json>]
`);
}

function parseArgs(argv) {
  if (argv.length < 1) {
    usage();
    process.exit(1);
  }

  const args = {
    archivePath: argv[0],
    privateKeyPath: null,
    keyId: null,
    signedAt: new Date().toISOString(),
    outPath: "packet-signature.json"
  };

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--private-key") {
      args.privateKeyPath = argv[++i];
    } else if (arg === "--key-id") {
      args.keyId = argv[++i];
    } else if (arg === "--signed-at") {
      args.signedAt = argv[++i];
    } else if (arg === "--out") {
      args.outPath = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.privateKeyPath) {
    throw new Error("Missing --private-key");
  }

  if (!args.keyId) {
    throw new Error("Missing --key-id");
  }

  if (!Date.parse(args.signedAt)) {
    throw new Error(`Invalid --signed-at value: ${args.signedAt}`);
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

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.archivePath)) {
    throw new Error(`Audit packet archive not found: ${args.archivePath}`);
  }

  if (!fs.existsSync(args.privateKeyPath)) {
    throw new Error(`Private key not found: ${args.privateKeyPath}`);
  }

  const entries = listArchiveEntries(args.archivePath);
  const manifestHash = verifyPacketIntegrity(args.archivePath, entries);

  const privateKey = crypto.createPrivateKey(
    fs.readFileSync(args.privateKeyPath, "utf8")
  );

  const publicKeyPem = crypto
    .createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();

  const payload = {
    schema: "grant-audit-packet-signature-v1",
    signature_algorithm: "ed25519",
    packet_manifest_hash: manifestHash,
    signer: {
      key_id: args.keyId,
      public_key_pem: publicKeyPem
    },
    signed_at: args.signedAt
  };

  const payloadBytes = Buffer.from(canonicalize(payload), "utf8");

  const signature = crypto
    .sign(null, payloadBytes, privateKey)
    .toString("base64");

  const signatureDoc = {
    ...payload,
    signature
  };

  ensureDirForFile(args.outPath);

  fs.writeFileSync(
    args.outPath,
    `${canonicalize(signatureDoc)}\n`,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        schema: signatureDoc.schema,
        signature_algorithm: signatureDoc.signature_algorithm,
        packet_manifest_hash: signatureDoc.packet_manifest_hash,
        signer_key_id: signatureDoc.signer.key_id,
        signed_at: signatureDoc.signed_at,
        output: args.outPath
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
