#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Part 5.6 verifier (canonical index digest, convergent)
 *
 * Canonical index digest rule (v1):
 * - Parse manifests/attestation-index.json
 * - Build canonical object:
 *     { schema: "attestation-index-v1", entries: entries excluding type==="index-attestation" }
 * - Canonical bytes = JSON.stringify(canonicalObj, null, 2) + "\n"
 * - sha256(canonical bytes) must match subject.digest.value of the canonical index-attestation
 *
 * Canonical index-attestation:
 * - The LAST entry in the index with type === "index-attestation"
 *
 * Also verifies every non-index attestation listed:
 * - sha256(bytes of att.subject.path) === att.subject.digest.value
 *
 * Writes summary to evidence/part-5.5/verify-all-attestations.summary.json
 */

function sha256Hex(buf) {
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

function buildCanonicalIndexObject(indexObj) {
  if (!indexObj || indexObj.schema !== "attestation-index-v1") {
    throw new Error(`attestation index schema mismatch: ${indexObj?.schema}`);
  }
  if (!Array.isArray(indexObj.entries)) {
    throw new Error("attestation index entries missing or not an array");
  }
  return {
    schema: indexObj.schema,
    entries: indexObj.entries.filter((e) => e && e.type !== "index-attestation")
  };
}

function canonicalIndexBytes(indexObj) {
  const canonicalObj = buildCanonicalIndexObject(indexObj);
  const s = JSON.stringify(canonicalObj, null, 2) + "\n";
  return Buffer.from(s, "utf8");
}

async function verifyIndexAttestationOrThrow(indexPath, indexObj) {
  const entries = indexObj.entries;

  const idxAtt = entries.filter((e) => e && e.type === "index-attestation" && typeof e.path === "string");
  if (idxAtt.length === 0) throw new Error("missing index-attestation entry in attestation index");

  const canonicalEntry = idxAtt[idxAtt.length - 1];
  const att = await readJson(canonicalEntry.path);

  if (att?.schema !== "attestation-v1") throw new Error(`index attestation schema mismatch: ${att?.schema}`);
  if (att?.type !== "index-attestation") throw new Error(`index attestation type mismatch: ${att?.type}`);

  if (att?.subject?.path !== indexPath) throw new Error(`index attestation subject.path mismatch: ${att?.subject?.path}`);
  if (att?.subject?.digest?.alg !== "sha256") throw new Error(`index attestation digest.alg mismatch: ${att?.subject?.digest?.alg}`);

  const rule = att?.subject?.canonical?.rule;
  const fmt = att?.subject?.canonical?.format;
  const newline = att?.subject?.canonical?.newline;

  if (rule !== "exclude-index-attestations") {
    throw new Error(`index attestation canonical.rule mismatch: ${rule}`);
  }
  if (fmt !== "json-pretty-2") {
    throw new Error(`index attestation canonical.format mismatch: ${fmt}`);
  }
  if (newline !== true) {
    throw new Error(`index attestation canonical.newline mismatch: ${newline}`);
  }

  const want = sha256Hex(canonicalIndexBytes(indexObj));
  const got = att?.subject?.digest?.value;

  if (got !== want) {
    throw new Error(`index digest mismatch (canonical): attestation=${got} computed=${want}`);
  }

  return { canonicalIndexAttestationPath: canonicalEntry.path, canonicalDigest: want };
}

async function verifySingleAttestation(entry) {
  const att = await readJson(entry.path);

  if (att?.schema !== "attestation-v1") throw new Error(`attestation schema mismatch (${entry.path})`);
  if (!att?.subject?.path) throw new Error(`attestation subject.path missing (${entry.path})`);
  if (att?.subject?.digest?.alg !== "sha256" || !att?.subject?.digest?.value) {
    throw new Error(`attestation digest invalid (${entry.path})`);
  }

  const targetBytes = await fs.readFile(att.subject.path);
  const actual = sha256Hex(targetBytes);

  if (actual !== att.subject.digest.value) {
    throw new Error(`digest mismatch for ${entry.path}: expected=${att.subject.digest.value} actual=${actual}`);
  }

  return { path: entry.path, subject: att.subject.path, digest: actual };
}

async function main() {
  const indexPath = "manifests/attestation-index.json";
  const indexObj = await readJson(indexPath);

  const summary = {
    schema: "verify-all-attestations-summary-v1",
    verifiedAt: new Date().toISOString(),
    index: indexPath,
    canonicalIndexAttestation: null,
    canonicalIndexDigest: null,
    attestations: []
  };

  const idx = await verifyIndexAttestationOrThrow(indexPath, indexObj);
  summary.canonicalIndexAttestation = idx.canonicalIndexAttestationPath;
  summary.canonicalIndexDigest = idx.canonicalDigest;

  console.log("✅ Index attestation verified (canonical rule):");
  console.log("   canonical:", idx.canonicalIndexAttestationPath);
  console.log("   digest   :", idx.canonicalDigest);

  for (const entry of indexObj.entries) {
    if (entry.type === "index-attestation") continue;
    const res = await verifySingleAttestation(entry);
    summary.attestations.push(res);
    console.log("✔ verified:", entry.path);
  }

  const outDir = "evidence/part-5.5";
  await fs.mkdir(outDir, { recursive: true });

  const outFile = path.join(outDir, "verify-all-attestations.summary.json");
  await fs.writeFile(outFile, JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log("\n📄 Summary written to:", outFile);
}

main().catch((err) => {
  console.error("\n❌ verification failed:");
  console.error(err.stack || err);
  process.exit(1);
});
