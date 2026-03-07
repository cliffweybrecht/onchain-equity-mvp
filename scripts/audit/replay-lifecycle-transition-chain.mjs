#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();

const TRANSITION_CHAIN_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-transition-chain.json"
);

const SNAPSHOT_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-state-snapshot.json"
);

const OUTPUT_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-replay-reconciliation.json"
);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);

  if (isObject(v)) {
    return Object.keys(v)
      .sort()
      .reduce((acc, k) => {
        acc[k] = canonicalize(v[k]);
        return acc;
      }, {});
  }

  return v;
}

function canonicalStringify(v) {
  return JSON.stringify(canonicalize(v), null, 2) + "\n";
}

function sha256(v) {
  return crypto.createHash("sha256").update(v).digest("hex");
}

function sha256Object(v) {
  return sha256(canonicalStringify(v));
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, canonicalStringify(v));
}

/*
Allows deterministic numeric parsing for:

1000
"1000"

but rejects:
"1000.5"
"-1"
"abc"
*/

function toNonNegativeInteger(name, value) {
  let n = value;

  if (typeof n === "string") {
    if (!/^\d+$/.test(n)) {
      throw new Error(`${name} must be a non-negative integer`);
    }
    n = Number(n);
  }

  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return n;
}

function getNormalizedQuantities(entry, index) {
  const q = entry?.normalized_quantities;

  if (!q) {
    throw new Error(`entries[${index}] missing normalized_quantities`);
  }

  return {
    vested_delta: toNonNegativeInteger(
      `entries[${index}].normalized_quantities.vested_delta`,
      q.vested_delta ?? 0
    ),

    exercised_delta: toNonNegativeInteger(
      `entries[${index}].normalized_quantities.exercised_delta`,
      q.exercised_delta ?? 0
    ),

    cancelled_delta: toNonNegativeInteger(
      `entries[${index}].normalized_quantities.cancelled_delta`,
      q.cancelled_delta ?? 0
    ),

    forfeited_delta: toNonNegativeInteger(
      `entries[${index}].normalized_quantities.forfeited_delta`,
      q.forfeited_delta ?? 0
    )
  };
}

function replayTotals(chain) {
  let total_vested = 0;
  let total_exercised = 0;
  let total_cancelled = 0;
  let total_forfeited = 0;

  for (let i = 0; i < chain.entries.length; i++) {
    const q = getNormalizedQuantities(chain.entries[i], i);

    total_vested += q.vested_delta;
    total_exercised += q.exercised_delta;
    total_cancelled += q.cancelled_delta;
    total_forfeited += q.forfeited_delta;
  }

  const current_balance =
    total_vested -
    total_exercised -
    total_cancelled -
    total_forfeited;

  if (current_balance < 0) {
    throw new Error("negative replay balance");
  }

  return {
    total_vested,
    total_exercised,
    total_cancelled,
    total_forfeited,
    current_balance
  };
}

function snapshotTotals(snapshot) {
  return {
    total_vested: toNonNegativeInteger(
      "snapshot.total_vested",
      snapshot.total_vested ?? 0
    ),

    total_exercised: toNonNegativeInteger(
      "snapshot.total_exercised",
      snapshot.total_exercised ?? 0
    ),

    total_cancelled: toNonNegativeInteger(
      "snapshot.total_cancelled",
      snapshot.total_cancelled ?? 0
    ),

    total_forfeited: toNonNegativeInteger(
      "snapshot.total_forfeited",
      snapshot.total_forfeited ?? 0
    ),

    current_balance: toNonNegativeInteger(
      "snapshot.current_balance",
      snapshot.current_balance ?? 0
    )
  };
}

function main() {
  const chain = readJson(TRANSITION_CHAIN_PATH);
  const snapshot = readJson(SNAPSHOT_PATH);

  const replay = replayTotals(chain);
  const snap = snapshotTotals(snapshot);

  const entry_count =
    chain.entry_count != null
      ? toNonNegativeInteger("entry_count", chain.entry_count)
      : chain.entries.length;

  const reconciliation_status =
    replay.total_vested === snap.total_vested &&
    replay.total_exercised === snap.total_exercised &&
    replay.total_cancelled === snap.total_cancelled &&
    replay.total_forfeited === snap.total_forfeited &&
    replay.current_balance === snap.current_balance
      ? "match"
      : "mismatch";

  const artifact = {
    schema: "grant-audit-lifecycle-replay-reconciliation-v1",
    reconciliation_version: "1.0.0",

    grant_id: chain.grant_id,

    entry_count,

    transition_chain_root: chain.chain_root,
    transition_chain_head_entry_hash: chain.head_chain_entry_hash,

    lifecycle_lineage_hash:
      snapshot.lifecycle_lineage_hash ??
      chain.entries[chain.entries.length - 1].lifecycle_lineage_hash,

    trust_chain_hash:
      snapshot.trust_chain_hash ??
      chain.entries[chain.entries.length - 1].trust_chain_hash,

    replayed_total_vested: replay.total_vested,
    replayed_total_exercised: replay.total_exercised,
    replayed_total_cancelled: replay.total_cancelled,
    replayed_total_forfeited: replay.total_forfeited,
    replayed_current_balance: replay.current_balance,

    snapshot_total_vested: snap.total_vested,
    snapshot_total_exercised: snap.total_exercised,
    snapshot_total_cancelled: snap.total_cancelled,
    snapshot_total_forfeited: snap.total_forfeited,
    snapshot_current_balance: snap.current_balance,

    reconciliation_status
  };

  artifact.reconciliation_hash = sha256Object(artifact);

  writeJson(OUTPUT_PATH, artifact);

  console.log("Built lifecycle replay reconciliation:");
  console.log(OUTPUT_PATH);
  console.log("reconciliation_status:", reconciliation_status);
  console.log("reconciliation_hash:", artifact.reconciliation_hash);
}

main();
