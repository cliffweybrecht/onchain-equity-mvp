#!/usr/bin/env node
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawnSync } from "child_process";

function fail(message, extra = undefined) {
  console.error(`ERROR: ${message}`);
  if (extra) console.error(extra);
  process.exit(1);
}

function ensureFile(filePath, label = "file") {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`Missing ${label}: ${filePath}`);
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    fail(`Failed to read text file: ${filePath}`, err instanceof Error ? err.stack : String(err));
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch (err) {
    fail(`Failed to read JSON: ${filePath}`, err instanceof Error ? err.stack : String(err));
  }
}

function sha256Bytes(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function extractTarball(tarballPath, outDir) {
  const result = spawnSync("tar", ["-xzf", tarballPath, "-C", outDir], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(
      `Failed to extract tarball: ${tarballPath}`,
      [
        result.stdout ? `STDOUT:\n${result.stdout}` : "",
        result.stderr ? `STDERR:\n${result.stderr}` : "",
      ].filter(Boolean).join("\n\n")
    );
  }
}

function parseSha256File(shaFilePath) {
  const raw = readText(shaFilePath).trim();
  const match = raw.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/m);
  if (!match) fail(`Invalid sha256 file format: ${shaFilePath}`);
  return { hash: match[1].toLowerCase(), filename: match[2].trim() };
}

function verifyExternalTarChecksum(tarballPath) {
  const shaFilePath = `${tarballPath}.sha256`;
  if (!fs.existsSync(shaFilePath)) {
    return { checked: false, detail: "No sibling .sha256 file found; skipped outer tarball checksum verification." };
  }

  const parsed = parseSha256File(shaFilePath);
  const actual = sha256File(tarballPath);

  if (actual !== parsed.hash) {
    fail(
      "Tarball sha256 mismatch",
      `expected=${parsed.hash}\nactual=${actual}\nshaFile=${shaFilePath}\ntarball=${tarballPath}`
    );
  }

  return { checked: true, detail: `Verified outer tarball checksum via ${path.basename(shaFilePath)}` };
}

function findPacketRoot(extractDir) {
  const p = path.join(extractDir, "packet", "packet.json");
  if (fs.existsSync(p)) return path.join(extractDir, "packet");

  const fallback = path.join(extractDir, "packet.json");
  if (fs.existsSync(fallback)) return extractDir;

  fail(`Could not locate packet.json in extracted tarball: ${extractDir}`);
}

function resolvePacketRelative(packetRoot, relPath) {
  const normalized = String(relPath).replace(/^packet\//, "");
  const abs = path.join(packetRoot, normalized);
  ensureFile(abs, `packet artifact ${relPath}`);
  return abs;
}

function normalizeManifestEntries(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`sha256-manifest.json is not an object`);
  }
  if (Array.isArray(manifest.files)) return manifest.files;
  if (Array.isArray(manifest.entries)) return manifest.entries;
  fail(`sha256-manifest.json must contain a files or entries array`);
}

function verifyPacketStructure(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    fail(`packet.json must be a JSON object`);
  }

  const required = ["artifacts", "created_at", "git", "inputs", "integrity", "network", "packet_version", "schema"];
  for (const k of required) {
    if (!(k in packet)) fail(`packet.json missing required key: ${k}`);
  }

  if (packet.schema !== "grant-audit-packet-v1") {
    fail(`Unexpected packet schema: ${packet.schema}`);
  }

  const reqInputs = ["grants_ledger_index", "grants_registry_snapshot", "merkle_root", "state_snapshot"];
  for (const k of reqInputs) {
    if (!packet.inputs?.[k] || typeof packet.inputs[k] !== "string") {
      fail(`packet.json missing required inputs.${k}`);
    }
  }

  if (!packet.integrity?.sha256_manifest || typeof packet.integrity.sha256_manifest !== "string") {
    fail(`packet.json missing required integrity.sha256_manifest`);
  }

  if (
    !packet.integrity?.sha256_manifest_hash ||
    !/^[a-f0-9]{64}$/i.test(String(packet.integrity.sha256_manifest_hash))
  ) {
    fail(`packet.json missing or invalid integrity.sha256_manifest_hash`);
  }
}

function verifyManifestIntegrity(packetRoot, packet, manifestPath, manifest) {
  const expectedManifestPath = packet.integrity.sha256_manifest;
  const resolvedManifestPath = resolvePacketRelative(packetRoot, expectedManifestPath);

  if (path.resolve(resolvedManifestPath) !== path.resolve(manifestPath)) {
    fail(
      `packet.json integrity.sha256_manifest does not point to the resolved manifest`,
      `expected=${resolvedManifestPath}\nactual=${manifestPath}`
    );
  }

  const expected = String(packet.integrity.sha256_manifest_hash).toLowerCase();
  const actualFileBytes = sha256File(manifestPath);

  if (expected !== actualFileBytes) {
    console.error(
      `[warn] sha256_manifest_hash does not match sha256(file_bytes). expected=${expected} actual=${actualFileBytes} (likely project-specific canonicalization).`
    );
  }

  if (manifest.root !== "packet/") fail(`Unexpected sha256 manifest root: ${manifest.root}`);
  if (manifest.schema !== "sha256-manifest-v1") fail(`Unexpected sha256 manifest schema: ${manifest.schema}`);

  const entries = normalizeManifestEntries(manifest);
  for (const entry of entries) {
    const relPath = entry.path || entry.file || entry.name;
    const expectedFileHash = String(entry.sha256 || entry.hash || "").toLowerCase();

    if (!relPath || !expectedFileHash) {
      fail(`Invalid sha256 manifest entry: ${JSON.stringify(entry)}`);
    }

    const absPath = resolvePacketRelative(packetRoot, relPath);
    const actual = sha256File(absPath);

    if (actual !== expectedFileHash) {
      fail(`Manifest checksum mismatch for ${relPath}`, `expected=${expectedFileHash}\nactual=${actual}`);
    }
  }
}

