#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Canonical index digest rule (v1):
 * - Parse manifests/attestation-index.json
 * - Compute sha256 over a canonical JSON string where:
 *   - schema is preserved
 *   - entries excludes all entries where type === "index-attestation"
 * - Canonical JSON formatting: JSON.stringify(obj, null, 2) + "\n"
 *
 * This avoids the self-referential "hash includes its own seal" infinite loop.
 */

function sha256Hex(buf) {
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}

function isoStampForFilename(d = new Date()) {
  // e.g. 2026-02-10T04-15-44.207Z  (safe in filenames)
  return d.toISOString().replaceAll(":", "-").replace(".000", "");
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

async function main() {
  const indexPath = "manifests/attestation-index.json";
  const outDir = "evidence/part-5.6";

  const indexRaw = await fs.readFile(indexPath, "utf8");
  const indexObj = JSON.parse(indexRaw);

  const canonicalObj = buildCanonicalIndexObject(indexObj);
  const canonicalStr = JSON.stringify(canonicalObj, null, 2) + "\n";
  const canonicalBytes = Buffer.from(canonicalStr, "utf8");
  const digest = sha256Hex(canonicalBytes);

  const issuedAt = new Date().toISOString();
  const stamp = isoStampForFilename(new Date());
  const outFile = path.join(outDir, `index-attestation-${stamp}.attestation.json`);

  const attestation = {
    schema: "attestation-v1",
    type: "index-attestation",
    issuedAt,
    id: `part-5.6-${stamp}`,
    subject: {
      type: "attestation-index",
      path: indexPath,
      canonical: {
        rule: "exclude-index-attestations",
        format: "json-pretty-2",
        newline: true
      },
      digest: {
        alg: "sha256",
        value: digest
      }
    }
  };

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(attestation, null, 2) + "\n", "utf8");

  console.log("== Index Attestation Created ==");
  console.log("index:", indexPath);
  console.log("canonical rule: exclude type=index-attestation");
  console.log("digest:", digest);
  console.log("attestation:", outFile);
}

main().catch((err) => {
  console.error("❌ attest-index failed:", err?.stack || err);
  process.exit(1);
});
