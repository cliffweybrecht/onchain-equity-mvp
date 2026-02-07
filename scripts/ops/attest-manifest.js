#!/usr/bin/env node
/**
 * Part 5.4.C — Attestation Creation Tool (attest-manifest.js)
 *
 * Deterministic, auditor-friendly attestation generator.
 *
 * Reads manifest JSON -> canonicalizes -> sha256 -> builds attestation -> signs -> writes JSON to disk.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { privateKeyToAccount } from "viem/accounts";

function die(msg, code = 1) {
  console.error(`[attest-manifest] ${msg}`);
  process.exit(code);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(`Failed to parse JSON: ${filePath}\n${e.message}`);
  }
}

// Deterministic canonical JSON (stable key order, no whitespace)
function canonicalize(value) {
  const t = typeof value;

  if (value === null) return "null";
  if (t === "string") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value)) die(`Non-finite number: ${value}`);
    return JSON.stringify(value);
  }
  if (t === "boolean") return value ? "true" : "false";

  if (t === "bigint" || t === "undefined" || t === "function" || t === "symbol") {
    die(`Invalid JSON type: ${t}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map(k => {
    const v = value[k];
    if (typeof v === "undefined") die(`Undefined value at key: ${k}`);
    return `${JSON.stringify(k)}:${canonicalize(v)}`;
  }).join(",")}}`;
}

function sha256Hex(utf8) {
  return crypto.createHash("sha256").update(Buffer.from(utf8, "utf8")).digest("hex");
}

function normalizePk(pk) {
  if (!pk) return null;
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

function parseArgs(argv) {
  const out = { manifest: null, out: null, issuedAt: null, id: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest" || a === "-m") out.manifest = argv[++i];
    else if (a === "--out" || a === "-o") out.out = argv[++i];
    else if (a === "--issued-at") out.issuedAt = argv[++i];
    else if (a === "--id") out.id = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else die(`Unknown arg: ${a}`);
  }
  return out;
}

function usage() {
  console.log(`
Usage:
  node scripts/ops/attest-manifest.js --manifest <manifest.json>
                                     [--out <attestation.json>]
                                     [--issued-at <ISO8601>]
                                     [--id <string>]

Env:
  PRIVATE_KEY (required)
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.manifest) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const manifestPath = path.resolve(process.cwd(), args.manifest);
  if (!fs.existsSync(manifestPath)) die(`Manifest not found: ${manifestPath}`);

  const pk = normalizePk(process.env.PRIVATE_KEY);
  if (!pk) die("Missing PRIVATE_KEY");

  const manifest = readJson(manifestPath);
  const canonicalManifest = canonicalize(manifest);
  const manifestHash = sha256Hex(canonicalManifest);

  const preimage = `onchain-equity.attestation.v1\nmanifest.sha256:${manifestHash}`;
  const preimageHash = sha256Hex(preimage);

  const account = privateKeyToAccount(pk);
  const signature = await account.signMessage({ message: preimage });

  const issuedAt = args.issuedAt
    ? new Date(args.issuedAt).toISOString()
    : new Date().toISOString();

  const attestation = {
    schema: "attestation-v1",
    type: "manifest-attestation",
    issuedAt,
    ...(args.id ? { id: args.id } : {}),
    subject: {
      type: "json-manifest",
      path: path.relative(process.cwd(), manifestPath),
      digest: { alg: "sha256", value: `0x${manifestHash}` }
    },
    signature: {
      type: "eip191",
      signer: account.address,
      preimage,
      preimageDigest: { alg: "sha256", value: `0x${preimageHash}` },
      value: signature
    }
  };

  const outPath =
    args.out ??
    path.join(path.dirname(manifestPath),
      `${path.basename(manifestPath, ".json")}.attestation.json`);

  fs.writeFileSync(outPath, JSON.stringify(attestation, null, 2) + "\n");

  console.log("== Attestation Created ==");
  console.log(`Manifest hash: 0x${manifestHash}`);
  console.log(`Signer:        ${account.address}`);
  console.log(`Output:        ${outPath}`);
}

main().catch(err => {
  console.error("[attest-manifest] Fatal error");
  console.error(err);
  process.exit(1);
});
