#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { createPublicClient, http, recoverAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { getAddress } from "viem";

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

function sha256Hex(inputUtf8) {
  return crypto.createHash("sha256").update(inputUtf8, "utf8").digest("hex");
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");
}

async function main() {
  const args = parseArgs(process.argv);

  const rpc = args.rpc || process.env.RPC_URL;
  const network = args.network || "base-sepolia";

  const attestationPath = args.attestation || "manifests/grants/registry-attestation.json";
  const registryPath = args.registry || "manifests/grants/registry.json";
  const merkleRootPath = args["merkle-root"] || args.merkleRoot || "manifests/grants/merkle-root.json";

  const evidenceDir = args.evidence; // optional: if provided, will write a verification report

  if (!rpc) throw new Error("Missing --rpc or RPC_URL env var.");

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpc)
  });

  const att = readJson(attestationPath);
  const registry = readJson(registryPath);
  const merkleRootObj = readJson(merkleRootPath);

  const merkleRoot =
    merkleRootObj.merkleRoot ||
    merkleRootObj.root ||
    merkleRootObj.value ||
    merkleRootObj.merkle_root;

  const problems = [];

  if (att.schemaVersion !== "grant-registry-attestation-v1") {
    problems.push(`schemaVersion mismatch: ${att.schemaVersion}`);
  }
  if (att.network !== network) {
    problems.push(`network mismatch: attestation=${att.network} expected=${network}`);
  }

  // Recompute registry hash
  const registryCanon = stableStringify(registry);
  const registryHash = "0x" + sha256Hex(registryCanon);

  if (att.registryHash !== registryHash) {
    problems.push(`registryHash mismatch: attestation=${att.registryHash} computed=${registryHash}`);
  }

  // Check merkle root matches current artifact
  if (typeof merkleRoot !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(merkleRoot)) {
    problems.push(`invalid merkleRoot in ${merkleRootPath}`);
  } else if (att.merkleRoot !== merkleRoot) {
    problems.push(`merkleRoot mismatch: attestation=${att.merkleRoot} file=${merkleRoot}`);
  }

  // Verify block timestamp for referenced block
  const blockNumber = BigInt(att.blockNumber);
  const block = await client.getBlock({ blockNumber });
  const ts = Number(block.timestamp);
  if (att.timestamp !== ts) {
    problems.push(`timestamp mismatch at block ${att.blockNumber}: attestation=${att.timestamp} chain=${ts}`);
  }

  // Verify signature: recover address from raw-hash signature
  let recovered = null;
  try {
    recovered = await recoverAddress({
      hash: att.registryHash,
      signature: att.signature
    });
  } catch (e) {
    problems.push(`signature recovery failed: ${e?.message || String(e)}`);
  }

  if (recovered) {
    const rec = getAddress(recovered);
    const attestor = getAddress(att.attestor);
    if (rec !== attestor) {
      problems.push(`attestor mismatch: recovered=${rec} attestor=${attestor}`);
    }
  }

  const ok = problems.length === 0;

  const report = {
    ok,
    checkedAt: Math.floor(Date.now() / 1000),
    network,
    attestationPath,
    registryPath,
    merkleRootPath,
    computed: {
      registryHash,
      merkleRoot,
      blockTimestamp: ts,
      recoveredAttestor: recovered ? getAddress(recovered) : null
    },
    problems
  };

  if (evidenceDir) {
    ensureDir(evidenceDir);
    writeJson(path.join(evidenceDir, "verify-report.json"), report);
    fs.writeFileSync(path.join(evidenceDir, "registry.canonical.json"), registryCanon + "\n");
  }

  if (!ok) {
    console.error("❌ Registry attestation verification FAILED");
    for (const p of problems) console.error("-", p);
    process.exit(1);
  }

  console.log("✅ Registry attestation verification OK");
  console.log("attestor:", getAddress(att.attestor));
  console.log("registryHash:", registryHash);
  console.log("merkleRoot:", merkleRoot);
  console.log("blockNumber:", att.blockNumber, "timestamp:", ts);
}

main().catch((err) => {
  console.error("❌ verify-registry-attestation failed:");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