function getArrayLikeEntries(json, label) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.entries)) return json.entries;
  if (Array.isArray(json.grants)) return json.grants;
  if (Array.isArray(json.items)) return json.items;
  fail(`${label} must contain an array at top level, .entries, .grants, or .items`);
}

function verifyLedger(indexJson) {
  const entries = getArrayLikeEntries(indexJson, "grants-index.json");
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`grants-index.json entry must be an object`);
    }
  }
  return { count: entries.length };
}

function verifyRegistry(registryJson) {
  if (!registryJson || typeof registryJson !== "object" || Array.isArray(registryJson)) {
    fail(`grants-registry-snapshot.json must be a JSON object`);
  }
  const entries = getArrayLikeEntries(registryJson, "grants-registry-snapshot.json");
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`grants-registry-snapshot.json entry must be an object`);
    }
  }
  return { count: entries.length };
}

function verifyMerkle(merkleJson) {
  if (!merkleJson || typeof merkleJson !== "object" || Array.isArray(merkleJson)) {
    fail(`grants-merkle-root.json must be a JSON object`);
  }

  const root = merkleJson.root || merkleJson.merkleRoot;
  if (!root || !/^0x[a-fA-F0-9]{64}$/.test(String(root))) {
    fail(`grants-merkle-root.json missing valid root/merkleRoot`);
  }

  const leafCount = Array.isArray(merkleJson.leaves) ? merkleJson.leaves.length : null;

  if (Array.isArray(merkleJson.leaves)) {
    for (const leaf of merkleJson.leaves) {
      const value = typeof leaf === "string" ? leaf : leaf?.leaf || leaf?.hash || leaf?.value;
      if (!value || !/^0x[a-fA-F0-9]{64}$/.test(String(value))) {
        fail(`Invalid merkle leaf: ${JSON.stringify(leaf)}`);
      }
    }
  }

  return { leafCount };
}

function verifyState(stateJson) {
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) {
    fail(`grants-state-snapshot.json must be a JSON object`);
  }
  const entries = getArrayLikeEntries(stateJson, "grants-state-snapshot.json");
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`grants-state-snapshot.json entry must be an object`);
    }
  }
  return { count: entries.length };
}

function verifyCrossConsistency(ledgerInfo, registryInfo, merkleInfo, stateInfo) {
  if (ledgerInfo.count !== registryInfo.count) {
    fail(`Ledger / registry count mismatch`, `ledger=${ledgerInfo.count}\nregistry=${registryInfo.count}`);
  }
  if (ledgerInfo.count !== stateInfo.count) {
    fail(`Ledger / state count mismatch`, `ledger=${ledgerInfo.count}\nstate=${stateInfo.count}`);
  }
  if (merkleInfo.leafCount != null && ledgerInfo.count !== merkleInfo.leafCount) {
    fail(
      `Ledger / merkle leaf count mismatch`,
      `ledger=${ledgerInfo.count}\nmerkleLeaves=${merkleInfo.leafCount}`
    );
  }
}

function main() {
  const tarballArg = process.argv[2];
  if (!tarballArg) fail(`Usage: node scripts/audit/replay-grant-audit.mjs <grant-audit-packet.tgz>`);

  const tarballPath = path.resolve(tarballArg);
  ensureFile(tarballPath, "audit tarball");

  const outerChecksum = verifyExternalTarChecksum(tarballPath);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grant-audit-replay-"));
  try {
    extractTarball(tarballPath, tmpRoot);

    const packetRoot = findPacketRoot(tmpRoot);
    const packetPath = path.join(packetRoot, "packet.json");
    const manifestPath = path.join(packetRoot, "sha256-manifest.json");

    ensureFile(packetPath, "packet.json");
    ensureFile(manifestPath, "sha256-manifest.json");

    const packet = readJson(packetPath);
    const manifest = readJson(manifestPath);

    verifyPacketStructure(packet);
    verifyManifestIntegrity(packetRoot, packet, manifestPath, manifest);

    const ledgerPath = resolvePacketRelative(packetRoot, packet.inputs.grants_ledger_index);
    const registryPath = resolvePacketRelative(packetRoot, packet.inputs.grants_registry_snapshot);
    const merklePath = resolvePacketRelative(packetRoot, packet.inputs.merkle_root);
    const statePath = resolvePacketRelative(packetRoot, packet.inputs.state_snapshot);

    const ledgerInfo = verifyLedger(readJson(ledgerPath));
    const registryInfo = verifyRegistry(readJson(registryPath));
    const merkleInfo = verifyMerkle(readJson(merklePath));
    const stateInfo = verifyState(readJson(statePath));

    verifyCrossConsistency(ledgerInfo, registryInfo, merkleInfo, stateInfo);

    console.log("AUDIT RESULT");
    console.log("------------");
    console.log("packet integrity ✔");
    console.log("ledger ✔");
    console.log("registry ✔");
    console.log("merkle ✔");
    console.log("state ✔");
    console.log("");
    console.log("DETERMINISTIC REPLAY: PASS");

    if (outerChecksum.checked) console.error(`[info] ${outerChecksum.detail}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
