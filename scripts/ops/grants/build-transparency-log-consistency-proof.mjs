#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function parseArgs(argv) {
  const out = {
    log: "manifests/transparency/transparency-log.json",
    out: "manifests/transparency/transparency-log-consistency-proof.json",
    oldSize: null,
    newSize: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--log") {
      out.log = argv[++i];
    } else if (arg === "--out") {
      out.out = argv[++i];
    } else if (arg === "--old-size") {
      out.oldSize = Number(argv[++i]);
    } else if (arg === "--new-size") {
      out.newSize = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(out.oldSize) || out.oldSize < 1) {
    throw new Error("--old-size must be an integer >= 1");
  }

  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = readJson(args.log);

  const newSize = args.newSize ?? log.entry_count;

  if (!Number.isInteger(newSize) || newSize < 1) {
    throw new Error("--new-size must be an integer >= 1");
  }

  if (args.oldSize > newSize) {
    throw new Error("old_size must be <= new_size");
  }

  if (newSize > log.entry_count) {
    throw new Error(`new_size ${newSize} exceeds log entry_count ${log.entry_count}`);
  }

  const prefixEntries = log.entries.slice(0, args.oldSize);
  const newEntries = log.entries.slice(0, newSize);

  const prefixEntryHashes = prefixEntries.map((entry) => entry.entry_hash);
  const newEntryHashes = newEntries.map((entry) => entry.entry_hash);

  const oldRoot = computeMerkleRootFromLeafHashes(prefixEntryHashes);
  const newRoot = computeMerkleRootFromLeafHashes(newEntryHashes);

  const oldTail = prefixEntries[prefixEntries.length - 1];
  const newTail = newEntries[newEntries.length - 1];

  const proof = {
    schema: "grant-audit-transparency-log-consistency-proof-v1",
    proof_version: "1.0.0",
    created_at: new Date().toISOString(),
    log_path: args.log,
    old_size: args.oldSize,
    new_size: newSize,
    old_root: oldRoot,
    new_root: newRoot,
    old_head_entry_hash: oldTail.entry_hash,
    new_head_entry_hash: newTail.entry_hash,
    old_tail_index: oldTail.index,
    new_tail_index: newTail.index,
    old_tail_cumulative_root: oldTail.cumulative_root,
    new_tail_cumulative_root: newTail.cumulative_root,
    prefix_entry_hashes: prefixEntryHashes
  };

  writeJson(args.out, proof);

  console.log(JSON.stringify({
    ok: true,
    proof_path: args.out,
    old_size: proof.old_size,
    new_size: proof.new_size,
    old_root: proof.old_root,
    new_root: proof.new_root
  }, null, 2));
}

main();
