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

const filePath = process.argv[2] || "manifests/grants/lifecycle-transition-chain.json";
const chain = readJson(filePath);

if (!Array.isArray(chain.entries)) {
  throw new Error("entries must be an array");
}

let prevEntryHash = null;

chain.entries.forEach((entry, index) => {
  if (entry.index !== index) {
    throw new Error(`entry index mismatch at position ${index}`);
  }

  const { entry_hash, ...body } = entry;
  const recalculated = sha256Hex(canonicalStringify(body));
  if (recalculated !== entry_hash) {
    throw new Error(`entry_hash mismatch at index ${index}: expected ${entry_hash}, recalculated ${recalculated}`);
  }

  if (body.prev_entry_hash !== prevEntryHash) {
    throw new Error(`prev_entry_hash mismatch at index ${index}`);
  }

  const nq = body.normalized_quantities;
  if (!nq) {
    throw new Error(`missing normalized_quantities at index ${index}`);
  }

  ["vested_delta", "exercised_delta", "cancelled_delta", "forfeited_delta"].forEach((k) => {
    if (!/^[0-9]+$/.test(String(nq[k]))) {
      throw new Error(`invalid normalized_quantities.${k} at index ${index}`);
    }
  });

  prevEntryHash = entry_hash;
});

const expectedRoot = sha256Hex(canonicalStringify({
  grant_id: chain.grant_id,
  entry_hashes: chain.entries.map((e) => e.entry_hash)
}));

if (chain.entry_count !== chain.entries.length) {
  throw new Error(`entry_count mismatch: expected ${chain.entries.length}, got ${chain.entry_count}`);
}

if ((chain.entries.at(-1)?.entry_hash ?? null) !== chain.head_chain_entry_hash) {
  throw new Error("head_chain_entry_hash mismatch");
}

if (expectedRoot !== chain.chain_root) {
  throw new Error(`chain_root mismatch: expected ${expectedRoot}, got ${chain.chain_root}`);
}

console.log(JSON.stringify({
  ok: true,
  grant_id: chain.grant_id,
  entry_count: chain.entry_count,
  head_chain_entry_hash: chain.head_chain_entry_hash,
  chain_root: chain.chain_root
}, null, 2));
