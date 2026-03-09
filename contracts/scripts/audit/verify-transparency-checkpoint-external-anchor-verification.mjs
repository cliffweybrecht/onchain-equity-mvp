#!/usr/bin/env node

import fs from "fs";
import crypto from "crypto";
import { execFileSync } from "child_process";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sortKeysRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }

  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysRecursively(value[key]);
    }
    return sorted;
  }

  return value;
}

function canonicalize(value) {
  return JSON.stringify(sortKeysRecursively(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value) {
  return sha256Hex(canonicalize(value));
}

function resolveGitCommit(ref) {
  const output = execFileSync("git", ["rev-parse", ref], {
    encoding: "utf8"
  }).trim();

  assert(/^[a-f0-9]{40}$/.test(output), "Invalid git commit");

  return output;
}

function parseGitLocator(locator) {
  const match = locator.match(
    /^git:\/\/github\.com\/([^/]+)\/([^#]+)\.git#([a-f0-9]{40})$/
  );

  assert(match, "Invalid git anchor locator");

  return {
    owner: match[1],
    repo: match[2],
    ref: match[3]
  };
}

function main() {

  const verificationPath =
    process.argv[2] ||
    "../manifests/transparency/checkpoint-external-anchor-verification.json";

  const verification = readJson(verificationPath);

  assert(
    verification.schema ===
      "grant-audit-transparency-checkpoint-external-anchor-verification-v1",
    "Invalid verification schema"
  );

  const receipt = readJson(verification.external_anchor_receipt_path);

  for (const entry of verification.entries) {

    const parsed = parseGitLocator(entry.anchor_locator);

    assert(
      parsed.ref === entry.expected_anchor_identifier,
      "Anchor identifier mismatch"
    );

    const resolved = resolveGitCommit(parsed.ref);

    assert(
      resolved === entry.resolved_commit_hash,
      "Resolved commit mismatch"
    );

    assert(
      resolved === entry.expected_anchor_identifier,
      "Commit does not match anchor"
    );

    const recomputedHash = canonicalHash({
      schema: entry.schema,
      entry_version: entry.entry_version,
      anchor_type: entry.anchor_type,
      anchor_network: entry.anchor_network,
      anchor_label: entry.anchor_label,
      anchor_locator: entry.anchor_locator,
      expected_anchor_identifier: entry.expected_anchor_identifier,
      resolved_reference: entry.resolved_reference,
      resolution_method: entry.resolution_method,
      resolved_commit_hash: entry.resolved_commit_hash,
      repository_owner: entry.repository_owner,
      repository_name: entry.repository_name,
      repository_url: entry.repository_url,
      expected_external_anchor_hash: entry.expected_external_anchor_hash,
      expected_checkpoint_hash: entry.expected_checkpoint_hash,
      expected_transparency_log_root: entry.expected_transparency_log_root,
      expected_checkpoint_witnesses_hash:
        entry.expected_checkpoint_witnesses_hash,
      expected_checkpoint_finalization_hash:
        entry.expected_checkpoint_finalization_hash,
      expected_checkpoint_rebinding_hash:
        entry.expected_checkpoint_rebinding_hash,
      verification_status: entry.verification_status
    });

    assert(
      recomputedHash === entry.verification_material_hash,
      "Entry hash mismatch"
    );
  }

  const recomputedSetHash = canonicalHash({
    entry_hashes: verification.entries.map(
      (e) => e.verification_material_hash
    )
  });

  assert(
    recomputedSetHash === verification.verification_set_hash,
    "verification_set_hash mismatch"
  );

  const recomputedArtifactHash = canonicalHash({
    schema: verification.schema,
    verification_version: verification.verification_version,
    phase: verification.phase,
    external_anchor_receipt_path: verification.external_anchor_receipt_path,
    checkpoint_hash: verification.checkpoint_hash,
    transparency_log_root: verification.transparency_log_root,
    checkpoint_witnesses_hash: verification.checkpoint_witnesses_hash,
    checkpoint_finalization_hash: verification.checkpoint_finalization_hash,
    checkpoint_rebinding_hash: verification.checkpoint_rebinding_hash,
    anchor_set_hash: verification.anchor_set_hash,
    external_anchor_hash: verification.external_anchor_hash,
    entry_count: verification.entry_count,
    entries: verification.entries,
    verification_set_hash: verification.verification_set_hash
  });

  assert(
    recomputedArtifactHash ===
      verification.external_anchor_verification_hash,
    "external_anchor_verification_hash mismatch"
  );

  console.log(
    JSON.stringify(
      {
        schema: verification.schema,
        phase: verification.phase,
        verification_status: "verified",
        entry_count: verification.entry_count,
        external_anchor_verification_hash:
          verification.external_anchor_verification_hash
      },
      null,
      2
    )
  );
}

main();
