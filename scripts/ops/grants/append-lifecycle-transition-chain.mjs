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

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sortKeysDeep(data), null, 2) + "\n");
}

function zeroNormalization(event) {
  return {
    schema: "grant-audit-lifecycle-quantity-normalization-v1",
    normalization_version: "1.0.0",
    mode: "legacy-zero",
    source_quantity: event.quantity ?? null,
    vested_delta: "0",
    exercised_delta: "0",
    cancelled_delta: "0",
    forfeited_delta: "0"
  };
}

const args = parseArgs(process.argv);
const eventPath = args["event-manifest"] || "manifests/grants/grant-lifecycle-event.json";
const chainPath = args["chain-manifest"] || "manifests/grants/lifecycle-transition-chain.json";

const event = readJson(eventPath);
if (!event) throw new Error(`Missing event manifest: ${eventPath}`);

const existing = readJson(chainPath, {
  schema: "grant-audit-lifecycle-transition-chain-v1",
  chain_version: "1.0.0",
  grant_id: event.grant_id,
  entry_count: 0,
  head_chain_entry_hash: null,
  chain_root: null,
  entries: []
});

const entryCore = {
  schema: "grant-audit-lifecycle-transition-chain-entry-v1",
  entry_version: "1.1.0",
  grant_id: event.grant_id,
  event_id: event.event_id,
  event_type: event.event_type,
  effective_at: event.effective_at,
  previous_state: event.previous_state ?? null,
  current_state: event.current_state,
  event_hash: event.event_hash,
  normalized_quantities: event.quantity_normalization ?? zeroNormalization(event),
  lifecycle_lineage_hash: event.lifecycle_lineage_hash,
  trust_chain_hash: event.trust_chain_hash
};

let entries = Array.isArray(existing.entries) ? [...existing.entries] : [];
const idx = entries.findIndex((e) => e.event_id === event.event_id);

if (idx >= 0) {
  entries[idx] = {
    ...entries[idx],
    ...entryCore
  };
} else {
  entries.push(entryCore);
}

entries.sort((a, b) => {
  const byTime = String(a.effective_at).localeCompare(String(b.effective_at));
  if (byTime !== 0) return byTime;
  return String(a.event_id).localeCompare(String(b.event_id));
});

let prevEntryHash = null;
entries = entries.map((entry, index) => {
  const body = {
    schema: "grant-audit-lifecycle-transition-chain-entry-v1",
    entry_version: "1.1.0",
    index,
    grant_id: entry.grant_id,
    event_id: entry.event_id,
    event_type: entry.event_type,
    effective_at: entry.effective_at,
    previous_state: entry.previous_state ?? null,
    current_state: entry.current_state,
    event_hash: entry.event_hash,
    normalized_quantities: entry.normalized_quantities,
    lifecycle_lineage_hash: entry.lifecycle_lineage_hash,
    trust_chain_hash: entry.trust_chain_hash,
    prev_entry_hash: prevEntryHash
  };

  const entryHash = sha256Hex(canonicalStringify(body));
  const full = {
    ...body,
    entry_hash: entryHash
  };

  prevEntryHash = entryHash;
  return full;
});

const headChainEntryHash = entries.length ? entries[entries.length - 1].entry_hash : null;
const chainRoot = sha256Hex(canonicalStringify({
  grant_id: event.grant_id,
  entry_hashes: entries.map((e) => e.entry_hash)
}));

const manifestBody = {
  schema: "grant-audit-lifecycle-transition-chain-v1",
  chain_version: "1.0.0",
  grant_id: event.grant_id,
  entry_count: entries.length,
  head_chain_entry_hash: headChainEntryHash,
  chain_root: chainRoot,
  entries
};

writeJson(chainPath, manifestBody);
console.log(JSON.stringify(manifestBody, null, 2));
