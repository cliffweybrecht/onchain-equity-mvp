#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function usage() {
  console.error(`
Usage:
  node scripts/ops/grants/append-audit-attestation.mjs \
    --attestations <file> \
    --packet-manifest-hash <sha256> \
    --signer-key-id <id> \
    --private-key <pem> \
    --public-key <pem> \
    [--signer-name <name>] \
    [--signer-role <role>]
`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) usage();
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) usage();
    out[key] = value;
    i += 1;
  }
  return out;
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

function ensureHex64(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value || "")) {
    throw new Error(`${label} must be a lowercase 64-char hex sha256`);
  }
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

function main() {
  const args = parseArgs(process.argv);

  const attestationsFile = args["attestations"];
  const packetManifestHash = args["packet-manifest-hash"];
  const signerKeyId = args["signer-key-id"];
  const privateKeyPath = args["private-key"];
  const publicKeyPath = args["public-key"];
  const signerName = args["signer-name"] || "";
  const signerRole = args["signer-role"] || "";

  if (!attestationsFile || !packetManifestHash || !signerKeyId || !privateKeyPath || !publicKeyPath) {
    usage();
  }

  ensureHex64(packetManifestHash, "packet-manifest-hash");

  const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
  const publicKeyPem = fs.readFileSync(publicKeyPath, "utf8");

  const existing = readJsonIfExists(attestationsFile);

  const doc = existing || {
    schema: "grant-audit-attestations-v1",
    version: "1.0.0",
    packet_manifest_hash: packetManifestHash,
    attestations: []
  };

  if (doc.schema !== "grant-audit-attestations-v1") {
    throw new Error(`Unexpected attestations schema: ${doc.schema}`);
  }

  if (doc.packet_manifest_hash !== packetManifestHash) {
    throw new Error("packet manifest hash mismatch with existing attestations file");
  }

  if (doc.attestations.some((a) => a.signer_key_id === signerKeyId)) {
    throw new Error(`attestation already exists for signer_key_id=${signerKeyId}`);
  }

  const signedAt = new Date().toISOString();

  const signedPayload = {
    type: "grant-audit-packet-attestation-v1",
    packet_manifest_hash: packetManifestHash,
    signer_key_id: signerKeyId,
    signed_at: signedAt
  };

  const payloadBytes = Buffer.from(canonicalize(signedPayload), "utf8");
  const signature = crypto.sign(null, payloadBytes, privateKeyPem).toString("base64");

  const verified = crypto.verify(
    null,
    payloadBytes,
    publicKeyPem,
    Buffer.from(signature, "base64")
  );

  if (!verified) {
    throw new Error("self-verification failed after signing");
  }

  const attestation = {
    schema: "grant-audit-packet-attestation-v1",
    signature_algorithm: "ed25519",
    signer_key_id: signerKeyId,
    signed_at: signedAt,
    signed_payload: signedPayload,
    signature,
    signer: {
      key_id: signerKeyId,
      ...(signerName ? { name: signerName } : {}),
      ...(signerRole ? { role: signerRole } : {}),
      public_key_pem: publicKeyPem
    }
  };

  doc.attestations.push(attestation);
  writeJson(attestationsFile, doc);

  console.log(JSON.stringify({
    ok: true,
    schema: doc.schema,
    packet_manifest_hash: doc.packet_manifest_hash,
    appended_signer_key_id: signerKeyId,
    total_attestations: doc.attestations.length
  }, null, 2));
}

main();
