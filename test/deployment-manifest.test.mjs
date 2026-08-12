/**
 * Tests for scripts/lib/deployment-manifest.mjs.
 *
 * Uses Node.js built-in test runner (node:test) to match repository conventions.
 * Run via: npm run test:deployment-loader
 *
 * Positive tests invoke loadCanonicalDeployment() against the real manifest.
 * Negative tests invoke validateManifestData() with in-memory bad objects —
 * the canonical manifest is never mutated and no temp files are written.
 */

import assert   from "node:assert/strict";
import os       from "node:os";
import { test } from "node:test";

import {
  loadCanonicalDeployment,
  validateManifestData,
} from "../scripts/lib/deployment-manifest.mjs";

// ── Fixture helper ────────────────────────────────────────────────────────────

// Build a structurally valid manifest object for mutation in negative tests.
// Values are the canonical Phase 8.4.C addresses — this is intentional.
// Negative tests mutate a copy of this object; the real manifest is untouched.
function validFixture() {
  return {
    schemaVersion: 1,
    network: { name: "base-sepolia", chainId: 84532 },
    release: {
      phase: "8.4.C",
      referenceCommit: "5c2e293905748fdd325d4b860fddaaf99980200d",
    },
    contracts: {
      IdentityRegistry: { address: "0x9d6831cCB9D6f971Cb648B538448d175650cfEa4" },
      EquityToken:      { address: "0x73b8e67B2bCF9e482aF3b0dEC0548f0e84017c95" },
      VestingContract:  { address: "0x4739e9B845F4b4861236dfE0d8Da7AD985754f08" },
    },
    governance: { safe: "0x1eDc758579C66967C42066e8dDCB690a1651517e" },
  };
}

// ── Positive tests ────────────────────────────────────────────────────────────

test("canonical manifest loads successfully", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m, "should return a non-null manifest");
  assert.strictEqual(typeof m, "object");
});

test("schemaVersion is 1", () => {
  const m = loadCanonicalDeployment();
  assert.strictEqual(m.schemaVersion, 1);
});

test("Base Sepolia chain ID is 84532", () => {
  const m = loadCanonicalDeployment();
  assert.strictEqual(m.network.chainId, 84532);
});

test("network name is base-sepolia", () => {
  const m = loadCanonicalDeployment();
  assert.strictEqual(m.network.name, "base-sepolia");
});

test("IdentityRegistry address is a valid Ethereum address", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m.contracts.IdentityRegistry?.address, "IdentityRegistry.address should be present");
  assert.match(m.contracts.IdentityRegistry.address, /^0x[0-9a-fA-F]{40}$/);
});

test("EquityToken address is a valid Ethereum address", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m.contracts.EquityToken?.address, "EquityToken.address should be present");
  assert.match(m.contracts.EquityToken.address, /^0x[0-9a-fA-F]{40}$/);
});

test("VestingContract address is a valid Ethereum address", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m.contracts.VestingContract?.address, "VestingContract.address should be present");
  assert.match(m.contracts.VestingContract.address, /^0x[0-9a-fA-F]{40}$/);
});

test("governance Safe address is a valid Ethereum address", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m.governance?.safe, "governance.safe should be present");
  assert.match(m.governance.safe, /^0x[0-9a-fA-F]{40}$/);
});

test("canonical release referenceCommit matches Phase 8.4.C", () => {
  const m = loadCanonicalDeployment();
  // Pinning the commit ensures the manifest and documentation agree
  // on which chain state is canonical.
  assert.strictEqual(
    m.release.referenceCommit,
    "5c2e293905748fdd325d4b860fddaaf99980200d"
  );
  assert.match(m.release.referenceCommit, /^[0-9a-f]{40}$/);
});

// ── Path-independence test ────────────────────────────────────────────────────

test("loading is independent of process.cwd()", () => {
  const original = process.cwd();
  try {
    process.chdir(os.tmpdir());
    const m = loadCanonicalDeployment();
    assert.strictEqual(m.network.chainId, 84532);
  } finally {
    process.chdir(original);
  }
});

// ── Negative tests via validateManifestData ───────────────────────────────────
// All negative tests supply bad objects directly — no temp files, no path
// override on the canonical loader.

test("missing required contract (VestingContract) is rejected", () => {
  const bad = validFixture();
  delete bad.contracts.VestingContract;
  assert.throws(
    () => validateManifestData(bad),
    /schema validation|VestingContract/i
  );
});

test("malformed contract address is rejected", () => {
  const bad = validFixture();
  bad.contracts.EquityToken.address = "not-an-address";
  assert.throws(
    () => validateManifestData(bad),
    /schema validation|pattern|address/i
  );
});

test("wrong chainId is rejected", () => {
  const bad = validFixture();
  bad.network.chainId = 1; // Ethereum mainnet
  assert.throws(
    () => validateManifestData(bad),
    /chainId|84532/i
  );
});

test("unexpected top-level property is rejected", () => {
  const bad = validFixture();
  bad.undocumentedField = "drift";
  assert.throws(
    () => validateManifestData(bad),
    /schema validation|additional/i
  );
});

test("non-object input (null) is rejected", () => {
  // Covers the schema type: object requirement.
  // In the file-loading path this error surfaces as a JSON parse failure;
  // at the validation layer it surfaces as a type mismatch.
  assert.throws(
    () => validateManifestData(null),
    /schema validation/i
  );
});

test("unsupported schemaVersion is rejected", () => {
  // schemaVersion: 99 fails the schema const: 1 check.
  const bad = validFixture();
  bad.schemaVersion = 99;
  assert.throws(
    () => validateManifestData(bad),
    /schema validation|schemaVersion|unsupported/i
  );
});

test("missing governance.safe is rejected", () => {
  const bad = validFixture();
  delete bad.governance.safe;
  assert.throws(
    () => validateManifestData(bad),
    /schema validation|safe/i
  );
});

test("completely empty object is rejected", () => {
  assert.throws(
    () => validateManifestData({}),
    /schema validation/i
  );
});
