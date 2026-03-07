#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const SOURCE_MANIFEST_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-transition-chain.json"
);
const OUTPUT_MANIFEST_PATH = path.join(
  ROOT,
  "manifests/grants/lifecycle-state-snapshot.json"
);
const EVIDENCE_DIR = path.join(ROOT, "evidence/phase-7.23");
const EVIDENCE_JSON_PATH = path.join(
  EVIDENCE_DIR,
  "lifecycle-state-snapshot.json"
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function parseIntegerLike(value, fallback = "0") {
  if (value === undefined || value === null || value === "") {
    return BigInt(fallback);
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`Non-integer numeric value encountered: ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (!/^-?[0-9]+$/.test(value)) {
      throw new Error(`Expected integer-like string, got: ${value}`);
    }
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

  if (!eventId) {
    throw new Error(
      `Lifecycle chain entry missing event id. Entry keys: ${Object.keys(chainEntry || {}).join(", ")}`
    );
  }

  if (!eventType) {
    throw new Error(`Lifecycle event ${eventId} missing event_type`);
  }

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

  if (normalized.includes("cancel")) {
    return "cancelled";
  }

  if (normalized.includes("forfeit")) {
    return "forfeited";
  }

  if (normalized.includes("exercise") && currentBalance === 0n) {
    return "exercised_out";
  }

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

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Transition chain manifest has no entries array");
  }
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

function getChainRoot(chainManifest) {
  return chainManifest.chain_root;
}

function main() {
  ensureDir(EVIDENCE_DIR);

  const chainManifest = readJson(SOURCE_MANIFEST_PATH);
  const entries = getEntries(chainManifest);

  const grantId = getGrantId(chainManifest, entries);
  if (!grantId) {
    throw new Error("Unable to resolve grant_id from lifecycle transition chain");
  }

  const chainRoot = getChainRoot(chainManifest);
  if (!chainRoot) {
    throw new Error("Transition chain manifest missing chain_root");
  }

  const headChainEntryHash = getHeadEntryHash(chainManifest, entries);
  if (!headChainEntryHash) {
    throw new Error("Unable to resolve head_chain_entry_hash");
  }

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

  if (!latestEventId || !latestEventType) {
    throw new Error("Unable to resolve latest lifecycle event");
  }

  if (!lifecycleLineageHash) {
    throw new Error("Unable to resolve lifecycle_lineage_hash from chain");
  }

  if (!trustChainHash) {
    throw new Error("Unable to resolve trust_chain_hash from chain");
  }

  const currentBalance =
    totalVested - totalExercised - totalCancelled - totalForfeited;

  const currentState = resolveCurrentState(latestEventType, currentBalance, {
    totalVested,
    totalExercised,
    totalCancelled,
    totalForfeited
  });

  const snapshot = {
    artifact_type: "grant-audit-lifecycle-state-snapshot",
    schema_version: "v1",
    grant_id: grantId,
    source_transition_chain: {
      manifest_path: "manifests/grants/lifecycle-transition-chain.json",
      entry_count: entries.length,
      chain_root: chainRoot,
      head_chain_entry_hash: headChainEntryHash
    },
    snapshot_bindings: {
      chain_root: chainRoot,
      head_chain_entry_hash: headChainEntryHash,
      lifecycle_lineage_hash: lifecycleLineageHash,
      trust_chain_hash: trustChainHash
    },
    latest_event: {
      event_id: latestEventId,
      event_type: latestEventType
    },
    state: {
      grant_id: grantId,
      current_state: currentState,
      latest_event_id: latestEventId,
      latest_event_type: latestEventType,
      total_vested: totalVested.toString(),
      total_exercised: totalExercised.toString(),
      total_cancelled: totalCancelled.toString(),
      total_forfeited: totalForfeited.toString(),
      current_balance: currentBalance.toString()
    },
    derivation_rules: {
      totals_model:
        "Replay ordered transition chain entries; accumulate vested/exercised/cancelled/forfeited integer deltas; compute current_balance = total_vested - total_exercised - total_cancelled - total_forfeited.",
      state_resolution_model:
        "Resolve current_state from latest event type and normalized totals: cancellation => cancelled; forfeiture => forfeited; exercise with zero balance => exercised_out; vesting or positive balance => active; otherwise unknown.",
      forward_compatibility:
        "Unknown future event types do not break verification so long as normalized deltas and required lineage/trust bindings remain present; unrecognized event types fall back to totals-driven state resolution."
    },
    canonicalization: {
      algorithm: "recursive-key-sorted-canonical-json",
      hash_algorithm: "sha256"
    }
  };

  const snapshotHash = sha256Hex(canonicalStringify(snapshot));
  snapshot.snapshot_hash = snapshotHash;

  const pretty = JSON.stringify(sortRecursively(snapshot), null, 2) + "\n";
  fs.writeFileSync(OUTPUT_MANIFEST_PATH, pretty);
  fs.writeFileSync(EVIDENCE_JSON_PATH, pretty);

  const summary = {
    grant_id: grantId,
    entry_count: entries.length,
    latest_event_id: latestEventId,
    latest_event_type: latestEventType,
    current_state: currentState,
    total_vested: totalVested.toString(),
    total_exercised: totalExercised.toString(),
    total_cancelled: totalCancelled.toString(),
    total_forfeited: totalForfeited.toString(),
    current_balance: currentBalance.toString(),
    head_chain_entry_hash: headChainEntryHash,
    chain_root: chainRoot,
    lifecycle_lineage_hash: lifecycleLineageHash,
    trust_chain_hash: trustChainHash,
    snapshot_hash: snapshotHash,
    output_manifest: "manifests/grants/lifecycle-state-snapshot.json",
    evidence_manifest: "evidence/phase-7.23/lifecycle-state-snapshot.json"
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
