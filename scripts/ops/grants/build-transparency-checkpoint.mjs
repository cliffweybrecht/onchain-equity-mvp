#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    log: "manifests/transparency/transparency-log.json",
    out: "manifests/transparency/checkpoint.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--log") {
      out.log = argv[++i];
    } else if (arg === "--out") {
      out.out = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = readJson(args.log);
  const tail = log.entries.length > 0 ? log.entries[log.entries.length - 1] : null;

  const checkpoint = {
    schema: "grant-audit-transparency-log-checkpoint-v1",
    checkpoint_version: "1.0.0",
    created_at: new Date().toISOString(),
    log_path: args.log,
    log_version: log.log_version,
    entry_count: log.entry_count,
    head_entry_hash: log.head_entry_hash,
    head_entry_cumulative_root: tail ? tail.cumulative_root : null,
    log_root: log.log_root
  };

  writeJson(args.out, checkpoint);

  console.log(JSON.stringify({
    ok: true,
    checkpoint_path: args.out,
    entry_count: checkpoint.entry_count,
    head_entry_hash: checkpoint.head_entry_hash,
    head_entry_cumulative_root: checkpoint.head_entry_cumulative_root,
    log_root: checkpoint.log_root
  }, null, 2));
}

main();
