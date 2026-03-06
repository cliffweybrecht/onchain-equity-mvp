import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const REQUIRED_PACKET_FILES = Object.freeze([
  "packet/audit-packet.json",
  "packet/inputs/grants-index.json",
  "packet/inputs/grants-registry-snapshot.json",
  "packet/inputs/grants-merkle-root.json",
  "packet/inputs/grants-state-snapshot.json",
  "packet/sha256-manifest.json"
]);

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeCanonicalJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${canonicalStringify(value)}\n`, "utf8");
}

export function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

export function normalizePacketPath(input) {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error(`Invalid packet path: ${String(input)}`);
  }

  const forward = input.replace(/\\/g, "/");
  const normalized = path.posix.normalize(forward);

  if (!normalized || normalized === ".") {
    throw new Error(`Invalid packet path: ${input}`);
  }

  if (normalized.startsWith("/") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Archive entry must not be absolute: ${input}`);
  }

  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Archive entry must not contain path traversal: ${input}`);
  }

  return normalized;
}

export function listFilesRecursive(dirPath) {
  const out = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return out;
}

export function assertSafeArchiveEntries(entryPaths) {
  const seen = new Set();
  const normalized = [];

  for (const rawPath of entryPaths) {
    const entryPath = normalizePacketPath(rawPath);
    if (seen.has(entryPath)) {
      throw new Error(`Duplicate normalized archive entry path detected: ${entryPath}`);
    }
    seen.add(entryPath);
    normalized.push(entryPath);
  }

  return normalized;
}

export function assertDeterministicallySortedPaths(paths, label = "paths") {
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < paths.length; i += 1) {
    if (paths[i] !== sorted[i]) {
      throw new Error(
        `${label} are not deterministically sorted at index ${i}: expected "${sorted[i]}", got "${paths[i]}"`
      );
    }
  }
}

export function assertRequiredPacketFilesExist(paths) {
  const present = new Set(paths);
  const missing = REQUIRED_PACKET_FILES.filter((requiredPath) => !present.has(requiredPath));
  if (missing.length > 0) {
    throw new Error(`Required packet files missing: ${missing.join(", ")}`);
  }
}

export function assertRequiredSourceFilesExist(sourcePaths) {
  const missing = sourcePaths.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    throw new Error(`Required source input files missing: ${missing.join(", ")}`);
  }
}

export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
}

export function collectPacketFiles(stagingRoot) {
  const allFiles = listFilesRecursive(stagingRoot);

  const normalized = allFiles.map((fullPath) =>
    normalizePacketPath(path.relative(stagingRoot, fullPath).split(path.sep).join("/"))
  );

  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}

export function buildSha256Manifest(fileEntries) {
  const files = fileEntries.map((entry) => {
    const normalizedPath = normalizePacketPath(entry.path);

    if (
      normalizedPath === "packet/sha256-manifest.json" ||
      normalizedPath === "packet/audit-packet.json"
    ) {
      throw new Error(
        "Manifest must exclude packet/sha256-manifest.json and packet/audit-packet.json from hashed files"
      );
    }

    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid sha256 for ${normalizedPath}: ${entry.sha256}`);
    }

    return {
      path: normalizedPath,
      sha256: entry.sha256
    };
  });

  files.sort((a, b) => a.path.localeCompare(b.path));

  const seen = new Set();
  for (const file of files) {
    if (seen.has(file.path)) {
      throw new Error(`Duplicate manifest path detected: ${file.path}`);
    }
    seen.add(file.path);
  }

  return {
    schema: "grant-audit-packet-sha256-manifest-v1",
    hash_algorithm: "sha256",
    files
  };
}
