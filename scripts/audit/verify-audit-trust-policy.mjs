#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";

function usage() {
  console.error(`
Usage:
  node scripts/audit/verify-audit-trust-policy.mjs \
    --attestations <file> \
    --policy <file>
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

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const args = parseArgs(process.argv);
  const attestationsPath = args["attestations"];
  const policyPath = args["policy"];

  if (!attestationsPath || !policyPath) usage();

  const attestationsDoc = loadJson(attestationsPath);
  const policy = loadJson(policyPath);

  ensure(attestationsDoc.schema === "grant-audit-attestations-v1", "invalid attestations schema");
  ensure(policy.schema === "grant-audit-trust-policy-v1", "invalid trust policy schema");
  ensure(
    attestationsDoc.packet_manifest_hash === policy.packet_manifest_hash,
    "packet manifest hash mismatch between attestations and trust policy"
  );

  const trustedByKeyId = new Map();
  for (const signer of policy.trusted_signers) {
    trustedByKeyId.set(signer.key_id, signer);
  }

  const verifiedTrusted = [];
  const rejected = [];
  const seenValidSignerIds = new Set();

  for (const att of attestationsDoc.attestations) {
    const trusted = trustedByKeyId.get(att.signer_key_id);

    if (!trusted) {
      rejected.push({
        signer_key_id: att.signer_key_id,
        reason: "untrusted_signer"
      });
      continue;
    }

    if (att.signature_algorithm !== "ed25519") {
      rejected.push({
        signer_key_id: att.signer_key_id,
        reason: "unsupported_signature_algorithm"
      });
      continue;
    }

    if (att.signed_payload.packet_manifest_hash !== policy.packet_manifest_hash) {
      rejected.push({
        signer_key_id: att.signer_key_id,
        reason: "packet_manifest_hash_mismatch"
      });
      continue;
    }

    if (att.signed_payload.signer_key_id !== att.signer_key_id) {
      rejected.push({
        signer_key_id: att.signer_key_id,
        reason: "signer_key_id_mismatch"
      });
      continue;
    }

    if (trusted.public_key_pem.trim() !== att.signer.public_key_pem.trim()) {
      rejected.push({
        signer_key_id: att.signer_key_id,
        reason: "public_key_mismatch_with_policy"
      });
      continue;
    }

    const payloadBytes = Buffer.from(canonicalize(att.signed_payload), "utf8");
    const ok = crypto.verify(
      null,
      payloadBytes,
      trusted.public_key_pem,
      Buffer.from(att.signature, "base64")
    );

    if (!ok) {
      rejected.push({
        signer_key_id: att.signer_key_id,
        reason: "signature_verification_failed"
      });
      continue;
    }

    if (!seenValidSignerIds.has(att.signer_key_id)) {
      seenValidSignerIds.add(att.signer_key_id);
      verifiedTrusted.push({
        signer_key_id: att.signer_key_id,
        signed_at: att.signed_at
      });
    }
  }

  const requiredSigners = policy.trusted_signers
    .filter((s) => s.required === true)
    .map((s) => s.key_id);

  const missingRequiredSigners = requiredSigners.filter((keyId) => !seenValidSignerIds.has(keyId));
  const thresholdMet = verifiedTrusted.length >= policy.threshold;

  const result = {
    ok: thresholdMet && missingRequiredSigners.length === 0,
    schema: "grant-audit-trust-policy-verification-v1",
    packet_manifest_hash: policy.packet_manifest_hash,
    threshold: policy.threshold,
    valid_trusted_signature_count: verifiedTrusted.length,
    threshold_met: thresholdMet,
    missing_required_signers: missingRequiredSigners,
    verified_trusted_signers: verifiedTrusted,
    rejected_attestations: rejected
  };

  if (!result.ok) {
    console.error("Trust policy verification failed");
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log("Trust policy verification successful");
  console.log(JSON.stringify(result, null, 2));
}

main();
