#!/usr/bin/env node
import fs from "node:fs";

function parseArgs(argv) {
  const out = {
    checkpoint: "manifests/transparency/checkpoint.json",
    log: "manifests/transparency/transparency-log.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--checkpoint") {
      out.checkpoint = argv[++i];
    } else if (arg === "--log") {
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

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkpoint = readJson(args.checkpoint);
  const log = readJson(args.log);
  const tail = log.entries.length > 0 ? log.entries[log.entries.length - 1] : null;

  if (checkpoint.schema !== "grant-audit-transparency-log-checkpoint-v1") {
    fail(`Unexpected checkpoint schema: ${checkpoint.schema}`);
  }

  if (checkpoint.log_path !== args.log) {
    fail(`checkpoint log_path mismatch: expected ${args.log}, got ${checkpoint.log_path}`);
  }

  if (checkpoint.log_version !== log.log_version) {
    fail("log_version mismatch");
  }

  if (checkpoint.entry_count !== log.entry_count) {
    fail("entry_count mismatch");
  }

  if (checkpoint.head_entry_hash !== log.head_entry_hash) {
    fail("head_entry_hash mismatch");
  }

  const expectedHeadEntryCumulativeRoot = tail ? tail.cumulative_root : null;

  if (checkpoint.head_entry_cumulative_root !== expectedHeadEntryCumulativeRoot) {
    fail("head_entry_cumulative_root mismatch");
  }

  if (checkpoint.log_root !== log.log_root) {
    fail("log_root mismatch");
  }

  if (checkpoint.head_entry_cumulative_root !== checkpoint.log_root) {
    fail("head_entry_cumulative_root must equal log_root");
  }

  console.log(JSON.stringify({
    ok: true,
    checkpoint_path: args.checkpoint,
    log_path: args.log,
    entry_count: checkpoint.entry_count,
    head_entry_hash: checkpoint.head_entry_hash,
    head_entry_cumulative_root: checkpoint.head_entry_cumulative_root,
    log_root: checkpoint.log_root
  }, null, 2));
}

main();
