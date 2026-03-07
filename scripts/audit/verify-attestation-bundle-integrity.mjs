#!/usr/bin/env node
import fs from "node:fs";
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

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(message, details = {}) {
  const output = {
    ok: false,
    error: message,
    ...details
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(1);
}

const args = parseArgs(process.argv);

const manifestPath = args["manifest"];
const trustPolicyPath = args["trust-policy"];
const trustPolicySignaturePath = args["trust-policy-signature"];
const publicKeyPath = args["public-key"];

if (!manifestPath || !trustPolicyPath || !trustPolicySignaturePath || !publicKeyPath) {
  fail(
    "Usage: node scripts/audit/verify-attestation-bundle-integrity.mjs " +
      "--manifest <path> --trust-policy <path> --trust-policy-signature <path> --public-key <path>"
  );
}

const manifest = readJson(manifestPath);
const trustPolicy = readJson(trustPolicyPath);
const trustPolicySignature = readJson(trustPolicySignaturePath);

if (manifest.schema !== "grant-audit-attestation-bundle-integrity-v1") {
  fail("Unexpected integrity manifest schema", { schema: manifest.schema });
}

if (trustPolicySignature.schema !== "grant-audit-trust-policy-signature-v1") {
  fail("Unexpected trust policy signature schema", { schema: trustPolicySignature.schema });
}

const fileChecks = manifest.files.map((entry) => {
  const actualSha256 = sha256File(entry.path);
  return {
    label: entry.label,
    path: entry.path,
    expected_sha256: entry.sha256,
    actual_sha256: actualSha256,
    ok: actualSha256 === entry.sha256
  };
});

const failedFiles = fileChecks.filter((x) => !x.ok);
if (failedFiles.length > 0) {
  fail("Bundle file hash mismatch detected", { file_checks: fileChecks });
}

if (manifest.packet_manifest_hash !== trustPolicy.packet_manifest_hash) {
  fail("Manifest packet_manifest_hash does not match trust policy", {
    manifest_packet_manifest_hash: manifest.packet_manifest_hash,
    trust_policy_packet_manifest_hash: trustPolicy.packet_manifest_hash
  });
}

const canonicalTrustPolicy = canonicalize(trustPolicy);
const trustPolicyBytes = Buffer.from(canonicalTrustPolicy, "utf8");
const trustPolicySha256 = sha256Hex(trustPolicyBytes);

if (trustPolicySignature.packet_manifest_hash !== trustPolicy.packet_manifest_hash) {
  fail("Trust policy signature packet_manifest_hash does not match trust policy", {
    signature_packet_manifest_hash: trustPolicySignature.packet_manifest_hash,
    trust_policy_packet_manifest_hash: trustPolicy.packet_manifest_hash
  });
}

if (trustPolicySignature.trust_policy_sha256 !== trustPolicySha256) {
  fail("Trust policy signature sha256 does not match current trust policy", {
    signature_trust_policy_sha256: trustPolicySignature.trust_policy_sha256,
    actual_trust_policy_sha256: trustPolicySha256
  });
}

const publicKeyPem = fs.readFileSync(publicKeyPath, "utf8");
const publicKey = crypto.createPublicKey(publicKeyPem);

const signatureValid = crypto.verify(
  null,
  trustPolicyBytes,
  publicKey,
  Buffer.from(trustPolicySignature.signature_base64, "base64")
);

if (!signatureValid) {
  fail("Trust policy signature verification failed", {
    signer_key_id: trustPolicySignature.signer_key_id
  });
}

const output = {
  ok: true,
  schema: "grant-audit-attestation-bundle-integrity-verification-v1",
  packet_manifest_hash: trustPolicy.packet_manifest_hash,
  signed_trust_policy_verified: true,
  trust_policy_signer_key_id: trustPolicySignature.signer_key_id,
  trust_policy_signed_at: trustPolicySignature.signed_at,
  trust_policy_sha256: trustPolicySha256,
  file_checks: fileChecks
};

console.log(JSON.stringify(output, null, 2));
