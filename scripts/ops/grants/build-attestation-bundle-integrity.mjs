#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function sha256File(filePath) {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = parseArgs(process.argv);

const attestationsPath = args["attestations"];
const trustPolicyPath = args["trust-policy"];
const trustPolicySignaturePath = args["trust-policy-signature"];
const outPath = args["out"];

if (!attestationsPath || !trustPolicyPath || !trustPolicySignaturePath || !outPath) {
  fail(
    "Usage: node scripts/ops/grants/build-attestation-bundle-integrity.mjs " +
      "--attestations <path> --trust-policy <path> --trust-policy-signature <path> --out <path>"
  );
}

const trustPolicy = readJson(trustPolicyPath);

if (!trustPolicy.packet_manifest_hash || !/^[a-f0-9]{64}$/.test(trustPolicy.packet_manifest_hash)) {
  fail("trust-policy.json must contain packet_manifest_hash as a 64-char lowercase hex sha256");
}

const manifest = {
  schema: "grant-audit-attestation-bundle-integrity-v1",
  created_at: new Date().toISOString(),
  packet_manifest_hash: trustPolicy.packet_manifest_hash,
  files: [
    {
      label: "attestations",
      path: attestationsPath,
      sha256: sha256File(attestationsPath)
    },
    {
      label: "trust_policy",
      path: trustPolicyPath,
      sha256: sha256File(trustPolicyPath)
    },
    {
      label: "trust_policy_signature",
      path: trustPolicySignaturePath,
      sha256: sha256File(trustPolicySignaturePath)
    }
  ]
};

ensureDir(outPath);
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(JSON.stringify(manifest, null, 2));
