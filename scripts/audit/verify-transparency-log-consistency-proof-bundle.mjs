#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const bundlePathArg =
  process.argv[2] || "manifests/transparency/transparency-log-consistency-proof-bundle.json";
const fixturePathArg =
  process.argv[3] || "manifests/transparency/transparency-log-fixture.json";

const BUNDLE_PATH = path.resolve(bundlePathArg);
const FIXTURE_PATH = path.resolve(fixturePathArg);

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyProofAgainstFixture(proof, fixture) {
  const entries = fixture.log.entries;
  const oldSize = proof.old_size;
  const newSize = proof.new_size;

  assert(Number.isInteger(oldSize), "old_size must be an integer");
  assert(Number.isInteger(newSize), "new_size must be an integer");
  assert(oldSize >= 1, "old_size must be >= 1");
  assert(newSize >= 1, "new_size must be >= 1");
  assert(oldSize <= newSize, "old_size must be <= new_size");
  assert(newSize <= entries.length, "new_size exceeds fixture entry_count");

  const oldHead = entries[oldSize - 1];
  const newHead = entries[newSize - 1];
  const appendedEntries = entries.slice(oldSize, newSize);

  assert(
    proof.old_root === oldHead.cumulative_root,
    `old_root mismatch for ${oldSize}->${newSize}`
  );
  assert(
    proof.new_root === newHead.cumulative_root,
    `new_root mismatch for ${oldSize}->${newSize}`
  );
  assert(
    proof.old_head_entry_hash === oldHead.entry_hash,
    `old_head_entry_hash mismatch for ${oldSize}->${newSize}`
  );
  assert(
    proof.new_head_entry_hash === newHead.entry_hash,
    `new_head_entry_hash mismatch for ${oldSize}->${newSize}`
  );
  assert(
    proof.old_tail_entry_hash === oldHead.entry_hash,
    `old_tail_entry_hash mismatch for ${oldSize}->${newSize}`
  );
  assert(
    proof.old_tail_cumulative_root === oldHead.cumulative_root,
    `old_tail_cumulative_root mismatch for ${oldSize}->${newSize}`
  );
  assert(
    proof.new_head_entry_cumulative_root === newHead.cumulative_root,
    `new_head_entry_cumulative_root mismatch for ${oldSize}->${newSize}`
  );

  const expectedIndexes = appendedEntries.map((entry) => entry.index);
  const expectedHashes = appendedEntries.map((entry) => entry.entry_hash);

  assert(
    JSON.stringify(proof.appended_entry_indexes) === JSON.stringify(expectedIndexes),
    `appended_entry_indexes mismatch for ${oldSize}->${newSize}`
  );
  assert(
    JSON.stringify(proof.appended_entry_hashes) === JSON.stringify(expectedHashes),
    `appended_entry_hashes mismatch for ${oldSize}->${newSize}`
  );

  let replayRoot = proof.old_tail_cumulative_root;
  for (const appendedHash of proof.appended_entry_hashes) {
    replayRoot = sha256Hex(`${replayRoot}:${appendedHash}`);
  }

  assert(
    replayRoot === proof.new_root,
    `replayed cumulative root mismatch for ${oldSize}->${newSize}`
  );
}

function main() {
  const bundle = JSON.parse(fs.readFileSync(BUNDLE_PATH, "utf8"));
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

  assert(
    bundle.schema === "grant-audit-transparency-log-consistency-proof-bundle-v1",
    `Unexpected bundle schema: ${bundle.schema}`
  );
  assert(
    fixture.schema === "grant-audit-transparency-log-fixture-v1",
    `Unexpected fixture schema: ${fixture.schema}`
  );
  assert(
    bundle.fixture_id === fixture.fixture_id,
    "bundle.fixture_id does not match fixture.fixture_id"
  );
  assert(
    bundle.log_entry_count === fixture.log.entry_count,
    "bundle.log_entry_count does not match fixture log entry_count"
  );
  assert(
    Array.isArray(bundle.proofs) && bundle.proofs.length === bundle.proof_count,
    "bundle proof_count does not match proofs array length"
  );

  const expectedTransitions = fixture.transitions.map(
    (transition) => `${transition.old_size}->${transition.new_size}`
  );
  const actualTransitions = bundle.proofs.map(
    (proof) => `${proof.old_size}->${proof.new_size}`
  );

  assert(
    JSON.stringify(actualTransitions) === JSON.stringify(expectedTransitions),
    "bundle proof transitions do not match fixture transitions"
  );

  for (const proof of bundle.proofs) {
    assert(
      proof.schema === "grant-audit-transparency-log-consistency-proof-v1",
      `Unexpected proof schema in bundle: ${proof.schema}`
    );
    verifyProofAgainstFixture(proof, fixture);
    console.log(`verified transition ${proof.old_size}->${proof.new_size}`);
  }

  console.log(`Verified ${bundle.proof_count} bundled consistency proofs`);
  console.log(`Fixture: ${fixture.fixture_id}`);
  console.log(`Entry count: ${fixture.log.entry_count}`);
  console.log(`Log root: ${fixture.log.log_root}`);
}

main();
