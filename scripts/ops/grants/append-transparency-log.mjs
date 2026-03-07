#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function parseArgs(argv) {
  const out = {
    log: "manifests/transparency/transparency-log.json",
    entry: null,
    repairOnly: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--log") {
      out.log = argv[++i];
    } else if (arg === "--entry") {
      out.entry = argv[++i];
    } else if (arg === "--repair-only") {
      out.repairOnly = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return out;
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortValue(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sanitizeEntryForHash(entry) {
  const copy = JSON.parse(JSON.stringify(entry));
  delete copy.entry_hash;
  delete copy.cumulative_root;
  return copy;
}

function computeEntryHash(entry) {
  return sha256Hex(canonicalStringify(sanitizeEntryForHash(entry)));
}

function computeMerkleRootFromLeafHashes(leafHashes) {
  if (leafHashes.length === 0) {
    return null;
  }

  let level = [...leafHashes];

  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(sha256Hex(left + right));
    }
    level = next;
  }

  return level[0];
}

function normalizeLogShape(log) {
  return {
    schema: log?.schema || "grant-audit-transparency-log-v1",
    log_version: log?.log_version || "1.0.0",
    created_at: log?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    entry_count: 0,
    head_entry_hash: null,
    log_root: null,
    entries: Array.isArray(log?.entries) ? log.entries : []
  };
}

function rebuildEntries(entries) {
  const rebuilt = [];
  const leafHashes = [];

  for (let i = 0; i < entries.length; i += 1) {
    const original = JSON.parse(JSON.stringify(entries[i]));

    original.schema ||= "grant-audit-transparency-log-entry-v1";
    original.entry_version ||= "1.0.0";
    original.index = i;

    if (!original.appended_at) {
      throw new Error(`Entry ${i} missing appended_at`);
    }

    const entryHash = computeEntryHash(original);
    leafHashes.push(entryHash);

    const cumulativeRoot = computeMerkleRootFromLeafHashes(leafHashes);

    rebuilt.push({
      ...original,
      entry_hash: entryHash,
      cumulative_root: cumulativeRoot
    });
  }

  return rebuilt;
}

function appendNewEntry(entries, entryPayloadPath) {
  const payload = readJson(entryPayloadPath);

  const entry = JSON.parse(JSON.stringify(payload));
  entry.schema ||= "grant-audit-transparency-log-entry-v1";
  entry.entry_version ||= "1.0.0";
  entry.index = entries.length;
  entry.appended_at ||= new Date().toISOString();

  delete entry.entry_hash;
  delete entry.cumulative_root;

  return [...entries, entry];
}

function finalizeLog(log) {
  const rebuiltEntries = rebuildEntries(log.entries);
  const leafHashes = rebuiltEntries.map((entry) => entry.entry_hash);
  const logRoot = computeMerkleRootFromLeafHashes(leafHashes);
  const headEntryHash = rebuiltEntries.length > 0 ? rebuiltEntries[rebuiltEntries.length - 1].entry_hash : null;

  return {
    schema: "grant-audit-transparency-log-v1",
    log_version: log.log_version || "1.0.0",
    created_at: log.created_at,
    updated_at: new Date().toISOString(),
    entry_count: rebuiltEntries.length,
    head_entry_hash: headEntryHash,
    log_root: logRoot,
    entries: rebuiltEntries
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let log;
  if (fs.existsSync(args.log)) {
    log = normalizeLogShape(readJson(args.log));
  } else {
    log = normalizeLogShape(null);
  }

  if (args.entry && args.repairOnly) {
    throw new Error("Use either --entry or --repair-only, not both");
  }

  if (args.entry) {
    log.entries = appendNewEntry(log.entries, args.entry);
  }

  const finalLog = finalizeLog(log);
  writeJson(args.log, finalLog);

  const summary = {
    ok: true,
    log_path: args.log,
    repair_only: args.repairOnly,
    appended: Boolean(args.entry),
    entry_count: finalLog.entry_count,
    head_entry_hash: finalLog.head_entry_hash,
    log_root: finalLog.log_root
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
