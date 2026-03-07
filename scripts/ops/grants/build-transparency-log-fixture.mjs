#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const OUT_PATH = path.resolve("manifests/transparency/transparency-log-fixture.json");

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

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

const FIXTURE_CREATED_AT = "2026-03-07T03:15:00.000Z";

const FIXTURE_SEEDS = [
  {
    appended_at: "2026-03-07T03:15:00.000Z",
    packet_ref: "fixture/audit-packets/packet-001.json",
    packet_payload: {
      grant_id: "fixture-grant-001",
      employee_id: "employee-alpha",
      issuer_id: "issuer-acme",
      action: "grant-created",
      quantity: "1000",
      strike_price_usd: "0.50"
    }
  },
  {
    appended_at: "2026-03-07T03:16:00.000Z",
    packet_ref: "fixture/audit-packets/packet-002.json",
    packet_payload: {
      grant_id: "fixture-grant-001",
      employee_id: "employee-alpha",
      issuer_id: "issuer-acme",
      action: "vesting-schedule-confirmed",
      vesting_months: 48,
      cliff_months: 12
    }
  },
  {
    appended_at: "2026-03-07T03:17:00.000Z",
    packet_ref: "fixture/audit-packets/packet-003.json",
    packet_payload: {
      grant_id: "fixture-grant-001",
      employee_id: "employee-alpha",
      issuer_id: "issuer-acme",
      action: "compliance-attested",
      jurisdiction: "US-DE",
      reviewer: "compliance-bot-v1"
    }
  }
];

function buildEntry(seed, index, previousEntryHash, previousCumulativeRoot) {
  const packetHash = sha256Hex(canonicalJson(seed.packet_payload));

  const entryCore = {
    schema: "grant-audit-transparency-log-entry-v1",
    entry_version: "1.0.0",
    index,
    appended_at: seed.appended_at,
    packet_ref: seed.packet_ref,
    packet_hash: packetHash,
    previous_entry_hash: previousEntryHash,
    previous_cumulative_root: previousCumulativeRoot
  };

  const entryHash = sha256Hex(canonicalJson(entryCore));
  const cumulativeRoot = sha256Hex(`${previousCumulativeRoot}:${entryHash}`);

  return {
    ...entryCore,
    entry_hash: entryHash,
    cumulative_root: cumulativeRoot
  };
}

function buildFixture() {
  const entries = [];
  let previousEntryHash = "0".repeat(64);
  let previousCumulativeRoot = "0".repeat(64);

  for (let i = 0; i < FIXTURE_SEEDS.length; i += 1) {
    const entry = buildEntry(
      FIXTURE_SEEDS[i],
      i,
      previousEntryHash,
      previousCumulativeRoot
    );

    entries.push(entry);
    previousEntryHash = entry.entry_hash;
    previousCumulativeRoot = entry.cumulative_root;
  }

  const log = {
    schema: "grant-audit-transparency-log-v1",
    log_version: "1.0.0",
    created_at: FIXTURE_SEEDS[0].appended_at,
    updated_at: FIXTURE_SEEDS[FIXTURE_SEEDS.length - 1].appended_at,
    entry_count: entries.length,
    head_entry_hash: entries[entries.length - 1].entry_hash,
    log_root: entries[entries.length - 1].cumulative_root,
    entries
  };

  return {
    schema: "grant-audit-transparency-log-fixture-v1",
    fixture_version: "1.0.0",
    fixture_id: "deterministic-3-entry-multi-size-fixture",
    created_at: FIXTURE_CREATED_AT,
    description:
      "Deterministic synthetic transparency log fixture for multi-size prefix consistency proof verification.",
    transitions: [
      { old_size: 1, new_size: 2 },
      { old_size: 1, new_size: 3 },
      { old_size: 2, new_size: 3 }
    ],
    log
  };
}

function main() {
  const fixture = buildFixture();
  ensureDir(OUT_PATH);
  fs.writeFileSync(OUT_PATH, canonicalJson(fixture));

  console.log(`Wrote ${OUT_PATH}`);
  console.log(`fixture_id=${fixture.fixture_id}`);
  console.log(`entry_count=${fixture.log.entry_count}`);
  console.log(`log_root=${fixture.log.log_root}`);
  console.log(
    `transitions=${fixture.transitions
      .map((t) => `${t.old_size}->${t.new_size}`)
      .join(",")}`
  );
}

main();
