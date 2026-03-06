#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as tar from "tar";
import {
  ensureDir,
  readJson,
  writeCanonicalJson,
  sha256Buffer,
  sha256File,
  normalizePacketPath,
  assertSafeArchiveEntries,
  assertDeterministicallySortedPaths,
  assertRequiredPacketFilesExist,
  assertRequiredSourceFilesExist,
  collectPacketFiles,
  buildSha256Manifest
} from "../../lib/audit-packet-structure.mjs";

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

function copyJsonToPacket(srcPath, destPath) {
  const value = readJson(srcPath);
  writeCanonicalJson(destPath, value);
}

function buildManifestFromStagingRoot(stagingRoot) {
  const packetFiles = collectPacketFiles(stagingRoot);

  const manifestEntries = packetFiles
    .filter(
      (relPath) =>
        relPath !== "packet/sha256-manifest.json" &&
        relPath !== "packet/audit-packet.json"
    )
    .map((relPath) => ({
      path: relPath,
      sha256: sha256File(path.join(stagingRoot, relPath))
    }));

  return buildSha256Manifest(manifestEntries);
}

async function main() {
  const args = parseArgs(process.argv);

  const repo = requireArg(args, "repo");
  const branch = requireArg(args, "branch");
  const commit = requireArg(args, "commit");
  const network = requireArg(args, "network");

  const outFile = args.output || args.out || "grant-audit-packet.tgz";
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

  assertRequiredSourceFilesExist([
    grantsLedgerIndexSrc,
    grantsRegistrySnapshotSrc,
    merkleRootSrc,
    stateSnapshotSrc
  ]);

  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grant-audit-packet-"));
  const packetDir = path.join(stagingRoot, "packet");
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

  const auditPacketPath = path.join(packetDir, "audit-packet.json");
  const sha256ManifestPath = path.join(packetDir, "sha256-manifest.json");

  const auditPacket = {
    schema: "grant-audit-packet-v1",
    packet_version: "1.0.0",
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

  writeCanonicalJson(auditPacketPath, auditPacket);

  const manifest = buildManifestFromStagingRoot(stagingRoot);
  writeCanonicalJson(sha256ManifestPath, manifest);

  const manifestBytes = fs.readFileSync(sha256ManifestPath);
  const finalManifestHash = sha256Buffer(manifestBytes);

  auditPacket.integrity.sha256_manifest_hash = finalManifestHash;
  writeCanonicalJson(auditPacketPath, auditPacket);

  const archiveEntries = collectPacketFiles(stagingRoot).map((entry) =>
    normalizePacketPath(entry)
  );

  assertSafeArchiveEntries(archiveEntries);
  assertDeterministicallySortedPaths(archiveEntries, "archive entries");
  assertRequiredPacketFilesExist(archiveEntries);

  const outputPath = path.resolve(process.cwd(), outFile);

  await tar.create(
    {
      gzip: true,
      cwd: stagingRoot,
      file: outputPath,
      portable: true,
      noMtime: true
    },
    archiveEntries
  );

  console.log(`Built audit packet: ${outputPath}`);
  console.log("Manifest: packet/sha256-manifest.json");
  console.log(`Manifest hash: ${finalManifestHash}`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
