#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      fail(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (isPlainObject(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }

  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256Hex(filePath) {
  return sha256Hex(fs.readFileSync(filePath));
}

function ensureRegex(name, value, regex, helpText) {
  if (!regex.test(value)) {
    fail(`${name} is invalid: ${value}${helpText ? ` (${helpText})` : ""}`);
  }
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function getNested(obj, dottedPath) {
  const parts = dottedPath.split(".");
  let cursor = obj;

  for (const part of parts) {
    if (cursor === undefined || cursor === null || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }

  return cursor;
}

function pickField(obj, candidatePaths) {
  for (const candidate of candidatePaths) {
    const value = getNested(obj, candidate);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function buildAnchorEntryCore({ anchorType, anchorNetwork, anchorIdentifier, anchorLocator }) {
  const core = {
    schema: "grant-audit-transparency-checkpoint-external-anchor-entry-v1",
    entry_version: "1.0.0",
    anchor_type: anchorType,
    anchor_network: anchorNetwork,
    anchor_identifier: anchorIdentifier
  };

  if (anchorLocator) {
    core.anchor_locator = anchorLocator;
  }

  return core;
}

function withEntryHash(core) {
  const anchor_entry_hash = sha256Hex(canonicalStringify(core));
  return {
    ...core,
    anchor_entry_hash
  };
}

function buildGitAnchor(args) {
  if (!args["git-commit"]) {
    return null;
  }

  const commit = args["git-commit"];
  ensureRegex(
    "git commit",
    commit,
    /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/,
    "must be a full 40- or 64-character hash"
  );

  const repo = args["git-repository"];
  const locator = repo ? `git://${repo}#${commit}` : undefined;

  return withEntryHash(
    buildAnchorEntryCore({
      anchorType: "git_commit",
      anchorNetwork: "git",
      anchorIdentifier: commit,
      anchorLocator: locator
    })
  );
}

function buildIpfsAnchor(args) {
  if (!args["ipfs-cid"]) {
    return null;
  }

  const cid = args["ipfs-cid"];
  ensureRegex(
    "ipfs cid",
    cid,
    /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{10,})$/,
    "must look like a CIDv0 or CIDv1"
  );

  const locator = args["ipfs-uri"] || `ipfs://${cid}`;

  return withEntryHash(
    buildAnchorEntryCore({
      anchorType: "ipfs_cid",
      anchorNetwork: "ipfs",
      anchorIdentifier: cid,
      anchorLocator: locator
    })
  );
}

function buildBaseAnchor(args) {
  if (!args["base-tx"]) {
    return null;
  }

  const txHash = args["base-tx"];
  const network = args["base-network"] || "base-sepolia";

  ensureRegex(
    "base tx hash",
    txHash,
    /^0x[a-f0-9]{64}$/,
    "must be a 32-byte hex hash"
  );

  if (!["base-sepolia", "base-mainnet"].includes(network)) {
    fail(`base-network must be base-sepolia or base-mainnet, received: ${network}`);
  }

  const locator =
    args["base-tx-url"] ||
    `eip155:${network === "base-mainnet" ? "8453" : "84532"}:tx/${txHash}`;

  return withEntryHash(
    buildAnchorEntryCore({
      anchorType: "base_tx",
      anchorNetwork: network,
      anchorIdentifier: txHash,
      anchorLocator: locator
    })
  );
}

function buildEthereumL1Anchor(args) {
  if (!args["ethereum-l1-tx"]) {
    return null;
  }

  const txHash = args["ethereum-l1-tx"];
  const network = args["ethereum-l1-network"] || "ethereum-sepolia";

  ensureRegex(
    "ethereum l1 tx hash",
    txHash,
    /^0x[a-f0-9]{64}$/,
    "must be a 32-byte hex hash"
  );

  if (!["ethereum-sepolia", "ethereum-mainnet"].includes(network)) {
    fail(
      `ethereum-l1-network must be ethereum-sepolia or ethereum-mainnet, received: ${network}`
    );
  }

  const locator =
    args["ethereum-l1-tx-url"] ||
    `eip155:${network === "ethereum-mainnet" ? "1" : "11155111"}:tx/${txHash}`;

  return withEntryHash(
    buildAnchorEntryCore({
      anchorType: "ethereum_l1_tx",
      anchorNetwork: network,
      anchorIdentifier: txHash,
      anchorLocator: locator
    })
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const checkpointWitnessesPath = args["checkpoint-witnesses"];
  const checkpointFinalizationPath = args["checkpoint-finalization"];
  const checkpointRebindingPath = args["checkpoint-rebinding"];
  const outPath = args.out || "manifests/transparency/checkpoint-external-anchor.json";

  if (!checkpointWitnessesPath) {
    fail("--checkpoint-witnesses is required");
  }

  if (!checkpointFinalizationPath) {
    fail("--checkpoint-finalization is required");
  }

  if (!fs.existsSync(checkpointWitnessesPath)) {
    fail(`Checkpoint witnesses file not found: ${checkpointWitnessesPath}`);
  }

  if (!fs.existsSync(checkpointFinalizationPath)) {
    fail(`Checkpoint finalization file not found: ${checkpointFinalizationPath}`);
  }

  if (checkpointRebindingPath && !fs.existsSync(checkpointRebindingPath)) {
    fail(`Checkpoint rebinding file not found: ${checkpointRebindingPath}`);
  }

  const checkpointWitnesses = readJson(checkpointWitnessesPath);
  const checkpointFinalization = readJson(checkpointFinalizationPath);
  const checkpointRebinding = checkpointRebindingPath
    ? readJson(checkpointRebindingPath)
    : null;

  const checkpointHash = firstDefined(
    pickField(checkpointFinalization, [
      "checkpoint_hash",
      "finalized_checkpoint.checkpoint_hash",
      "checkpoint.checkpoint_hash",
      "checkpoint_commitment.checkpoint_hash",
      "finalization_payload.checkpoint_hash",
      "rebound_checkpoint.checkpoint_hash",
      "bound_checkpoint.checkpoint_hash"
    ]),
    pickField(checkpointWitnesses, [
      "checkpoint_hash",
      "checkpoint.checkpoint_hash",
      "checkpoint_commitment.checkpoint_hash",
      "signed_checkpoint.checkpoint_hash",
      "witnessed_checkpoint.checkpoint_hash"
    ]),
    checkpointRebinding
      ? pickField(checkpointRebinding, [
          "checkpoint_hash",
          "checkpoint.checkpoint_hash",
          "bound_checkpoint.checkpoint_hash",
          "rebound_checkpoint.checkpoint_hash"
        ])
      : undefined
  );

  const transparencyLogRoot = firstDefined(
    pickField(checkpointFinalization, [
      "transparency_log_root",
      "finalized_checkpoint.transparency_log_root",
      "checkpoint.transparency_log_root",
      "checkpoint_commitment.transparency_log_root",
      "finalization_payload.transparency_log_root",
      "rebound_checkpoint.transparency_log_root",
      "bound_checkpoint.transparency_log_root"
    ]),
    pickField(checkpointWitnesses, [
      "transparency_log_root",
      "checkpoint.transparency_log_root",
      "checkpoint_commitment.transparency_log_root",
      "signed_checkpoint.transparency_log_root",
      "witnessed_checkpoint.transparency_log_root"
    ]),
    checkpointRebinding
      ? pickField(checkpointRebinding, [
          "transparency_log_root",
          "checkpoint.transparency_log_root",
          "bound_checkpoint.transparency_log_root",
          "rebound_checkpoint.transparency_log_root"
        ])
      : undefined
  );

  if (!checkpointHash) {
    fail("Could not resolve checkpoint_hash from finalization/witnesses/rebinding manifests");
  }

  if (!transparencyLogRoot) {
    fail("Could not resolve transparency_log_root from finalization/witnesses/rebinding manifests");
  }

  ensureRegex("checkpoint_hash", checkpointHash, /^[a-f0-9]{64}$/);
  ensureRegex("transparency_log_root", transparencyLogRoot, /^[a-f0-9]{64}$/);

  const checkpointWitnessesHash = fileSha256Hex(checkpointWitnessesPath);
  const checkpointFinalizationHash = fileSha256Hex(checkpointFinalizationPath);
  const checkpointRebindingHash = checkpointRebindingPath
    ? fileSha256Hex(checkpointRebindingPath)
    : undefined;

  if (checkpointRebinding) {
    const rebindingCheckpointHash = pickField(checkpointRebinding, [
      "checkpoint_hash",
      "checkpoint.checkpoint_hash",
      "bound_checkpoint.checkpoint_hash"
    ]);

    const rebindingTransparencyLogRoot = pickField(checkpointRebinding, [
      "transparency_log_root",
      "checkpoint.transparency_log_root",
      "bound_checkpoint.transparency_log_root"
    ]);

    if (rebindingCheckpointHash && rebindingCheckpointHash !== checkpointHash) {
      fail(`Rebinding checkpoint_hash mismatch: ${rebindingCheckpointHash} !== ${checkpointHash}`);
    }

    if (
      rebindingTransparencyLogRoot &&
      rebindingTransparencyLogRoot !== transparencyLogRoot
    ) {
      fail(
        `Rebinding transparency_log_root mismatch: ${rebindingTransparencyLogRoot} !== ${transparencyLogRoot}`
      );
    }
  }

  const anchors = [
    buildGitAnchor(args),
    buildIpfsAnchor(args),
    buildBaseAnchor(args),
    buildEthereumL1Anchor(args)
  ].filter(Boolean);

  if (anchors.length === 0) {
    fail(
      "At least one external anchor must be supplied (--git-commit, --ipfs-cid, --base-tx, or --ethereum-l1-tx)"
    );
  }

  const anchorSetHash = sha256Hex(canonicalStringify(anchors));

  const coreManifest = {
    schema: "grant-audit-transparency-checkpoint-external-anchor-v1",
    manifest_version: "1.0.0",
    checkpoint_hash: checkpointHash,
    transparency_log_root: transparencyLogRoot,
    checkpoint_witnesses_hash: checkpointWitnessesHash,
    checkpoint_finalization_hash: checkpointFinalizationHash,
    ...(checkpointRebindingHash
      ? { checkpoint_rebinding_hash: checkpointRebindingHash }
      : {}),
    anchor_count: anchors.length,
    anchors,
    anchor_set_hash: anchorSetHash
  };

  const externalAnchorHash = sha256Hex(canonicalStringify(coreManifest));

  const finalManifest = {
    ...coreManifest,
    external_anchor_hash: externalAnchorHash
  };

  writeJson(outPath, finalManifest);

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: outPath,
        checkpoint_hash: checkpointHash,
        transparency_log_root: transparencyLogRoot,
        checkpoint_witnesses_hash: checkpointWitnessesHash,
        checkpoint_finalization_hash: checkpointFinalizationHash,
        ...(checkpointRebindingHash
          ? { checkpoint_rebinding_hash: checkpointRebindingHash }
          : {}),
        anchor_count: anchors.length,
        anchor_set_hash: anchorSetHash,
        external_anchor_hash: externalAnchorHash
      },
      null,
      2
    )
  );
}

main();
