#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

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

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sortKeysDeep(data), null, 2) + "\n");
}

function toBig(v) {
  return BigInt(String(v));
}

function qs(v) {
  return v.toString();
}

const args = parseArgs(process.argv);
const chainPath = args["chain-manifest"] || "manifests/grants/lifecycle-transition-chain.json";
const outPath = args.out || "manifests/grants/lifecycle-state-snapshot.json";

const chain = readJson(chainPath);
const entries = Array.isArray(chain.entries) ? chain.entries : [];

let totalVested = 0n;
let totalExercised = 0n;
let totalCancelled = 0n;
let totalForfeited = 0n;

for (const entry of entries) {
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
if (currentBalance < 0n) {
  throw new Error(`current_balance became negative: ${currentBalance.toString()}`);
}

const latest = entries.length ? entries[entries.length - 1] : null;

const body = {
  schema: "grant-audit-lifecycle-state-snapshot-v1",
  snapshot_version: "1.1.0",
  grant_id: chain.grant_id,
  entry_count: chain.entry_count,
  latest_event_id: latest?.event_id ?? null,
  latest_event_type: latest?.event_type ?? null,
  current_state: latest?.current_state ?? null,
  total_vested: qs(totalVested),
  total_exercised: qs(totalExercised),
  total_cancelled: qs(totalCancelled),
  total_forfeited: qs(totalForfeited),
  current_balance: qs(currentBalance),
  head_chain_entry_hash: chain.head_chain_entry_hash,
  chain_root: chain.chain_root,
  lifecycle_lineage_hash: latest?.lifecycle_lineage_hash ?? null,
  trust_chain_hash: latest?.trust_chain_hash ?? null,
  quantity_normalization_version: "1.0.0"
};

const snapshotHash = sha256Hex(canonicalStringify(body));
const artifact = {
  ...body,
  snapshot_hash: snapshotHash
};

writeJson(outPath, artifact);
console.log(JSON.stringify(artifact, null, 2));
