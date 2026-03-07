#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";

function parseArgs(argv) {
  const out = {
    log: "manifests/transparency/transparency-log.json",
    proof: "manifests/transparency/transparency-log-consistency-proof.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--log") {
      out.log = argv[++i];
    } else if (arg === "--proof") {
      out.proof = argv[++i];
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
  const proof = readJson(args.proof);

  if (proof.schema !== "grant-audit-transparency-log-consistency-proof-v1") {
    fail(`Unexpected proof schema: ${proof.schema}`);
  }

  if (proof.log_path !== args.log) {
    fail(`proof log_path mismatch: expected ${args.log}, got ${proof.log_path}`);
  }

  if (proof.old_size < 1 || proof.new_size < 1) {
    fail("old_size and new_size must both be >= 1");
  }

  if (proof.old_size > proof.new_size) {
    fail("old_size must be <= new_size");
  }

  if (proof.new_size > log.entry_count) {
    fail("new_size exceeds log entry_count");
  }

  const prefixEntries = log.entries.slice(0, proof.old_size);
  const newEntries = log.entries.slice(0, proof.new_size);

  if (prefixEntries.length !== proof.old_size) {
    fail("prefixEntries length mismatch");
  }

  if (newEntries.length !== proof.new_size) {
    fail("newEntries length mismatch");
  }

  const prefixEntryHashes = prefixEntries.map((entry) => entry.entry_hash);
  const newEntryHashes = newEntries.map((entry) => entry.entry_hash);

  if (JSON.stringify(prefixEntryHashes) !== JSON.stringify(proof.prefix_entry_hashes)) {
    fail("prefix_entry_hashes mismatch");
  }

  const expectedOldRoot = computeMerkleRootFromLeafHashes(prefixEntryHashes);
  const expectedNewRoot = computeMerkleRootFromLeafHashes(newEntryHashes);

  const oldTail = prefixEntries[prefixEntries.length - 1];
  const newTail = newEntries[newEntries.length - 1];

  if (proof.old_root !== expectedOldRoot) {
    fail("old_root mismatch");
  }

  if (proof.new_root !== expectedNewRoot) {
    fail("new_root mismatch");
  }

  if (proof.old_head_entry_hash !== oldTail.entry_hash) {
    fail("old_head_entry_hash mismatch");
  }

  if (proof.new_head_entry_hash !== newTail.entry_hash) {
    fail("new_head_entry_hash mismatch");
  }

  if (proof.old_tail_index !== oldTail.index) {
    fail("old_tail_index mismatch");
  }

  if (proof.new_tail_index !== newTail.index) {
    fail("new_tail_index mismatch");
  }

  if (proof.old_tail_cumulative_root !== oldTail.cumulative_root) {
    fail("old_tail_cumulative_root mismatch");
  }

  if (proof.new_tail_cumulative_root !== newTail.cumulative_root) {
    fail("new_tail_cumulative_root mismatch");
  }

  if (proof.old_root !== proof.old_tail_cumulative_root) {
    fail("old_root must equal old_tail_cumulative_root");
  }

  if (proof.new_root !== proof.new_tail_cumulative_root) {
    fail("new_root must equal new_tail_cumulative_root");
  }

  console.log(JSON.stringify({
    ok: true,
    proof_path: args.proof,
    log_path: args.log,
    old_size: proof.old_size,
    new_size: proof.new_size,
    old_root: proof.old_root,
    new_root: proof.new_root
  }, null, 2));
}

main();
