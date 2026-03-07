#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const FIXTURE_PATH = path.resolve("manifests/transparency/transparency-log-fixture.json");
const OUT_PATH = path.resolve("manifests/transparency/transparency-log-consistency-proof-bundle.json");

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value), null, 2) + "\n";
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function prefixRoot(entries, size) {
  return entries[size - 1].cumulative_root;
}

function headEntryHash(entries, size) {
  return entries[size - 1].entry_hash;
}

function buildProof(entries, transition, createdAt) {
  const { old_size: oldSize, new_size: newSize } = transition;

  if (!Number.isInteger(oldSize) || !Number.isInteger(newSize)) {
    throw new Error(`Invalid transition sizes: ${JSON.stringify(transition)}`);
  }

  if (oldSize < 1 || newSize < 1) {
    throw new Error(`Transition sizes must be >= 1: ${JSON.stringify(transition)}`);
  }

  if (oldSize > newSize) {
    throw new Error(`old_size must be <= new_size: ${JSON.stringify(transition)}`);
  }

  if (newSize > entries.length) {
    throw new Error(
      `new_size=${newSize} exceeds available entries=${entries.length}`
    );
  }

  const oldTail = entries[oldSize - 1];
  const newHead = entries[newSize - 1];
  const appendedEntries = entries.slice(oldSize, newSize);

  return {
    schema: "grant-audit-transparency-log-consistency-proof-v1",
    proof_version: "1.0.0",
    created_at: createdAt,
    old_size: oldSize,
    new_size: newSize,
    old_root: prefixRoot(entries, oldSize),
    new_root: prefixRoot(entries, newSize),
    old_head_entry_hash: headEntryHash(entries, oldSize),
    new_head_entry_hash: headEntryHash(entries, newSize),
    old_tail_entry_hash: oldTail.entry_hash,
    old_tail_cumulative_root: oldTail.cumulative_root,
    new_head_entry_cumulative_root: newHead.cumulative_root,
    appended_entry_indexes: appendedEntries.map((entry) => entry.index),
    appended_entry_hashes: appendedEntries.map((entry) => entry.entry_hash)
  };
}

function main() {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

  if (fixture.schema !== "grant-audit-transparency-log-fixture-v1") {
    throw new Error(`Unexpected fixture schema: ${fixture.schema}`);
  }

  const entries = fixture.log?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Fixture log.entries must be a non-empty array");
  }

  const proofs = fixture.transitions.map((transition) =>
    buildProof(entries, transition, fixture.created_at)
  );

  const bundle = {
    schema: "grant-audit-transparency-log-consistency-proof-bundle-v1",
    bundle_version: "1.0.0",
    created_at: fixture.created_at,
    fixture_id: fixture.fixture_id,
    fixture_schema: fixture.schema,
    log_entry_count: entries.length,
    proof_count: proofs.length,
    proofs
  };

  ensureDir(OUT_PATH);
  fs.writeFileSync(OUT_PATH, canonicalJson(bundle));

  console.log(`Read ${FIXTURE_PATH}`);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`proof_count=${bundle.proof_count}`);
  console.log(
    `transitions=${bundle.proofs
      .map((proof) => `${proof.old_size}->${proof.new_size}`)
      .join(",")}`
  );
}

main();
