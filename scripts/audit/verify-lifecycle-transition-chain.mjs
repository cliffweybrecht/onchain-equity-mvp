#!/usr/bin/env node

import fs from "fs";
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

function deriveChainEntryHash(entry) {
  return canonicalHash({
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
  });
}

function deriveCumulativeChainHash(previousCumulativeHash, chainEntryHash) {
  return canonicalHash({
    previous_cumulative_chain_hash: previousCumulativeHash,
    chain_entry_hash: chainEntryHash
  });
}

function deriveFileHash(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return sha256Hex(content);
}

function getDeterministicHashes(eventArtifact) {
  return eventArtifact.deterministic_hashes || {};
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
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

  const chainPath = getArgValue(
    "--chain",
    "manifests/grants/lifecycle-transition-chain.json"
  );

  if (!fs.existsSync(chainPath)) {
    fail(`Lifecycle transition chain not found: ${chainPath}`);
  }

  const chain = readJson(chainPath);

  if (chain.schema !== CHAIN_SCHEMA) {
    fail(`Invalid chain schema: ${chain.schema}`);
  }

  if (chain.chain_version !== CHAIN_VERSION) {
    fail(`Invalid chain version: ${chain.chain_version}`);
  }

  if (!Array.isArray(chain.entries)) {
    fail("Chain entries must be an array");
  }

  if (chain.entry_count !== chain.entries.length) {
    fail(
      `entry_count mismatch: manifest=${chain.entry_count} actual=${chain.entries.length}`
    );
  }

  let previousEntry = null;

  for (let i = 0; i < chain.entries.length; i += 1) {
    const entry = chain.entries[i];

    if (entry.schema !== ENTRY_SCHEMA) {
      fail(`Invalid entry schema at index ${i}: ${entry.schema}`);
    }

    if (entry.entry_version !== ENTRY_VERSION) {
      fail(`Invalid entry version at index ${i}: ${entry.entry_version}`);
    }

    if (entry.grant_id !== chain.grant_id) {
      fail(
        `grant_id mismatch at index ${i}: chain=${chain.grant_id} entry=${entry.grant_id}`
      );
    }

    if (entry.chain_position !== i) {
      fail(
        `chain_position mismatch at index ${i}: expected=${i} actual=${entry.chain_position}`
      );
    }

    if (previousEntry === null) {
      if (entry.previous_lifecycle_event_id !== null) {
        fail(`Genesis entry previous_lifecycle_event_id must be null at index ${i}`);
      }
      if (entry.previous_chain_entry_hash !== null) {
        fail(`Genesis entry previous_chain_entry_hash must be null at index ${i}`);
      }
    } else {
      if (entry.previous_lifecycle_event_id !== previousEntry.lifecycle_event_id) {
        fail(
          `Broken previous_lifecycle_event_id link at index ${i}: expected=${previousEntry.lifecycle_event_id} actual=${entry.previous_lifecycle_event_id}`
        );
      }

      if (entry.previous_chain_entry_hash !== previousEntry.chain_entry_hash) {
        fail(
          `Broken previous_chain_entry_hash link at index ${i}: expected=${previousEntry.chain_entry_hash} actual=${entry.previous_chain_entry_hash}`
        );
      }

      if (entry.event_sequence <= previousEntry.event_sequence) {
        fail(
          `Non-monotonic event_sequence at index ${i}: previous=${previousEntry.event_sequence} current=${entry.event_sequence}`
        );
      }

      if (entry.recorded_at < previousEntry.recorded_at) {
        fail(
          `Non-monotonic recorded_at at index ${i}: previous=${previousEntry.recorded_at} current=${entry.recorded_at}`
        );
      }
    }

    if (!fs.existsSync(entry.lifecycle_event_artifact_path)) {
      fail(
        `Missing lifecycle event artifact for index ${i}: ${entry.lifecycle_event_artifact_path}`
      );
    }

    if (!fs.existsSync(entry.lifecycle_inclusion_proof_path)) {
      fail(
        `Missing lifecycle inclusion proof for index ${i}: ${entry.lifecycle_inclusion_proof_path}`
      );
    }

    const eventArtifact = readJson(entry.lifecycle_event_artifact_path);
    const proofArtifact = readJson(entry.lifecycle_inclusion_proof_path);
    const hashes = getDeterministicHashes(eventArtifact);

    const computedArtifactHash = hashes.artifact_hash || deriveFileHash(entry.lifecycle_event_artifact_path);
    if (computedArtifactHash !== entry.lifecycle_event_artifact_hash) {
      fail(
        `lifecycle_event_artifact_hash mismatch at index ${i}: expected=${entry.lifecycle_event_artifact_hash} actual=${computedArtifactHash}`
      );
    }

    if (hashes.lifecycle_event_hash !== entry.lifecycle_event_hash) {
      fail(
        `lifecycle_event_hash mismatch at index ${i}: expected=${entry.lifecycle_event_hash} actual=${hashes.lifecycle_event_hash}`
      );
    }

    if (hashes.lifecycle_lineage_hash !== entry.lifecycle_lineage_hash) {
      fail(
        `lifecycle_lineage_hash mismatch at index ${i}: expected=${entry.lifecycle_lineage_hash} actual=${hashes.lifecycle_lineage_hash}`
      );
    }

    if (hashes.trust_chain_hash !== entry.trust_chain_hash) {
      fail(
        `trust_chain_hash mismatch at index ${i}: expected=${entry.trust_chain_hash} actual=${hashes.trust_chain_hash}`
      );
    }

    if (eventArtifact.grant_id !== entry.grant_id) {
      fail(
        `Event grant_id mismatch at index ${i}: expected=${entry.grant_id} actual=${eventArtifact.grant_id}`
      );
    }

    if (eventArtifact.lifecycle_event_id !== entry.lifecycle_event_id) {
      fail(
        `Event lifecycle_event_id mismatch at index ${i}: expected=${entry.lifecycle_event_id} actual=${eventArtifact.lifecycle_event_id}`
      );
    }

    if (eventArtifact.event_type !== entry.event_type) {
      fail(
        `Event event_type mismatch at index ${i}: expected=${entry.event_type} actual=${eventArtifact.event_type}`
      );
    }

    if (eventArtifact.event_sequence !== entry.event_sequence) {
      fail(
        `Event event_sequence mismatch at index ${i}: expected=${entry.event_sequence} actual=${eventArtifact.event_sequence}`
      );
    }

    if (eventArtifact.effective_at !== entry.effective_at) {
      fail(
        `Event effective_at mismatch at index ${i}: expected=${entry.effective_at} actual=${eventArtifact.effective_at}`
      );
    }

    if (eventArtifact.recorded_at !== entry.recorded_at) {
      fail(
        `Event recorded_at mismatch at index ${i}: expected=${entry.recorded_at} actual=${eventArtifact.recorded_at}`
      );
    }

    const computedProofHash = proofArtifact.proof_hash || deriveFileHash(entry.lifecycle_inclusion_proof_path);
    if (computedProofHash !== entry.lifecycle_inclusion_proof_hash) {
      fail(
        `lifecycle_inclusion_proof_hash mismatch at index ${i}: expected=${entry.lifecycle_inclusion_proof_hash} actual=${computedProofHash}`
      );
    }

    const computedEntryHash = deriveChainEntryHash(entry);
    if (computedEntryHash !== entry.chain_entry_hash) {
      fail(
        `chain_entry_hash mismatch at index ${i}: expected=${entry.chain_entry_hash} actual=${computedEntryHash}`
      );
    }

    const computedCumulativeHash = deriveCumulativeChainHash(
      previousEntry ? previousEntry.cumulative_chain_hash : null,
      entry.chain_entry_hash
    );
    if (computedCumulativeHash !== entry.cumulative_chain_hash) {
      fail(
        `cumulative_chain_hash mismatch at index ${i}: expected=${entry.cumulative_chain_hash} actual=${computedCumulativeHash}`
      );
    }

    previousEntry = entry;
  }

  const expectedHeadEventId =
    chain.entries.length > 0 ? chain.entries[chain.entries.length - 1].lifecycle_event_id : null;
  const expectedHeadEntryHash =
    chain.entries.length > 0 ? chain.entries[chain.entries.length - 1].chain_entry_hash : null;
  const expectedChainRoot =
    chain.entries.length > 0 ? chain.entries[chain.entries.length - 1].cumulative_chain_hash : null;

  if (chain.head_lifecycle_event_id !== expectedHeadEventId) {
    fail(
      `head_lifecycle_event_id mismatch: expected=${expectedHeadEventId} actual=${chain.head_lifecycle_event_id}`
    );
  }

  if (chain.head_chain_entry_hash !== expectedHeadEntryHash) {
    fail(
      `head_chain_entry_hash mismatch: expected=${expectedHeadEntryHash} actual=${chain.head_chain_entry_hash}`
    );
  }

  if (chain.chain_root !== expectedChainRoot) {
    fail(
      `chain_root mismatch: expected=${expectedChainRoot} actual=${chain.chain_root}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        chain_path: chainPath,
        grant_id: chain.grant_id,
        entry_count: chain.entry_count,
        head_lifecycle_event_id: chain.head_lifecycle_event_id,
        head_chain_entry_hash: chain.head_chain_entry_hash,
        chain_root: chain.chain_root
      },
      null,
      2
    )
  );
}

main();
