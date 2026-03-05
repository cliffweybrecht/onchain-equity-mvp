#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { canonStringify, sha256Hex } from "../../lib/canon.mjs";

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function isAddress(x) {
  return typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);
}

function isHex32(x) {
  return typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
}

function isInt(n) {
  return Number.isInteger(n) && n >= 0;
}

function must(cond, msg) {
  if (!cond) die(msg);
}

function validate(manifest) {
  must(manifest && typeof manifest === "object", "manifest must be an object");
  must(manifest.schema === "grant-manifest-v1", `schema must be "grant-manifest-v1"`);
  must(isHex32(manifest.id), "id must be 0x + 64 hex chars");
  must(manifest.payload && typeof manifest.payload === "object", "payload must be an object");

  const p = manifest.payload;

  must(p.op === "create" || p.op === "revoke", "payload.op must be create|revoke");
  must(p.chainName === "baseSepolia", "payload.chainName must be baseSepolia");
  must(p.chainId === 84532, "payload.chainId must be 84532 (Base Sepolia)");
  must(typeof p.rpcHint === "string" && p.rpcHint.length > 0, "payload.rpcHint must be non-empty string");

  must(isAddress(p.vestingContract), "payload.vestingContract must be an address");
  must(isAddress(p.identityRegistry), "payload.identityRegistry must be an address");
  must(isAddress(p.issuer), "payload.issuer must be an address");
  must(isAddress(p.employee), "payload.employee must be an address");

  must(typeof p.createdAt === "string" && !Number.isNaN(Date.parse(p.createdAt)), "payload.createdAt must be ISO date-time");

  must(p.details && typeof p.details === "object", "payload.details must be an object");
  const d = p.details;

  must(typeof d.notes === "string", "details.notes must be a string");

  // create-specific fields
  if (p.op === "create") {
    must(typeof d.total === "string" && /^[0-9]+$/.test(d.total), "details.total must be a numeric string");
    must(isInt(d.start), "details.start must be int >= 0");
    must(isInt(d.cliff), "details.cliff must be int >= 0");
    must(isInt(d.duration) && d.duration >= 1, "details.duration must be int >= 1");
    must(d.cliff >= d.start, "details.cliff must be >= details.start");
  }

  // revoke-specific fields
  if (p.op === "revoke") {
    must(isHex32(p.grantId), "payload.grantId must be 0x + 64 hex chars (the create manifest id)");
    must(d.revocation && typeof d.revocation === "object", "details.revocation must exist for revoke op");
    must(d.revocation.status === 2, "details.revocation.status must be 2 (restricted)");
    must(typeof d.revocation.reason === "string" && d.revocation.reason.length > 0, "details.revocation.reason must be non-empty string");
  }

  // Deterministic ID check
  const computed = sha256Hex(canonStringify(p));
  must(computed.toLowerCase() === manifest.id.toLowerCase(), `id mismatch: computed ${computed} but got ${manifest.id}`);

  return { ok: true, computedId: computed };
}

// CLI
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.length === 0) {
  console.log(`Usage:
  node scripts/ops/grants/validate-grant-manifest.mjs --in <path/to/manifest.json>

Notes:
  - Deterministic id = sha256Hex(canonStringify(payload))
`);
  process.exit(0);
}

const inIdx = argv.indexOf("--in");
if (inIdx === -1) die("missing --in <file>");
const inFile = argv[inIdx + 1];
if (!inFile) die("missing value for --in");

const abs = path.resolve(inFile);
if (!fs.existsSync(abs)) die(`file not found: ${abs}`);

const j = JSON.parse(fs.readFileSync(abs, "utf8"));
const res = validate(j);
console.log(`✅ manifest valid`);
console.log(`id: ${j.id}`);
console.log(`computed: ${res.computedId}`);
