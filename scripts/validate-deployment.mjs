#!/usr/bin/env node
/**
 * CLI validator for deployments/base-sepolia.json.
 *
 * Thin wrapper around scripts/lib/deployment-manifest.mjs.
 * All validation logic lives in the shared loader; this script adds
 * human-readable reporting and a non-zero exit code on failure.
 *
 * Exits 0 on success. Exits non-zero on any validation failure.
 *
 * Usage:
 *   node scripts/validate-deployment.mjs
 *   npm run validate:deployment
 */

import { loadCanonicalDeployment } from "./lib/deployment-manifest.mjs";

let manifest;
try {
  manifest = loadCanonicalDeployment();
} catch (err) {
  console.error("FAIL:", err.message);
  process.exit(1);
}

console.log("PASS: deployment manifest valid");
console.log(`  schemaVersion:    ${manifest.schemaVersion}`);
console.log(`  network:          ${manifest.network.name} (chainId ${manifest.network.chainId})`);
console.log(`  phase:            ${manifest.release.phase}`);
console.log(`  referenceCommit:  ${manifest.release.referenceCommit}`);
console.log(`  IdentityRegistry: ${manifest.contracts.IdentityRegistry.address}`);
console.log(`  EquityToken:      ${manifest.contracts.EquityToken.address}`);
console.log(`  VestingContract:  ${manifest.contracts.VestingContract.address}`);
console.log(`  governance.safe:  ${manifest.governance.safe}`);
