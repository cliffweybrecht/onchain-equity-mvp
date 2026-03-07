#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";

function parseArgs(argv) {
  const out = {
    log: "manifests/transparency/transparency-log.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--log") {
      out.log = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = readJson(args.log);

  if (log.schema !== "grant-audit-transparency-log-v1") {
    fail(`Unexpected log schema: ${log.schema}`);
  }

  if (!Array.isArray(log.entries)) {
    fail("entries must be an array");
  }

  if (log.entry_count !== log.entries.length) {
    fail(`entry_count mismatch: expected ${log.entries.length}, got ${log.entry_count}`);
  }

  const leafHashes = [];

  for (let i = 0; i < log.entries.length; i += 1) {
    const entry = log.entries[i];

    if (entry.schema !== "grant-audit-transparency-log-entry-v1") {
      fail(`Entry ${i} has unexpected schema: ${entry.schema}`);
    }

    if (entry.index !== i) {
      fail(`Entry ${i} has non-sequential index: ${entry.index}`);
    }

    if (!entry.appended_at) {
      fail(`Entry ${i} missing appended_at`);
    }

    const expectedEntryHash = computeEntryHash(entry);
    if (entry.entry_hash !== expectedEntryHash) {
      fail(`Entry ${i} entry_hash mismatch`);
    }

    leafHashes.push(expectedEntryHash);
    const expectedCumulativeRoot = computeMerkleRootFromLeafHashes(leafHashes);

    if (!entry.cumulative_root) {
      fail(`Entry ${i} missing cumulative_root`);
    }

    if (entry.cumulative_root !== expectedCumulativeRoot) {
      fail(`Entry ${i} cumulative_root mismatch`);
    }
  }

  const expectedHeadEntryHash = leafHashes.length > 0 ? leafHashes[leafHashes.length - 1] : null;
  const expectedLogRoot = computeMerkleRootFromLeafHashes(leafHashes);

  if (log.head_entry_hash !== expectedHeadEntryHash) {
    fail("head_entry_hash mismatch");
  }

  if (log.log_root !== expectedLogRoot) {
    fail("log_root mismatch");
  }

  if (log.entries.length > 0) {
    const tail = log.entries[log.entries.length - 1];
    if (tail.cumulative_root !== log.log_root) {
      fail("tail cumulative_root must equal log_root");
    }
  }

  console.log(JSON.stringify({
    ok: true,
    log_path: args.log,
    entry_count: log.entry_count,
    head_entry_hash: log.head_entry_hash,
    log_root: log.log_root
  }, null, 2));
}

main();
