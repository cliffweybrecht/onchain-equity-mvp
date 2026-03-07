#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function ensure(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required argument: ${label}`);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256HexFromBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256HexFromFile(filePath) {
  return sha256HexFromBuffer(fs.readFileSync(filePath));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${canonicalize(value)}\n`);
}

const args = parseArgs(process.argv);

const output = ensure(args.output, "--output");
const packetManifestHash = ensure(args["packet-manifest-hash"], "--packet-manifest-hash");
const repo = ensure(args.repo, "--repo");
const branch = ensure(args.branch, "--branch");
const commit = ensure(args.commit, "--commit");
const network = ensure(args.network, "--network");
const chainId = Number(ensure(args["chain-id"], "--chain-id"));
const boundBlockNumber = Number(ensure(args["bound-block-number"], "--bound-block-number"));
const boundBlockHash = ensure(args["bound-block-hash"], "--bound-block-hash");

const trustPolicySignaturePath = ensure(
  args["trust-policy-signature"],
  "--trust-policy-signature"
);
const attestationBundleIntegrityPath = ensure(
  args["attestation-bundle-integrity"],
  "--attestation-bundle-integrity"
);

const contractsHash = ensure(args["contracts-hash"], "--contracts-hash");
const policySetHash = ensure(args["policy-set-hash"], "--policy-set-hash");
const issuerAdminSetHash = ensure(args["issuer-admin-set-hash"], "--issuer-admin-set-hash");
const grantsStateHash = ensure(args["grants-state-hash"], "--grants-state-hash");

const createdAt = args["created-at"] || new Date().toISOString();
const status = args.status || "active";
const reason = args.reason || "Current canonical packet";
const supersedes = args["supersedes-packet-manifest-hash"] || "";
const supersededBy = args["superseded-by-packet-manifest-hash"] || "";
const revokedBy = args["revoked-by-packet-manifest-hash"] || "";

const maxAgeSeconds = Number(args["max-age-seconds"] || 604800);
const maxBlockDrift = Number(args["max-block-drift"] || 50000);

const anchorStatus = args["anchor-status"] || "not_anchored";
const anchorChain = args["anchor-chain"] || "";
const anchorTxHash = args["anchor-tx-hash"] || "";
const anchorReference = args["anchor-reference"] || "";

const manifest = {
  schema: "grant-audit-transparency-manifest-v1",
  version: "1.0.0",
  created_at: createdAt,
  packet_manifest_hash: packetManifestHash,
  git: {
    repo,
    branch,
    commit
  },
  network: {
    name: network,
    chain_id: chainId
  },
  state_binding: {
    bound_block_number: boundBlockNumber,
    bound_block_hash: boundBlockHash
  },
  artifacts: {
    trust_policy_signature: {
      path: trustPolicySignaturePath,
      sha256: sha256HexFromFile(trustPolicySignaturePath)
    },
    attestation_bundle_integrity: {
      path: attestationBundleIntegrityPath,
      sha256: sha256HexFromFile(attestationBundleIntegrityPath)
    }
  },
  fingerprints: {
    contracts_hash: contractsHash,
    policy_set_hash: policySetHash,
    issuer_admin_set_hash: issuerAdminSetHash,
    grants_state_hash: grantsStateHash
  },
  freshness_policy: {
    max_age_seconds: maxAgeSeconds,
    max_block_drift: maxBlockDrift,
    invalidate_on_newer_packet: true,
    invalidate_on_contracts_hash_change: true,
    invalidate_on_policy_hash_change: true,
    invalidate_on_admin_set_hash_change: true,
    invalidate_on_grants_state_hash_change: true
  },
  anchoring: {
    anchor_status: anchorStatus,
    anchor_chain: anchorChain,
    anchor_tx_hash: anchorTxHash,
    anchor_reference: anchorReference
  },
  lifecycle: {
    schema: "grant-audit-packet-lifecycle-v1",
    status,
    declared_at: createdAt,
    reason,
    supersedes_packet_manifest_hash: supersedes,
    superseded_by_packet_manifest_hash: supersededBy,
    revoked_by_packet_manifest_hash: revokedBy
  }
};

writeJson(output, manifest);

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: "grant-audit-transparency-manifest-build-v1",
      output,
      packet_manifest_hash: packetManifestHash,
      lifecycle_status: status
    },
    null,
    2
  )
);
