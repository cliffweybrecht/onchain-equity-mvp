#!/usr/bin/env node
import fs from "fs";
import crypto from "crypto";

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(1);
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest();
}

function hex(buf) {
  return "0x" + buf.toString("hex");
}

function fromHex(h) {
  if (typeof h !== "string" || !h.startsWith("0x")) die(`Invalid hex: ${h}`);
  return Buffer.from(h.slice(2), "hex");
}

function parseArg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

function verifyProof(leafHashBytes, proofArr) {
  let acc = Buffer.from(leafHashBytes);

  for (const step of proofArr) {
    if (!step || (step.position !== "left" && step.position !== "right")) {
      die(`Invalid proof step: ${JSON.stringify(step)}`);
    }
    const sibling = fromHex(step.hash);

    if (step.position === "left") {
      acc = sha256(Buffer.concat([sibling, acc]));
    } else {
      acc = sha256(Buffer.concat([acc, sibling]));
    }
  }

  return acc;
}

function run() {
  const proofPath = parseArg("--proof");
  const rootPath = parseArg("--root") || "manifests/grants/merkle-root.json";

  if (!proofPath) {
    die("Missing required --proof <path>");
  }

  if (!fs.existsSync(rootPath)) die(`Missing root manifest: ${rootPath}`);
  if (!fs.existsSync(proofPath)) die(`Missing proof file: ${proofPath}`);

  const rootManifest = JSON.parse(fs.readFileSync(rootPath, "utf8"));
  const proofObj = JSON.parse(fs.readFileSync(proofPath, "utf8"));

  const expectedRoot = rootManifest.merkleRoot;
  if (typeof expectedRoot !== "string" || expectedRoot.length !== 66) {
    die(`Invalid merkleRoot in manifest: ${expectedRoot}`);
  }

  if (typeof proofObj.merkleRoot !== "string") die("Proof missing merkleRoot");
  if (proofObj.merkleRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
    die(`Proof merkleRoot mismatch\nproof=${proofObj.merkleRoot}\nmanifest=${expectedRoot}`);
  }

  if (!Array.isArray(proofObj.proof)) die("Proof missing proof[] array");
  if (typeof proofObj.leafString !== "string" || proofObj.leafString.length === 0) {
    die("Proof missing leafString");
  }

  // leafHash = sha256(utf8(leafString))
  const recomputedLeafHash = hex(sha256(Buffer.from(proofObj.leafString, "utf8")));

  if (typeof proofObj.leafHash === "string") {
    if (proofObj.leafHash.toLowerCase() !== recomputedLeafHash.toLowerCase()) {
      die(`leafHash mismatch\nproof=${proofObj.leafHash}\nrecomputed=${recomputedLeafHash}`);
    }
  }

  const computedRoot = hex(verifyProof(fromHex(recomputedLeafHash), proofObj.proof));

  if (computedRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
    die(`INVALID PROOF\ncomputedRoot=${computedRoot}\nexpectedRoot=${expectedRoot}`);
  }

  console.log("OK: VALID PROOF");
  console.log("grantId:", proofObj.grantId);
  console.log("leafHash:", recomputedLeafHash);
  console.log("merkleRoot:", expectedRoot);
}

run();
