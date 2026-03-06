#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import * as tar from "tar";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
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

function requireArg(args, key) {
  if (!args[key]) {
    throw new Error(`Missing required --${key}`);
  }
  return args[key];
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeRel(filePath) {
  return filePath.split(path.sep).join("/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function listFilesRecursive(dirPath) {
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

function copyJsonToPacket(srcPath, destPath) {
  const value = readJson(srcPath);
  writeJson(destPath, value);
}

function shouldIncludeInSha256Manifest(relPath) {
  return relPath !== "packet.json" && relPath !== "packet/sha256-manifest.json";
}

function buildSha256Manifest(packetRoot) {
  const allFiles = listFilesRecursive(packetRoot);
  const files = [];

  for (const fullPath of allFiles) {
    const relPath = normalizeRel(path.relative(packetRoot, fullPath));
    if (!shouldIncludeInSha256Manifest(relPath)) continue;

    files.push({
      path: relPath,
      sha256: sha256File(fullPath)
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schema: "sha256-manifest-v1",
    generated_at: new Date().toISOString(),
    files
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const repo = requireArg(args, "repo");
  const branch = requireArg(args, "branch");
  const commit = requireArg(args, "commit");
  const network = requireArg(args, "network");

  const outFile = args.out || "grant-audit-packet.tgz";
  const chainId =
    args["chain-id"] != null
      ? Number(args["chain-id"])
      : args.chainId != null
        ? Number(args.chainId)
        : 84532;
  const rpcHint = args["rpc-hint"] || args.rpcHint || "";

  const grantsLedgerIndexSrc = requireArg(args, "grants-ledger-index");
  const grantsRegistrySnapshotSrc = requireArg(args, "grants-registry-snapshot");
  const merkleRootSrc = requireArg(args, "merkle-root");
  const stateSnapshotSrc = requireArg(args, "state-snapshot");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grant-audit-packet-"));
  const packetRoot = tmpRoot;
  const packetDir = path.join(packetRoot, "packet");
  const inputsDir = path.join(packetDir, "inputs");
  const artifactsDir = path.join(packetDir, "artifacts");

  ensureDir(inputsDir);
  ensureDir(artifactsDir);

  copyJsonToPacket(
    grantsLedgerIndexSrc,
    path.join(inputsDir, "grants-index.json")
  );
  copyJsonToPacket(
    grantsRegistrySnapshotSrc,
    path.join(inputsDir, "grants-registry-snapshot.json")
  );
  copyJsonToPacket(
    merkleRootSrc,
    path.join(inputsDir, "grants-merkle-root.json")
  );
  copyJsonToPacket(
    stateSnapshotSrc,
    path.join(inputsDir, "grants-state-snapshot.json")
  );

  const packetJsonPath = path.join(packetRoot, "packet.json");
  const sha256ManifestPath = path.join(packetDir, "sha256-manifest.json");

  const packetMetadata = {
    schema: "grant-audit-packet-v1",
    packet_version: "1.0.0",
    created_at: new Date().toISOString(),
    git: {
      repo,
      branch,
      commit
    },
    network: {
      name: network,
      chain_id: chainId,
      rpc_hint: rpcHint
    },
    contracts: {},
    inputs: {
      grants_ledger_index: "packet/inputs/grants-index.json",
      grants_registry_snapshot: "packet/inputs/grants-registry-snapshot.json",
      merkle_root: "packet/inputs/grants-merkle-root.json",
      state_snapshot: "packet/inputs/grants-state-snapshot.json"
    },
    artifacts: {
      verifications: [],
      notes: [
        "Self-contained audit packet",
        "Integrity verified by sha256 manifest"
      ]
    },
    integrity: {
      sha256_manifest: "packet/sha256-manifest.json",
      sha256_manifest_hash: ""
    }
  };

  writeJson(packetJsonPath, packetMetadata);

  const sha256Manifest = buildSha256Manifest(packetRoot);
  writeJson(sha256ManifestPath, sha256Manifest);

  const finalManifestHash = sha256File(sha256ManifestPath);

  packetMetadata.integrity.sha256_manifest_hash = finalManifestHash;
  writeJson(packetJsonPath, packetMetadata);

  const outputPath = path.resolve(process.cwd(), outFile);

  await tar.create(
    {
      gzip: true,
      cwd: packetRoot,
      file: outputPath
    },
    ["packet.json", "packet"]
  );

  console.log(`Built audit packet: ${outputPath}`);
  console.log(`Manifest: packet/sha256-manifest.json`);
  console.log(`Manifest hash: ${finalManifestHash}`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
