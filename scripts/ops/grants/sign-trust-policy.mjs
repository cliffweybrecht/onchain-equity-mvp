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

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = parseArgs(process.argv);

const trustPolicyPath = args["trust-policy"];
const privateKeyPath = args["private-key"];
const signerKeyId = args["signer-key-id"];
const outPath = args["out"];

if (!trustPolicyPath || !privateKeyPath || !signerKeyId || !outPath) {
  fail(
    "Usage: node scripts/ops/grants/sign-trust-policy.mjs " +
      "--trust-policy <path> --private-key <path> --signer-key-id <id> --out <path>"
  );
}

const trustPolicy = readJson(trustPolicyPath);
const canonicalTrustPolicy = canonicalize(trustPolicy);
const trustPolicyBytes = Buffer.from(canonicalTrustPolicy, "utf8");
const trustPolicySha256 = sha256Hex(trustPolicyBytes);

if (!trustPolicy.packet_manifest_hash || !/^[a-f0-9]{64}$/.test(trustPolicy.packet_manifest_hash)) {
  fail("trust-policy.json must contain packet_manifest_hash as a 64-char lowercase hex sha256");
}

const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
const privateKey = crypto.createPrivateKey(privateKeyPem);

const signature = crypto.sign(null, trustPolicyBytes, privateKey).toString("base64");

const output = {
  schema: "grant-audit-trust-policy-signature-v1",
  algorithm: "Ed25519",
  signer_key_id: signerKeyId,
  signed_at: new Date().toISOString(),
  packet_manifest_hash: trustPolicy.packet_manifest_hash,
  trust_policy_sha256: trustPolicySha256,
  trust_policy_path: trustPolicyPath,
  signature_base64: signature
};

ensureDir(outPath);
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

console.log(JSON.stringify(output, null, 2));
