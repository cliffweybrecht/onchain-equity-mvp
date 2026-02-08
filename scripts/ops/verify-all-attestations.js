#!/usr/bin/env node
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
  return sha256Hex(fs.readFileSync(filepath));
}

function runVerifier(verifierPath, args) {
  const r = spawnSync(process.execPath, [verifierPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function main() {
  const indexPath = process.argv[2] || "manifests/attestation-index.json";
  const verifierPath = "scripts/ops/verify-attestation.js";

  if (!fs.existsSync(verifierPath)) die("Missing verifier: " + verifierPath);
  if (!fs.existsSync(indexPath)) die("Missing index: " + indexPath);

  const indexRaw = await fsp.readFile(indexPath, "utf8");
  let index;
  try { index = JSON.parse(indexRaw); }
  catch (e) { die("Invalid JSON: " + (e?.message || e)); }

  if (index?.schema !== "attestation-index-v1") {
    die("Bad schema: " + String(index?.schema));
  }

  const atts = index.attestations;
  if (!Array.isArray(atts) || atts.length === 0) die("No attestations");

  const startedAt = isoNow();
  console.log("== Verify All Attestations ==");
  console.log("index: " + safeRel(indexPath));
  console.log("count: " + atts.length + "\n");

  const results = [];

  for (let i = 0; i < atts.length; i++) {
    const a = atts[i] || {};
    const id = a.id || "(missing id " + i + ")";
    const attestationPath = a.attestationPath;

    if (!attestationPath) die("Missing attestationPath for id=" + id);
    if (!fs.existsSync(attestationPath)) die("Not found: " + safeRel(attestationPath));

    const verifyArgs = Array.isArray(a.verifyArgs) && a.verifyArgs.length > 0
      ? a.verifyArgs
      : ["--attestation", attestationPath];

    process.stdout.write("• [" + (i + 1) + "/" + atts.length + "] " + id + " ... ");
    const run = runVerifier(verifierPath, verifyArgs);

    if (run.code !== 0) {
      console.log("FAIL");
      console.error(run.stdout.trim());
      console.error(run.stderr.trim());
      die("Failed at id=" + id, 2);
    }

    console.log("OK");
    results.push({
      id,
      type: a.type || "unknown",
      attestationPath: safeRel(attestationPath),
      sha256: sha256File(attestationPath),
      verifyArgs,
      exitCode: 0,
      ok: true
    });
  }

  const completedAt = isoNow();
  const summary = {
    ok: true,
    startedAt,
    completedAt,
    indexPath: safeRel(indexPath),
    indexSha256: sha256File(indexPath),
    totalAttestations: atts.length,
    verifiedCount: results.length,
    results
  };

  const outDir = "evidence/part-5.5";
  ensureDir(outDir);
  const outPath = outDir + "/verify-all-attestations.summary.json";
  await fsp.writeFile(outPath, JSON.stringify(summary, null, 2) + "\n");

  console.log("\n✅ PASS — verified " + results.length + "/" + atts.length + " attestations");
  console.log("Summary: " + safeRel(outPath));
}

main().catch((err) => {
  console.error("FATAL:", err?.stack || err?.message || String(err));
  process.exit(1);
});
