#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const SOURCE_CHAIN_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-transition-chain.json"
);
const SNAPSHOT_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-state-snapshot.json"
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortRecursively);
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortRecursively(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(sortRecursively(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseIntegerLike(value, fallback = "0") {
  if (value === undefined || value === null || value === "") {
    return BigInt(fallback);
  }
  if (typeof value === "number") {
    assert(Number.isInteger(value), `Non-integer numeric value encountered: ${value}`);
    return BigInt(value);
  }
  if (typeof value === "string") {
    assert(/^-?[0-9]+$/.test(value), `Expected integer-like string, got: ${value}`);
    return BigInt(value);
  }
  throw new Error(`Unsupported integer-like value type: ${typeof value}`);
}

function findValueDeep(obj, candidateKeys) {
  if (!obj || typeof obj !== "object") return undefined;

  for (const key of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key];
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findValueDeep(value, candidateKeys);
      if (found !== undefined) return found;
    }
  }

  return undefined;
}

function collectCandidateObjects(chainEntry) {
  const candidates = [chainEntry];

  const possibleNestedKeys = [
    "lifecycle_event",
    "lifecycleEvent",
    "event",
    "event_ref",
    "event_reference",
    "lifecycle_event_ref",
    "lifecycle_event_reference",
    "bindings",
    "binding",
    "references",
    "refs",
    "source_event",
    "source",
    "head",
    "latest_event"
  ];

  for (const key of possibleNestedKeys) {
    const value = chainEntry?.[key];
    if (isPlainObject(value)) {
      candidates.push(value);
    }
  }

  for (const value of Object.values(chainEntry || {})) {
    if (isPlainObject(value)) {
      candidates.push(value);
    }
  }

  return candidates;
}

function firstDefinedFromCandidates(candidates, keys) {
  for (const candidate of candidates) {
    const found = findValueDeep(candidate, keys);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function extractEventEntry(chainEntry) {
  const candidates = collectCandidateObjects(chainEntry);

  const eventId = firstDefinedFromCandidates(candidates, [
    "event_id",
    "lifecycle_event_id",
    "id",
    "head_lifecycle_event_id",
    "latest_event_id"
  ]);

  const eventType = firstDefinedFromCandidates(candidates, [
    "event_type",
    "lifecycle_transition_type",
    "lifecycle_event_type",
    "type",
    "latest_event_type"
  ]);

  assert(
    !!eventId,
    `Lifecycle chain entry missing event id. Entry keys: ${Object.keys(chainEntry || {}).join(", ")}`
  );
  assert(!!eventType, `Lifecycle event ${eventId} missing event_type`);

  const vestedDelta = parseIntegerLike(
    firstDefinedFromCandidates(candidates, [
      "vested_delta",
      "vest_delta",
      "newly_vested",
      "vested_amount",
      "quantity_vested",
      "vested",
      "amount_vested"
    ]),
    "0"
  );

  const exercisedDelta = parseIntegerLike(
    firstDefinedFromCandidates(candidates, [
      "exercised_delta",
      "exercise_delta",
      "quantity_exercised",
      "exercised_amount",
      "exercised",
      "amount_exercised"
    ]),
    "0"
  );

  const cancelledDelta = parseIntegerLike(
    firstDefinedFromCandidates(candidates, [
      "cancelled_delta",
      "canceled_delta",
      "quantity_cancelled",
      "quantity_canceled",
      "cancelled_amount",
      "canceled_amount",
      "cancelled",
      "canceled",
      "amount_cancelled",
      "amount_canceled"
    ]),
    "0"
  );

  const forfeitedDelta = parseIntegerLike(
    firstDefinedFromCandidates(candidates, [
      "forfeited_delta",
      "forfeit_delta",
      "quantity_forfeited",
      "forfeited_amount",
      "forfeited",
      "amount_forfeited"
    ]),
    "0"
  );

  const lifecycleLineageHash = firstDefinedFromCandidates(candidates, [
    "lifecycle_lineage_hash"
  ]);

  const trustChainHash = firstDefinedFromCandidates(candidates, [
    "trust_chain_hash"
  ]);

  return {
    eventId,
    eventType,
    vestedDelta,
    exercisedDelta,
    cancelledDelta,
    forfeitedDelta,
    lifecycleLineageHash,
    trustChainHash
  };
}

function resolveCurrentState(latestEventType, currentBalance, totals) {
  const normalized = String(latestEventType).toLowerCase();

  if (normalized.includes("cancel")) return "cancelled";
  if (normalized.includes("forfeit")) return "forfeited";
  if (normalized.includes("exercise") && currentBalance === 0n) return "exercised_out";
  if (
    normalized.includes("vest") ||
    totals.totalVested > 0n ||
    currentBalance > 0n
  ) {
    return "active";
  }

  return "unknown";
}

function getEntries(chainManifest) {
  const entries =
    chainManifest.entries ||
    chainManifest.transition_chain_entries ||
    chainManifest.lifecycle_transition_chain_entries ||
    chainManifest.chain_entries;

  assert(Array.isArray(entries) && entries.length > 0, "Transition chain manifest has no entries array");
  return entries;
}

function getGrantId(chainManifest, entries) {
  return (
    chainManifest.grant_id ||
    chainManifest.state?.grant_id ||
    findValueDeep(entries[0], ["grant_id"])
  );
}

function getHeadEntryHash(chainManifest, entries) {
  return (
    chainManifest.head_chain_entry_hash ||
    entries[entries.length - 1]?.chain_entry_hash ||
    entries[entries.length - 1]?.entry_hash
  );
}

function main() {
  const chainManifest = readJson(SOURCE_CHAIN_PATH);
  const snapshot = readJson(SNAPSHOT_PATH);

  assert(
    snapshot.artifact_type === "grant-audit-lifecycle-state-snapshot",
    "Invalid artifact_type"
  );
  assert(snapshot.schema_version === "v1", "Invalid schema_version");

  const entries = getEntries(chainManifest);
  const grantId = getGrantId(chainManifest, entries);
  const chainRoot = chainManifest.chain_root;
  const headChainEntryHash = getHeadEntryHash(chainManifest, entries);

  assert(grantId, "Unable to resolve grant_id from transition chain");
  assert(chainRoot, "Transition chain missing chain_root");
  assert(headChainEntryHash, "Unable to resolve head_chain_entry_hash");

  let totalVested = 0n;
  let totalExercised = 0n;
  let totalCancelled = 0n;
  let totalForfeited = 0n;

  let latestEventId = null;
  let latestEventType = null;
  let lifecycleLineageHash = null;
  let trustChainHash = null;

  for (const entry of entries) {
    const extracted = extractEventEntry(entry);

    totalVested += extracted.vestedDelta;
    totalExercised += extracted.exercisedDelta;
    totalCancelled += extracted.cancelledDelta;
    totalForfeited += extracted.forfeitedDelta;

    latestEventId = extracted.eventId;
    latestEventType = extracted.eventType;

    if (extracted.lifecycleLineageHash) {
      lifecycleLineageHash = extracted.lifecycleLineageHash;
    }
    if (extracted.trustChainHash) {
      trustChainHash = extracted.trustChainHash;
    }
  }

  assert(lifecycleLineageHash, "Unable to resolve lifecycle_lineage_hash");
  assert(trustChainHash, "Unable to resolve trust_chain_hash");

  const currentBalance =
    totalVested - totalExercised - totalCancelled - totalForfeited;

  const expectedCurrentState = resolveCurrentState(latestEventType, currentBalance, {
    totalVested,
    totalExercised,
    totalCancelled,
    totalForfeited
  });

  assert(snapshot.grant_id === grantId, "Snapshot grant_id mismatch");
  assert(
    snapshot.source_transition_chain?.manifest_path ===
      "manifests/grants/lifecycle-transition-chain.json",
    "Snapshot source manifest path mismatch"
  );
  assert(
    snapshot.source_transition_chain?.entry_count === entries.length,
    "Snapshot entry_count mismatch"
  );
  assert(
    snapshot.source_transition_chain?.chain_root === chainRoot,
    "Snapshot source chain_root mismatch"
  );
  assert(
    snapshot.source_transition_chain?.head_chain_entry_hash === headChainEntryHash,
    "Snapshot source head_chain_entry_hash mismatch"
  );

  assert(
    snapshot.snapshot_bindings?.chain_root === chainRoot,
    "Snapshot binding chain_root mismatch"
  );
  assert(
    snapshot.snapshot_bindings?.head_chain_entry_hash === headChainEntryHash,
    "Snapshot binding head_chain_entry_hash mismatch"
  );
  assert(
    snapshot.snapshot_bindings?.lifecycle_lineage_hash === lifecycleLineageHash,
    "Snapshot binding lifecycle_lineage_hash mismatch"
  );
  assert(
    snapshot.snapshot_bindings?.trust_chain_hash === trustChainHash,
    "Snapshot binding trust_chain_hash mismatch"
  );

  assert(
    snapshot.latest_event?.event_id === latestEventId,
    "Snapshot latest event id mismatch"
  );
  assert(
    snapshot.latest_event?.event_type === latestEventType,
    "Snapshot latest event type mismatch"
  );

  assert(snapshot.state?.grant_id === grantId, "State grant_id mismatch");
  assert(
    snapshot.state?.latest_event_id === latestEventId,
    "State latest_event_id mismatch"
  );
  assert(
    snapshot.state?.latest_event_type === latestEventType,
    "State latest_event_type mismatch"
  );
  assert(
    snapshot.state?.total_vested === totalVested.toString(),
    "State total_vested mismatch"
  );
  assert(
    snapshot.state?.total_exercised === totalExercised.toString(),
    "State total_exercised mismatch"
  );
  assert(
    snapshot.state?.total_cancelled === totalCancelled.toString(),
    "State total_cancelled mismatch"
  );
  assert(
    snapshot.state?.total_forfeited === totalForfeited.toString(),
    "State total_forfeited mismatch"
  );
  assert(
    snapshot.state?.current_balance === currentBalance.toString(),
    "State current_balance mismatch"
  );
  assert(
    snapshot.state?.current_state === expectedCurrentState,
    "State current_state mismatch"
  );

  assert(
    snapshot.canonicalization?.algorithm === "recursive-key-sorted-canonical-json",
    "Canonicalization algorithm mismatch"
  );
  assert(
    snapshot.canonicalization?.hash_algorithm === "sha256",
    "Hash algorithm mismatch"
  );

  const withoutHash = { ...snapshot };
  delete withoutHash.snapshot_hash;

  const recomputedSnapshotHash = sha256Hex(canonicalStringify(withoutHash));

  assert(
    snapshot.snapshot_hash === recomputedSnapshotHash,
    "Snapshot hash mismatch"
  );

  const summary = {
    verified: true,
    grant_id: grantId,
    entry_count: entries.length,
    latest_event_id: latestEventId,
    latest_event_type: latestEventType,
    current_state: expectedCurrentState,
    total_vested: totalVested.toString(),
    total_exercised: totalExercised.toString(),
    total_cancelled: totalCancelled.toString(),
    total_forfeited: totalForfeited.toString(),
    current_balance: currentBalance.toString(),
    head_chain_entry_hash: headChainEntryHash,
    chain_root: chainRoot,
    lifecycle_lineage_hash: lifecycleLineageHash,
    trust_chain_hash: trustChainHash,
    snapshot_hash: recomputedSnapshotHash
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
