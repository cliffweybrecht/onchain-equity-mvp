#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { createPublicClient, http, getAddress, signatureToHex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount, sign } from "viem/accounts";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

// Deterministic canonical JSON: recursively sorts object keys; preserves array order.
function canonicalize(value) {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const out = {};
    for (const k of keys) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}

function stableStringify(obj) {
  return JSON.stringify(canonicalize(obj));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

// BigInt-safe JSON writer (evidence hygiene)
function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  const replacer = (_k, v) => (typeof v === "bigint" ? v.toString() : v);
  fs.writeFileSync(filePath, JSON.stringify(obj, replacer, 2) + "\n");
}

function normalizePrivateKey(maybeKey) {
  if (!maybeKey) return null;

  let k = String(maybeKey).trim();
  if (!k) return null;

  if (!k.startsWith("0x")) k = `0x${k}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error(
      `Invalid private key format. Expected 0x + 64 hex chars, got length=${k.length}`
    );
  }
  return k;
}

function pickMerkleRoot(obj, file) {
  const root =
    obj?.merkleRoot ??
    obj?.root ??
    obj?.value ??
    obj?.merkle_root;

  if (typeof root !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(root)) {
    throw new Error(`Could not find a valid 0x32-byte merkleRoot in ${file}`);
  }
  return root;
}

async function main() {
  const args = parseArgs(process.argv);

  const network = args.network || "base-sepolia";
  const rpc = args.rpc || process.env.RPC_URL;

  const blockNumberStr = args["block-number"] || args.blockNumber;

  const registryPath = args.registry || "manifests/grants/registry.json";
  const merkleRootPath =
    args["merkle-root"] || args.merkleRoot || "manifests/grants/merkle-root.json";

  const outPath = args.out || "manifests/grants/registry-attestation.json";
  const evidenceRoot =
    args.evidence || "evidence/phase-7.4/grants-registry-attestation";

  // Private key precedence: CLI > ATTESTOR_PRIVATE_KEY > PRIVATE_KEY
  const rawPk =
    args["private-key"] ||
    process.env.ATTESTOR_PRIVATE_KEY ||
    process.env.PRIVATE_KEY;

  const privateKey = normalizePrivateKey(rawPk);

  if (!rpc) throw new Error("Missing --rpc or RPC_URL env var.");
  if (!blockNumberStr) throw new Error("Missing --block-number.");
  if (!privateKey) {
    throw new Error(
      "Missing --private-key or ATTESTOR_PRIVATE_KEY (or PRIVATE_KEY) env var."
    );
  }

  const blockNumber = Number(blockNumberStr);
  if (!Number.isInteger(blockNumber) || blockNumber < 0) {
    throw new Error("--block-number must be a non-negative integer.");
  }

  const runId = args.runId || String(Date.now());
  const runDir = path.join(evidenceRoot, runId);
  ensureDir(runDir);

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpc),
  });

  const registry = readJson(registryPath);
  const merkleRootObj = readJson(merkleRootPath);
  const merkleRoot = pickMerkleRoot(merkleRootObj, merkleRootPath);

  // registryHash = sha256(canonical_json(registry))
  const registryCanon = stableStringify(registry);
  const registryHash = `0x${sha256Hex(registryCanon)}`;

  // timestamp from pinned block
  const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
  const timestamp = Number(block.timestamp);

  // attestor + signature over registryHash (raw 32-byte hash)
  const account = privateKeyToAccount(privateKey);
  const attestor = getAddress(account.address);

  const sig = await sign({
    hash: registryHash,
    privateKey,
  });

  const signature = signatureToHex(sig);

  const attestation = {
    $schema: "../../schemas/grant-registry-attestation-v1.schema.json",
    schemaVersion: "grant-registry-attestation-v1",
    registryHash,
    merkleRoot,
    network,
    blockNumber,
    timestamp,
    attestor,
    signature,
  };

  // Write outputs
  writeJson(outPath, attestation);

  // Evidence capture
  writeJson(path.join(runDir, "registry.json"), registry);
  writeJson(path.join(runDir, "merkle-root.json"), merkleRootObj);
  writeJson(path.join(runDir, "registry-attestation.json"), attestation);

  // Audit-friendly inputs
  fs.writeFileSync(path.join(runDir, "registry.canonical.json"), registryCanon + "\n");
  fs.writeFileSync(path.join(runDir, "registry.sha256.txt"), registryHash + "\n");

  console.log("✅ Built grant registry attestation");
  console.log("out:", outPath);
  console.log("evidence:", runDir);
  console.log("registryHash:", registryHash);
  console.log("merkleRoot:", merkleRoot);
  console.log("blockNumber:", blockNumber, "timestamp:", timestamp);
  console.log("attestor:", attestor);
  console.log("signature:", signature);
}

main().catch((err) => {
  console.error("❌ build-registry-attestation failed:");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
