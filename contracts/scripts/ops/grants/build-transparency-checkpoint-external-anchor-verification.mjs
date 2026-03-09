#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";

const DEFAULT_EXTERNAL_ANCHOR_RECEIPT =
  "manifests/transparency/checkpoint-external-anchor.json";
const DEFAULT_OUTPUT_PATH =
  "manifests/transparency/checkpoint-external-anchor-verification.json";

function parseArgs(argv) {
  const args = {
    externalAnchorReceipt: DEFAULT_EXTERNAL_ANCHOR_RECEIPT,
    out: DEFAULT_OUTPUT_PATH
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--external-anchor-receipt") {
      args.externalAnchorReceipt = argv[++i];
    } else if (arg === "--out") {
      args.out = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

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

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function parseGitAnchorLocator(locator) {
  assert(typeof locator === "string" && locator.length > 0, "anchor_locator must be a non-empty string");

  const match = locator.match(/^git:\/\/github\.com\/([^/]+)\/([^#]+)\.git#([a-f0-9]{40})$/);
  assert(
    match,
    `Unsupported git anchor_locator format: ${locator}`
  );

  const [, owner, repo, ref] = match;

  return {
    repository_owner: owner,
    repository_name: repo,
    repository_url: `https://github.com/${owner}/${repo}.git`,
    ref
  };
}

function resolveGitCommit(ref) {
  const output = execFileSync("git", ["rev-parse", ref], {
    encoding: "utf8"
  }).trim();

  assert(/^[a-f0-9]{40}$/.test(output), `Resolved Git commit is invalid: ${output}`);
  return output;
}

function getExternalAnchorEntries(receipt) {
  if (Array.isArray(receipt.anchors)) {
    return receipt.anchors;
  }

  if (Array.isArray(receipt.entries)) {
    return receipt.entries;
  }

  if (Array.isArray(receipt.anchor_entries)) {
    return receipt.anchor_entries;
  }

  if (Array.isArray(receipt.external_anchors)) {
    return receipt.external_anchors;
  }

  throw new Error(
    "Could not locate external anchor entry list in Phase 7.28 receipt. Expected one of: anchors, entries, anchor_entries, external_anchors."
  );
}

function normalizeGitAnchorEntry(entry) {
  const anchorType = entry.anchor_type ?? entry.type;
  assert(anchorType === "git_commit", `Unsupported anchor_type for Phase 7.29: ${anchorType}`);

  const anchorLocator = entry.anchor_locator;
  const parsedLocator = parseGitAnchorLocator(anchorLocator);

  const anchorIdentifier = entry.anchor_identifier;
  assert(
    typeof anchorIdentifier === "string" && /^[a-f0-9]{40}$/.test(anchorIdentifier),
    "anchor_identifier must be a 40-character git commit hash"
  );

  const anchorLabel = `${anchorType}:${anchorIdentifier}`;

  return {
    anchor_type: "git_commit",
    anchor_network: entry.anchor_network ?? "git",
    anchor_label: anchorLabel,
    anchor_locator: anchorLocator,
    expected_anchor_identifier: anchorIdentifier,
    resolved_reference: parsedLocator.ref,
    resolution_method: "git_rev_parse",
    repository_owner: parsedLocator.repository_owner,
    repository_name: parsedLocator.repository_name,
    repository_url: parsedLocator.repository_url
  };
}

function sortVerificationEntries(entries) {
  return [...entries].sort((a, b) => {
    const left = [
      a.anchor_type,
      a.anchor_network,
      a.anchor_label,
      a.anchor_locator,
      a.resolved_reference
    ].join("\u0000");

    const right = [
      b.anchor_type,
      b.anchor_network,
      b.anchor_label,
      b.anchor_locator,
      b.resolved_reference
    ].join("\u0000");

    return left.localeCompare(right);
  });
}

function buildVerificationEntry(externalAnchorEntry, trustChain) {
  const normalized = normalizeGitAnchorEntry(externalAnchorEntry);
  const resolvedCommitHash = resolveGitCommit(normalized.resolved_reference);

  assert(
    resolvedCommitHash === normalized.expected_anchor_identifier,
    `Resolved Git commit ${resolvedCommitHash} does not match expected anchor_identifier ${normalized.expected_anchor_identifier}`
  );

  const entryMaterial = {
    schema: "grant-audit-transparency-checkpoint-external-anchor-verification-entry-v1",
    entry_version: "1.0.0",
    anchor_type: normalized.anchor_type,
    anchor_network: normalized.anchor_network,
    anchor_label: normalized.anchor_label,
    anchor_locator: normalized.anchor_locator,
    expected_anchor_identifier: normalized.expected_anchor_identifier,
    resolved_reference: normalized.resolved_reference,
    resolution_method: normalized.resolution_method,
    resolved_commit_hash: resolvedCommitHash,
    repository_owner: normalized.repository_owner,
    repository_name: normalized.repository_name,
    repository_url: normalized.repository_url,
    expected_external_anchor_hash: trustChain.external_anchor_hash,
    expected_checkpoint_hash: trustChain.checkpoint_hash,
    expected_transparency_log_root: trustChain.transparency_log_root,
    expected_checkpoint_witnesses_hash: trustChain.checkpoint_witnesses_hash,
    expected_checkpoint_finalization_hash: trustChain.checkpoint_finalization_hash,
    expected_checkpoint_rebinding_hash: trustChain.checkpoint_rebinding_hash,
    verification_status: "verified"
  };

  return {
    ...entryMaterial,
    verification_material_hash: canonicalHash(entryMaterial)
  };
}

function main() {
  const args = parseArgs(process.argv);

  assert(fileExists(args.externalAnchorReceipt), `Missing receipt: ${args.externalAnchorReceipt}`);

  const receipt = readJson(args.externalAnchorReceipt);

  const trustChain = {
    checkpoint_hash: receipt.checkpoint_hash,
    transparency_log_root: receipt.transparency_log_root,
    checkpoint_witnesses_hash: receipt.checkpoint_witnesses_hash,
    checkpoint_finalization_hash: receipt.checkpoint_finalization_hash,
    checkpoint_rebinding_hash: receipt.checkpoint_rebinding_hash,
    anchor_set_hash: receipt.anchor_set_hash,
    external_anchor_hash: receipt.external_anchor_hash
  };

  for (const [key, value] of Object.entries(trustChain)) {
    assert(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), `Invalid trust-chain field: ${key}`);
  }

  const rawEntries = getExternalAnchorEntries(receipt);
  assert(rawEntries.length > 0, "No external anchor entries found in Phase 7.28 receipt");

  const entries = sortVerificationEntries(
    rawEntries.map((entry) => buildVerificationEntry(entry, trustChain))
  );

  const verificationSetHash = canonicalHash({
    entry_hashes: entries.map((entry) => entry.verification_material_hash)
  });

  const verificationMaterial = {
    schema: "grant-audit-transparency-checkpoint-external-anchor-verification-v1",
    verification_version: "1.0.0",
    phase: "7.29",
    external_anchor_receipt_path: args.externalAnchorReceipt,
    checkpoint_hash: trustChain.checkpoint_hash,
    transparency_log_root: trustChain.transparency_log_root,
    checkpoint_witnesses_hash: trustChain.checkpoint_witnesses_hash,
    checkpoint_finalization_hash: trustChain.checkpoint_finalization_hash,
    checkpoint_rebinding_hash: trustChain.checkpoint_rebinding_hash,
    anchor_set_hash: trustChain.anchor_set_hash,
    external_anchor_hash: trustChain.external_anchor_hash,
    entry_count: entries.length,
    entries,
    verification_set_hash: verificationSetHash
  };

  const artifact = {
    ...verificationMaterial,
    external_anchor_verification_hash: canonicalHash(verificationMaterial)
  };

  ensureDirForFile(args.out);
  fs.writeFileSync(args.out, `${JSON.stringify(sortKeysRecursively(artifact), null, 2)}\n`);

  process.stdout.write(`${JSON.stringify(sortKeysRecursively(artifact), null, 2)}\n`);
}

main();
