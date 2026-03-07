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

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sortKeysDeep(data), null, 2) + "\n");
}

function q(v) {
  if (v === undefined || v === null || v === "") return "0";
  if (!/^[0-9]+$/.test(String(v))) {
    throw new Error(`Invalid quantity: ${v}`);
  }
  return String(v);
}

function normalizeQuantities({ eventType, quantity, vested, exercised, cancelled, forfeited }) {
  const type = String(eventType).toLowerCase();
  const qty = quantity == null ? null : q(quantity);

  if (vested || exercised || cancelled || forfeited) {
    return {
      schema: "grant-audit-lifecycle-quantity-normalization-v1",
      normalization_version: "1.0.0",
      mode: "explicit",
      source_quantity: qty,
      vested_delta: q(vested),
      exercised_delta: q(exercised),
      cancelled_delta: q(cancelled),
      forfeited_delta: q(forfeited)
    };
  }

  if (type === "vesting") {
    return {
      schema: "grant-audit-lifecycle-quantity-normalization-v1",
      normalization_version: "1.0.0",
      mode: "derived",
      source_quantity: q(qty),
      vested_delta: q(qty),
      exercised_delta: "0",
      cancelled_delta: "0",
      forfeited_delta: "0"
    };
  }

  if (type === "exercise") {
    return {
      schema: "grant-audit-lifecycle-quantity-normalization-v1",
      normalization_version: "1.0.0",
      mode: "derived",
      source_quantity: q(qty),
      vested_delta: "0",
      exercised_delta: q(qty),
      cancelled_delta: "0",
      forfeited_delta: "0"
    };
  }

  if (type === "cancellation" || type === "cancelled") {
    return {
      schema: "grant-audit-lifecycle-quantity-normalization-v1",
      normalization_version: "1.0.0",
      mode: "derived",
      source_quantity: q(qty),
      vested_delta: "0",
      exercised_delta: "0",
      cancelled_delta: q(qty),
      forfeited_delta: "0"
    };
  }

  if (type === "forfeiture" || type === "forfeited") {
    return {
      schema: "grant-audit-lifecycle-quantity-normalization-v1",
      normalization_version: "1.0.0",
      mode: "derived",
      source_quantity: q(qty),
      vested_delta: "0",
      exercised_delta: "0",
      cancelled_delta: "0",
      forfeited_delta: q(qty)
    };
  }

  return {
    schema: "grant-audit-lifecycle-quantity-normalization-v1",
    normalization_version: "1.0.0",
    mode: "legacy-zero",
    source_quantity: qty,
    vested_delta: "0",
    exercised_delta: "0",
    cancelled_delta: "0",
    forfeited_delta: "0"
  };
}

const args = parseArgs(process.argv);

const outPath = args.out || "manifests/grants/grant-lifecycle-event.json";
const metadata = args.metadata ? JSON.parse(fs.readFileSync(args.metadata, "utf8")) : {};

const quantityNormalization = normalizeQuantities({
  eventType: args["event-type"],
  quantity: args.quantity ?? null,
  vested: args["vested-delta"],
  exercised: args["exercised-delta"],
  cancelled: args["cancelled-delta"],
  forfeited: args["forfeited-delta"]
});

const body = {
  schema: "grant-audit-grant-lifecycle-event-v1",
  event_version: "1.1.0",
  grant_id: args["grant-id"],
  event_id: args["event-id"],
  event_type: args["event-type"],
  effective_at: args["effective-at"],
  previous_state: args["previous-state"] ?? null,
  current_state: args["current-state"],
  quantity: args.quantity ?? null,
  metadata,
  lifecycle_lineage_hash: args["lifecycle-lineage-hash"],
  trust_chain_hash: args["trust-chain-hash"],
  quantity_normalization: quantityNormalization
};

const eventHash = sha256Hex(canonicalStringify(body));
const artifact = {
  ...body,
  event_hash: eventHash
};

writeJson(outPath, artifact);
console.log(JSON.stringify(artifact, null, 2));
