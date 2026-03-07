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

function q(v) {
  if (!/^[0-9]+$/.test(String(v))) throw new Error(`Invalid normalized quantity: ${v}`);
  return String(v);
}

function expectedNormalization(event) {
  const type = String(event.event_type).toLowerCase();
  const qty = event.quantity == null ? null : q(event.quantity);

  if (type === "vesting") {
    return { vested_delta: q(qty), exercised_delta: "0", cancelled_delta: "0", forfeited_delta: "0" };
  }
  if (type === "exercise") {
    return { vested_delta: "0", exercised_delta: q(qty), cancelled_delta: "0", forfeited_delta: "0" };
  }
  if (type === "cancellation" || type === "cancelled") {
    return { vested_delta: "0", exercised_delta: "0", cancelled_delta: q(qty), forfeited_delta: "0" };
  }
  if (type === "forfeiture" || type === "forfeited") {
    return { vested_delta: "0", exercised_delta: "0", cancelled_delta: "0", forfeited_delta: q(qty) };
  }
  return null;
}

const filePath = process.argv[2] || "manifests/grants/grant-lifecycle-event.json";
const event = readJson(filePath);

const { event_hash, ...body } = event;
const recalculated = sha256Hex(canonicalStringify(body));

if (recalculated !== event_hash) {
  throw new Error(`event_hash mismatch: expected ${event_hash}, recalculated ${recalculated}`);
}

const nq = event.quantity_normalization ?? {
  schema: "grant-audit-lifecycle-quantity-normalization-v1",
  normalization_version: "1.0.0",
  mode: "legacy-zero",
  source_quantity: event.quantity ?? null,
  vested_delta: "0",
  exercised_delta: "0",
  cancelled_delta: "0",
  forfeited_delta: "0"
};

["vested_delta", "exercised_delta", "cancelled_delta", "forfeited_delta"].forEach((k) => q(nq[k]));

const expected = expectedNormalization(event);
if (expected && nq.mode !== "explicit") {
  for (const [k, v] of Object.entries(expected)) {
    if (nq[k] !== v) {
      throw new Error(`quantity_normalization.${k} mismatch: expected ${v}, got ${nq[k]}`);
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  grant_id: event.grant_id,
  event_id: event.event_id,
  event_type: event.event_type,
  event_hash: event.event_hash,
  quantity_normalization: nq
}, null, 2));
