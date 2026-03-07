#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();

const CHAIN_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-transition-chain.json"
);

const SNAPSHOT_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-state-snapshot.json"
);

const RECON_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-replay-reconciliation.json"
);

function read(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);

  if (v !== null && typeof v === "object") {
    return Object.keys(v)
      .sort()
      .reduce((a, k) => {
        a[k] = canonicalize(v[k]);
        return a;
      }, {});
  }

  return v;
}

function canonicalStringify(v) {
  return JSON.stringify(canonicalize(v), null, 2) + "\n";
}

function sha256Object(v) {
  return crypto
    .createHash("sha256")
    .update(canonicalStringify(v))
    .digest("hex");
}

function toInt(v) {
  if (typeof v === "string") {
    if (!/^\d+$/.test(v)) throw new Error("invalid integer");
    return Number(v);
  }
  return v;
}

function replay(chain) {
  let vested = 0;
  let exercised = 0;
  let cancelled = 0;
  let forfeited = 0;

  for (const e of chain.entries) {
    const q = e.normalized_quantities;

    vested += toInt(q.vested_delta ?? 0);
    exercised += toInt(q.exercised_delta ?? 0);
    cancelled += toInt(q.cancelled_delta ?? 0);
    forfeited += toInt(q.forfeited_delta ?? 0);
  }

  return {
    total_vested: vested,
    total_exercised: exercised,
    total_cancelled: cancelled,
    total_forfeited: forfeited,
    current_balance:
      vested - exercised - cancelled - forfeited
  };
}

function main() {
  const chain = read(CHAIN_PATH);
  const snapshot = read(SNAPSHOT_PATH);
  const recon = read(RECON_PATH);

  const r = replay(chain);

  if (recon.replayed_total_vested !== r.total_vested)
    throw new Error("replayed_total_vested mismatch");

  if (recon.replayed_total_exercised !== r.total_exercised)
    throw new Error("replayed_total_exercised mismatch");

  if (recon.replayed_total_cancelled !== r.total_cancelled)
    throw new Error("replayed_total_cancelled mismatch");

  if (recon.replayed_total_forfeited !== r.total_forfeited)
    throw new Error("replayed_total_forfeited mismatch");

  if (recon.replayed_current_balance !== r.current_balance)
    throw new Error("replayed_current_balance mismatch");

  const { reconciliation_hash, ...body } = recon;

  const expected = sha256Object(body);

  if (expected !== reconciliation_hash)
    throw new Error("reconciliation_hash mismatch");

  console.log("Lifecycle replay reconciliation verified.");
  console.log("reconciliation_hash:", reconciliation_hash);
}

main();
