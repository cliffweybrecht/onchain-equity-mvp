#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";

const CHAIN_SCHEMA = "grant-audit-lifecycle-transition-chain-v1";
const CHAIN_VERSION = "1.0.0";
const ENTRY_SCHEMA = "grant-audit-lifecycle-transition-chain-entry-v1";
const ENTRY_VERSION = "1.0.0";

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortKeysRecursive(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursive);
  }
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysRecursive(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(sortKeysRecursive(value));
}

function canonicalHash(value) {
  return sha256Hex(canonicalStringify(value));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(sortKeysRecursive(value), null, 2)}\n`);
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

function deriveFileHash(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return sha256Hex(content);
}

function normalizeNullableHash(value) {
  return value === null ? null : String(value);
}

function buildChainEntryHashPayload(entry) {
  return {
    schema: entry.schema,
    entry_version: entry.entry_version,
    grant_id: entry.grant_id,
    lifecycle_event_id: entry.lifecycle_event_id,
    event_type: entry.event_type,
    event_sequence: entry.event_sequence,
    effective_at: entry.effective_at,
    recorded_at: entry.recorded_at,
    previous_lifecycle_event_id: entry.previous_lifecycle_event_id,
    previous_chain_entry_hash: entry.previous_chain_entry_hash,
    lifecycle_event_artifact_path: entry.lifecycle_event_artifact_path,
    lifecycle_event_artifact_hash: entry.lifecycle_event_artifact_hash,
    lifecycle_event_hash: entry.lifecycle_event_hash,
    lifecycle_lineage_hash: entry.lifecycle_lineage_hash,
    trust_chain_hash: entry.trust_chain_hash,
    lifecycle_inclusion_proof_path: entry.lifecycle_inclusion_proof_path,
    lifecycle_inclusion_proof_hash: entry.lifecycle_inclusion_proof_hash,
    chain_position: entry.chain_position
  };
}

function deriveChainEntryHash(entry) {
  return canonicalHash(buildChainEntryHashPayload(entry));
}

function deriveCumulativeChainHash(previousCumulativeHash, chainEntryHash) {
  return canonicalHash({
    previous_cumulative_chain_hash: previousCumulativeHash,
    chain_entry_hash: chainEntryHash
  });
}

function deriveChainRoot(entries) {
  if (entries.length === 0) return null;
  return entries[entries.length - 1].cumulative_chain_hash;
}

function buildEmptyChain({ grantId, timestamp }) {
  return {
    schema: CHAIN_SCHEMA,
    chain_version: CHAIN_VERSION,
    created_at: timestamp,
    updated_at: timestamp,
    grant_id: grantId,
    entry_count: 0,
    head_lifecycle_event_id: null,
    head_chain_entry_hash: null,
    chain_root: null,
    entries: []
  };
}

function getDeterministicHashes(eventArtifact) {
  return eventArtifact.deterministic_hashes || {};
}

function validateEventRequiredFields(eventArtifact) {
  const required = [
    "grant_id",
    "lifecycle_event_id",
    "event_type",
    "event_sequence",
    "effective_at",
    "recorded_at"
  ];

  for (const field of required) {
    if (!(field in eventArtifact)) {
      throw new Error(`Lifecycle event artifact missing required field: ${field}`);
    }
  }

  const hashes = getDeterministicHashes(eventArtifact);
  const requiredHashes = [
    "artifact_hash",
    "lifecycle_event_hash",
    "lifecycle_lineage_hash",
    "trust_chain_hash"
  ];

  for (const field of requiredHashes) {
    if (!(field in hashes)) {
      throw new Error(`Lifecycle event artifact missing deterministic_hashes.${field}`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);

  const getArgValue = (flag, fallback = null) => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  const eventPath =
    getArgValue("--event", "manifests/grants/grant-lifecycle-event.json");
  const proofPath =
    getArgValue("--proof", "manifests/transparency/lifecycle-inclusion-proof.json");
  const chainPath =
    getArgValue("--chain", "manifests/grants/lifecycle-transition-chain.json");
  const outPath =
    getArgValue("--out", chainPath);
  const timestamp =
    getArgValue("--timestamp", new Date().toISOString());

  ensureFileExists(eventPath);
  ensureFileExists(proofPath);

  const eventArtifact = readJson(eventPath);
  const proofArtifact = readJson(proofPath);

  validateEventRequiredFields(eventArtifact);

  const hashes = getDeterministicHashes(eventArtifact);
  const grantId = eventArtifact.grant_id;

  let chain;
  if (fs.existsSync(chainPath)) {
    chain = readJson(chainPath);
  } else {
    chain = buildEmptyChain({ grantId, timestamp });
  }

  if (chain.grant_id !== grantId) {
    throw new Error(
      `Grant mismatch: chain grant_id=${chain.grant_id} event grant_id=${grantId}`
    );
  }

  const eventId = eventArtifact.lifecycle_event_id;

  const duplicate = chain.entries.find(
    (entry) => entry.lifecycle_event_id === eventId
  );
  if (duplicate) {
    throw new Error(
      `Lifecycle event already present in chain for grant_id=${grantId}: ${eventId}`
    );
  }

  const lastEntry =
    chain.entries.length > 0 ? chain.entries[chain.entries.length - 1] : null;

  if (lastEntry && eventArtifact.event_sequence <= lastEntry.event_sequence) {
    throw new Error(
      `Non-monotonic event_sequence: new=${eventArtifact.event_sequence} last=${lastEntry.event_sequence}`
    );
  }

  if (lastEntry && eventArtifact.recorded_at < lastEntry.recorded_at) {
    throw new Error(
      `Non-monotonic recorded_at: new=${eventArtifact.recorded_at} last=${lastEntry.recorded_at}`
    );
  }

  const entry = {
    schema: ENTRY_SCHEMA,
    entry_version: ENTRY_VERSION,
    grant_id: grantId,
    lifecycle_event_id: eventArtifact.lifecycle_event_id,
    event_type: eventArtifact.event_type,
    event_sequence: eventArtifact.event_sequence,
    effective_at: eventArtifact.effective_at,
    recorded_at: eventArtifact.recorded_at,
    previous_lifecycle_event_id: lastEntry ? lastEntry.lifecycle_event_id : null,
    previous_chain_entry_hash: lastEntry ? lastEntry.chain_entry_hash : null,
    lifecycle_event_artifact_path: eventPath,
    lifecycle_event_artifact_hash: hashes.artifact_hash || deriveFileHash(eventPath),
    lifecycle_event_hash: hashes.lifecycle_event_hash,
    lifecycle_lineage_hash: hashes.lifecycle_lineage_hash,
    trust_chain_hash: hashes.trust_chain_hash,
    lifecycle_inclusion_proof_path: proofPath,
    lifecycle_inclusion_proof_hash:
      proofArtifact.proof_hash || deriveFileHash(proofPath),
    chain_position: chain.entries.length,
    chain_entry_hash: "",
    cumulative_chain_hash: ""
  };

  entry.chain_entry_hash = deriveChainEntryHash(entry);
  entry.cumulative_chain_hash = deriveCumulativeChainHash(
    lastEntry ? lastEntry.cumulative_chain_hash : null,
    entry.chain_entry_hash
  );

  const nextEntries = [...chain.entries, entry];

  const nextChain = {
    schema: CHAIN_SCHEMA,
    chain_version: CHAIN_VERSION,
    created_at: chain.created_at || timestamp,
    updated_at: timestamp,
    grant_id: grantId,
    entry_count: nextEntries.length,
    head_lifecycle_event_id: entry.lifecycle_event_id,
    head_chain_entry_hash: entry.chain_entry_hash,
    chain_root: deriveChainRoot(nextEntries),
    entries: nextEntries
  };

  writeJson(outPath, nextChain);

  console.log(
    JSON.stringify(
      {
        ok: true,
        grant_id: grantId,
        appended_lifecycle_event_id: entry.lifecycle_event_id,
        chain_position: entry.chain_position,
        previous_lifecycle_event_id: entry.previous_lifecycle_event_id,
        previous_chain_entry_hash: normalizeNullableHash(
          entry.previous_chain_entry_hash
        ),
        chain_entry_hash: entry.chain_entry_hash,
        cumulative_chain_hash: entry.cumulative_chain_hash,
        chain_root: nextChain.chain_root,
        entry_count: nextChain.entry_count,
        output_path: outPath
      },
      null,
      2
    )
  );
}

main();
