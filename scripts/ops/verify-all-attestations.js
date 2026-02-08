#!/usr/bin/env node
/**
 * Part 5.5 — verify-all-attestations
 *
 * Reads manifests/attestation-index.json and runs scripts/ops/verify-attestation.js
 * for each entry (fail-fast). Emits:
 *  - human-readable console output
 *  - machine-readable summary JSON in evidence/part-5.5/
 *
 * No Solidity changes. Append-only workflows.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function isoNow() {
  return new Date().toISOString();
}

function safeRel(p) {
  return String(p).replaceAll("\\", "/");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sha256Hex(buf) {
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filepath) {
  const buf = fs.readFileSync(filepath);
  return sha256Hex(buf);
}

function runVerifier(verifierPath, args) {
  const r = spawnSync(process.execPath, [verifierPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function parseCli(argv) {
  const indexPath = argv[2] || "manifests/attestation-index.json";
  return { indexPath };
}

async function main() {
  const { indexPath } = parseCli(process.argv);
  const verifierPath = "scripts/ops/verify-attestation.js";

  if (!fs.existsSync(verifierPath)) die(`❌ Missing verifier: ${verifierPath}`);
  if (!fs.existsSync(indexPath)) die(`❌ Missing index: ${indexPath}`);

  const indexRaw = await fsp.readFile(indexPath, "utf8");
  let index;
  try { index = JSON.parse(indexRaw); }
  catch (e) { die(`❌ Invalid JSON in ${indexPath}: ${e?.message || e}`); }

  if (index?.schema !== "attestation-index-v1") {
    die(`❌ Unsupported index schema: ${String(index?.schema)}`);
  }

  const atts = index.attestations;
  if (!Array.isArray(atts) || atts.length === 0) die(`❌ Index contains no attestations`);

  const startedAt = isoNow();
  console.log("== Verify All Attestations ==");
  console.log(`index: ${safeRel(indexPath)}`);
  console.log(`count: ${atts.length}`);
  console.log("");

  const results = [];

  for (let i = 0; i < atts.length; i++) {
    const a = atts[i] || {};
    const id = a.id || `(missing id ${i})`;
    const type = a.type || "(unknown)";
    const attestationPath = a.attestationPath;

    if (!attestationPath || typeof attestationPath !== "string") {
      die(`❌ Missing attestationPath for id=${id}`);
    }
    if (!fs.existsSync(attestationPath)) {
      die(`❌ Attestation file not found for id=${id}: ${safeRel(attestationPath)}`);
    }

    const verifyArgs =
      Array.isArray(a.verifyArgs) && a.verifyArgs.length > 0
        ? a.verifyArgs
        : ["--attestation", attestationPath];

    process.stdout.write(`• [${i + 1}/${atts.length}] ${id} (${type}) ... `);
    const run = runVerifier(verifierPath, verifyArgs);

    if (run.code !== 0) {
      console.log("FAIL");
      console.error(`--- verifier stdout (id=${id}) ---\n${run.stdout.trim()}\n`);
      console.error(`--- verifier stderr (id=${id}) ---\n${run.stderr.trim()}\n`);
      die(`❌ Batch verification failed (fail-fast) at id=${id}`, 2);
    }

    console.log("OK");

    results.push({
      id,
      type,
      attestationPath: safeRel(attestationPath),
      sha256: sha256File(attestationPath),
      verifyArgs,
      exitCode: run.code,
    });
  }

  const finishedAt = isoNow();
  const evidenceDir = "evidence/part-5.5";
  ensureDir(evidenceDir);

  const summary = {
    schema: "attestation-batch-verify-summary-v1",
    index: {
      path: safeRel(indexPath),
      sha256: sha256Hex(Buffer.from(indexRaw, "utf8")),
      count: atts.length,
    },
    verifier: { path: safeRel(verifierPath) },
    startedAt,
    finishedAt,
    status: "PASS",
    results,
  };

  const stamp = finishedAt.replaceAll(":", "-");
  const outPath = `${evidenceDir}/attestation-verify-all-${stamp}.json`;
  await fsp.writeFile(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log("");
  console.log(`✅ PASS — verified ${atts.length}/${atts.length} attestations`);
  console.log(`summary: ${safeRel(outPath)}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
