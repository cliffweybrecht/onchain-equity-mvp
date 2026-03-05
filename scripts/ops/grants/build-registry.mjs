#!/usr/bin/env node
/**
 * Phase 7.2 — Deterministic Grant Registry Snapshot
 *
 * Produces:
 *  - manifests/grants/registry.json (canonical, deterministic)
 *  - evidence/phase-7.2/grants-registry/<runId>/... (inputs + hashes + output)
 *
 * Determinism rules:
 *  - Registry object keys are recursively sorted (canonical JSON)
 *  - grants[] sorted by grantId lexicographically
 *  - manifestRefs sorted by path
 *  - sha256 computed over canonical JSON string (no whitespace)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function nowIsoZ() {
  // informational only, but fixed ISO format without milliseconds
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv) {
  const out = {
    ledgerPath: "manifests/grants/index.json",
    outPath: "manifests/grants/registry.json",
    manifestsDir: "manifests/grants",
    runId: null,
    network: "Base Sepolia",
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === "--ledger" && n) (out.ledgerPath = n, i++);
    else if (a === "--out" && n) (out.outPath = n, i++);
    else if (a === "--manifestsDir" && n) (out.manifestsDir = n, i++);
    else if (a === "--runId" && n) (out.runId = n, i++);
    else if (a === "--network" && n) (out.network = n, i++);
    else if (a === "--help") {
      console.log(`
Usage:
  node scripts/ops/grants/build-registry.mjs [--ledger <path>] [--out <path>]
                                            [--manifestsDir <dir>] [--runId <id>]
                                            [--network <name>]

Defaults:
  --ledger       manifests/grants/index.json
  --out          manifests/grants/registry.json
  --manifestsDir manifests/grants
  --network      Base Sepolia
`);
      process.exit(0);
    } else {
      die(`Unknown arg: ${a}`);
    }
  }

  if (!out.runId) {
    // Unique evidence folder name; does not affect determinism of registry output/hashes.
    const rnd = crypto.randomBytes(4).toString("hex");
    out.runId = `${Date.now()}-${rnd}`;
  }

  return out;
}

function readJson(p) {
  if (!fs.existsSync(p)) die(`Missing file: ${p}`);
  const raw = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(`Invalid JSON in ${p}: ${e.message}`);
  }
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * Recursively sort object keys to canonicalize JSON.
 * Arrays are preserved, but their elements are canonicalized.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;

  const keys = Object.keys(value).sort();
  const out = {};
  for (const k of keys) out[k] = canonicalize(value[k]);
  return out;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalPretty(value) {
  // pretty output but deterministic (because canonicalize sorts keys)
  return JSON.stringify(canonicalize(value), null, 2) + "\n";
}

function sha256HexFromString(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function sha256HexFromFile(p) {
  const raw = fs.readFileSync(p);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function guessLedgerEntries(ledgerJson) {
  // Support multiple shapes without breaking determinism
  if (Array.isArray(ledgerJson.entries)) return ledgerJson.entries;
  if (Array.isArray(ledgerJson.grants)) return ledgerJson.grants;
  if (Array.isArray(ledgerJson.items)) return ledgerJson.items;
  die("Ledger index missing array field: expected entries[] or grants[] or items[]");
}

function getField(obj, keys, fallback = undefined) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return fallback;
}

function normalizeStatus(s) {
  if (!s) return "unknown";
  const v = String(s).toLowerCase();
  if (v === "active") return "active";
  if (v === "revoked") return "revoked";
  return "unknown";
}

function ensureAddress(s, label) {
  if (typeof s !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(s)) {
    die(`Invalid ${label}: ${s ?? ""}`);
  }
  return s;
}

function ensureUintString(v, label) {
  // Accept numbers or numeric strings, output as string
  const s = typeof v === "number" ? String(v) : String(v ?? "");
  if (!/^[0-9]+$/.test(s)) die(`Invalid ${label} (expected uint string): ${v}`);
  return s;
}

function main() {
  const args = parseArgs(process.argv);

  const ledgerPath = args.ledgerPath;
  const outPath = args.outPath;
  const manifestsDir = args.manifestsDir;

  const ledgerJson = readJson(ledgerPath);

  // Ledger hash reference MUST be canonical-json-based for determinism.
  const ledgerCanonical = canonicalStringify(ledgerJson);
  const ledgerSha256 = sha256HexFromString(ledgerCanonical);

  const entries = guessLedgerEntries(ledgerJson);

  const rows = [];
  const missingManifests = [];

  for (const e of entries) {
    const grantId = String(getField(e, ["grantId", "id", "grant_id"], "")).trim();
    if (!grantId) die("Ledger entry missing grantId");

    // Manifest path could exist in ledger entry; otherwise we try a stable convention.
    const manifestPathRaw =
      getField(e, ["manifest", "manifestPath", "path"], null) ??
      path.join(manifestsDir, `${grantId}.json`);

    const manifestPath = String(manifestPathRaw);

    if (!fs.existsSync(manifestPath)) {
      missingManifests.push({ grantId, manifestPath });
      continue;
    }

    const manifestJson = readJson(manifestPath);

    // grant-manifest-v1 shape: fields live under payload + payload.details
    const payload = (manifestJson && manifestJson.payload) ? manifestJson.payload : {};
    const details = (payload && payload.details) ? payload.details : {};

    // beneficiary: prefer payload.employee, then fallbacks
    const beneficiary = ensureAddress(
      getField(
        payload,
        ["employee"],
        getField(
          manifestJson,
          ["beneficiary", "recipient", "grantee"],
          getField(e, ["beneficiary"], "")
        )
      ),
      `beneficiary for grantId=${grantId}`
    );

    // vesting contract: prefer payload.vestingContract
    const vestingContract = ensureAddress(
      getField(
        payload,
        ["vestingContract"],
        getField(
          manifestJson,
          ["vestingContract", "vesting", "vesting_address", "vestingContractAddress"],
          getField(e, ["vestingContract"], "")
        )
      ),
      `vestingContract for grantId=${grantId}`
    );

    // total amount: prefer payload.details.total
    const totalAmount = ensureUintString(
      getField(
        details,
        ["total"],
        getField(
          payload,
          ["totalAmount", "amount", "total"],
          getField(
            manifestJson,
            ["totalAmount", "amount", "total", "grantAmount"],
            getField(e, ["totalAmount", "amount"], null)
          )
        )
      ),
      `totalAmount for grantId=${grantId}`
    );

    // start/cliff/duration: prefer payload.details.*
    const start = ensureUintString(
      getField(
        details,
        ["start"],
        getField(
          payload,
          ["start", "startTime", "startTs"],
          getField(
            manifestJson,
            ["start", "startTime", "startTs"],
            getField(e, ["start"], null)
          )
        )
      ),
      `start for grantId=${grantId}`
    );

    const cliff = ensureUintString(
      getField(
        details,
        ["cliff"],
        getField(
          payload,
          ["cliff", "cliffTime", "cliffTs"],
          getField(
            manifestJson,
            ["cliff", "cliffTime", "cliffTs"],
            getField(e, ["cliff"], 0)
          )
        )
      ),
      `cliff for grantId=${grantId}`
    );

    const duration = ensureUintString(
      getField(
        details,
        ["duration"],
        getField(
          payload,
          ["duration", "durationSeconds", "durationSecs"],
          getField(
            manifestJson,
            ["duration", "durationSeconds", "durationSecs"],
            getField(e, ["duration"], null)
          )
        )
      ),
      `duration for grantId=${grantId}`
    );

    // status: prefer ledger, then manifest, else derive from payload.op
    const op = String(getField(payload, ["op"], "")).toLowerCase();
    const opDerivedStatus = op === "revoke" ? "revoked" : op === "create" ? "active" : null;

    const status = normalizeStatus(
      getField(e, ["status"], getField(manifestJson, ["status"], opDerivedStatus))
    );

    // Manifest reference hash: canonical JSON of the manifest (not raw file bytes)
    const manifestCanonical = canonicalStringify(manifestJson);
    const manifestSha = sha256HexFromString(manifestCanonical);

    const manifestRefs = [
      { path: manifestPath.replace(/\\/g, "/"), sha256: manifestSha },
    ].sort((a, b) => a.path.localeCompare(b.path));

    const row = {
      grantId,
      beneficiary,
      vestingContract,
      totalAmount,
      start,
      cliff,
      duration,
      status,
      manifestRefs,
      ledgerHashRef: {
        path: ledgerPath.replace(/\\/g, "/"),
        sha256: ledgerSha256,
      },
    };

    rows.push(row);
  }

  if (missingManifests.length > 0) {
    const sample = missingManifests
      .slice(0, 5)
      .map((x) => `${x.grantId} -> ${x.manifestPath}`)
      .join("\n  ");
    die(
      `Missing manifest files for ${missingManifests.length} ledger entries.\n` +
        `  ${sample}\n` +
        `Fix ledger manifest paths or create the expected files.`
    );
  }

  // Deterministic ordering: sort rows by grantId
  rows.sort((a, b) => a.grantId.localeCompare(b.grantId));

  const registry = {
    schema: "grant-registry-v1",
    version: 1,
    generatedAt: nowIsoZ(),
    network: args.network,
    ledgerRef: {
      path: ledgerPath.replace(/\\/g, "/"),
      sha256: ledgerSha256,
    },
    grants: rows,
  };

  // Write output registry.json (canonical pretty)
  mkdirp(path.dirname(outPath));
  fs.writeFileSync(outPath, canonicalPretty(registry), "utf8");

  // Evidence discipline
  const evDir = path.join("evidence", "phase-7.2", "grants-registry", args.runId);
  mkdirp(evDir);

  const hashes = {
    ledger: {
      path: ledgerPath.replace(/\\/g, "/"),
      sha256_canonical_json: ledgerSha256,
      sha256_file_bytes: sha256HexFromFile(ledgerPath),
    },
    registry: {
      path: outPath.replace(/\\/g, "/"),
      sha256_canonical_json: sha256HexFromString(canonicalStringify(registry)),
      sha256_file_bytes: sha256HexFromFile(outPath),
    },
  };

  const inputs = {
    ledgerPath: ledgerPath.replace(/\\/g, "/"),
    manifestsDir: manifestsDir.replace(/\\/g, "/"),
    outPath: outPath.replace(/\\/g, "/"),
    network: args.network,
  };

  const summary = {
    runId: args.runId,
    generatedAt: nowIsoZ(),
    network: args.network,
    grantsCount: rows.length,
    ledgerSha256Canonical: ledgerSha256,
    registrySha256Canonical: hashes.registry.sha256_canonical_json,
  };

  fs.writeFileSync(path.join(evDir, "inputs.json"), canonicalPretty(inputs), "utf8");
  fs.writeFileSync(path.join(evDir, "hashes.json"), canonicalPretty(hashes), "utf8");
  fs.writeFileSync(path.join(evDir, "registry.json"), canonicalPretty(registry), "utf8");
  fs.writeFileSync(path.join(evDir, "summary.json"), canonicalPretty(summary), "utf8");

  console.log(`OK: wrote ${outPath}`);
  console.log(`OK: evidence -> ${evDir}`);
  console.log(`Registry grants: ${rows.length}`);
  console.log(`Ledger canonical sha256:   ${ledgerSha256}`);
  console.log(`Registry canonical sha256: ${hashes.registry.sha256_canonical_json}`);
}

main();
