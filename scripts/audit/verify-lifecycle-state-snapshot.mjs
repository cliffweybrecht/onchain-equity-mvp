#!/usr/bin/env node
import fs from "fs";
import crypto from "crypto";

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toBig(v) {
  return BigInt(String(v));
}

const snapshotPath = process.argv[2] || "manifests/grants/lifecycle-state-snapshot.json";
const chainPath = process.argv[3] || "manifests/grants/lifecycle-transition-chain.json";

const snapshot = readJson(snapshotPath);
const chain = readJson(chainPath);

const { snapshot_hash, ...body } = snapshot;
const recalculatedSnapshotHash = sha256Hex(canonicalStringify(body));

if (recalculatedSnapshotHash !== snapshot_hash) {
  throw new Error(`snapshot_hash mismatch: expected ${snapshot_hash}, recalculated ${recalculatedSnapshotHash}`);
}

let totalVested = 0n;
let totalExercised = 0n;
let totalCancelled = 0n;
let totalForfeited = 0n;

for (const entry of chain.entries) {
  const nq = entry.normalized_quantities ?? {
    vested_delta: "0",
    exercised_delta: "0",
    cancelled_delta: "0",
    forfeited_delta: "0"
  };

  totalVested += toBig(nq.vested_delta);
  totalExercised += toBig(nq.exercised_delta);
  totalCancelled += toBig(nq.cancelled_delta);
  totalForfeited += toBig(nq.forfeited_delta);
}

const currentBalance = totalVested - totalExercised - totalCancelled - totalForfeited;
const latest = chain.entries.length ? chain.entries[chain.entries.length - 1] : null;

const checks = [
  ["grant_id", snapshot.grant_id, chain.grant_id],
  ["entry_count", String(snapshot.entry_count), String(chain.entry_count)],
  ["latest_event_id", snapshot.latest_event_id, latest?.event_id ?? null],
  ["latest_event_type", snapshot.latest_event_type, latest?.event_type ?? null],
  ["current_state", snapshot.current_state, latest?.current_state ?? null],
  ["total_vested", snapshot.total_vested, totalVested.toString()],
  ["total_exercised", snapshot.total_exercised, totalExercised.toString()],
  ["total_cancelled", snapshot.total_cancelled, totalCancelled.toString()],
  ["total_forfeited", snapshot.total_forfeited, totalForfeited.toString()],
  ["current_balance", snapshot.current_balance, currentBalance.toString()],
  ["head_chain_entry_hash", snapshot.head_chain_entry_hash, chain.head_chain_entry_hash],
  ["chain_root", snapshot.chain_root, chain.chain_root],
  ["lifecycle_lineage_hash", snapshot.lifecycle_lineage_hash, latest?.lifecycle_lineage_hash ?? null],
  ["trust_chain_hash", snapshot.trust_chain_hash, latest?.trust_chain_hash ?? null]
];

for (const [name, actual, expected] of checks) {
  if (actual !== expected) {
    throw new Error(`${name} mismatch: expected ${expected}, got ${actual}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  grant_id: snapshot.grant_id,
  total_vested: snapshot.total_vested,
  total_exercised: snapshot.total_exercised,
  total_cancelled: snapshot.total_cancelled,
  total_forfeited: snapshot.total_forfeited,
  current_balance: snapshot.current_balance,
  snapshot_hash: snapshot.snapshot_hash
}, null, 2));
