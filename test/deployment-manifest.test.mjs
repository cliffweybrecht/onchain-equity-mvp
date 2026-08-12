/**
 * Tests for scripts/lib/deployment-manifest.mjs.
 *
 * Uses Node.js built-in test runner (node:test) to match repository conventions.
 * Run via: npm run test:deployment-loader
 *
 * Negative tests use temporary fixture files written to os.tmpdir().
 * The real canonical manifest is never mutated.
 */

import assert      from "node:assert/strict";
import fs          from "node:fs";
import os          from "node:os";
import path        from "node:path";
import { test }    from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadCanonicalDeployment,
  DEFAULT_MANIFEST_PATH,
  SUPPORTED_SCHEMA_VERSION,
  EXPECTED_CHAIN_ID,
  EXPECTED_NETWORK_NAME,
} from "../scripts/lib/deployment-manifest.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Load the real canonical manifest once for reference.
const REAL = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, "utf8"));

// Write a temporary fixture manifest and return its path.
function writeTempManifest(obj) {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), "rail-manifest-test-"));
  const file = path.join(dir, "test-manifest.json");
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return file;
}

// Build a minimal valid manifest for mutation testing.
function validFixture(overrides = {}) {
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    network: { name: EXPECTED_NETWORK_NAME, chainId: EXPECTED_CHAIN_ID },
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
    ...overrides,
  };
}

// ── Positive tests ────────────────────────────────────────────────────────────

test("canonical manifest loads successfully", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m, "should return a non-null manifest");
});

test("schemaVersion is exposed and matches supported version", () => {
  const m = loadCanonicalDeployment();
  assert.strictEqual(m.schemaVersion, SUPPORTED_SCHEMA_VERSION);
});

test("Base Sepolia chain ID is exposed correctly", () => {
  const m = loadCanonicalDeployment();
  assert.strictEqual(m.network.chainId, EXPECTED_CHAIN_ID);
});

test("network name is exposed correctly", () => {
  const m = loadCanonicalDeployment();
  assert.strictEqual(m.network.name, EXPECTED_NETWORK_NAME);
});

test("IdentityRegistry address is returned from manifest", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m.contracts.IdentityRegistry?.address, "IdentityRegistry.address should be present");
  assert.match(m.contracts.IdentityRegistry.address, /^0x[0-9a-fA-F]{40}$/);
});

test("EquityToken address is returned from manifest", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m.contracts.EquityToken?.address, "EquityToken.address should be present");
  assert.match(m.contracts.EquityToken.address, /^0x[0-9a-fA-F]{40}$/);
});

test("VestingContract address is returned from manifest", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m.contracts.VestingContract?.address, "VestingContract.address should be present");
  assert.match(m.contracts.VestingContract.address, /^0x[0-9a-fA-F]{40}$/);
});

test("governance Safe address is returned from manifest", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m.governance?.safe, "governance.safe should be present");
  assert.match(m.governance.safe, /^0x[0-9a-fA-F]{40}$/);
});

test("release phase and referenceCommit are present", () => {
  const m = loadCanonicalDeployment();
  assert.ok(m.release?.phase, "release.phase should be present");
  assert.ok(m.release?.referenceCommit, "release.referenceCommit should be present");
  assert.match(m.release.referenceCommit, /^[0-9a-f]{40}$/);
});

// ── Path-independence test ────────────────────────────────────────────────────

test("loading is independent of process.cwd()", () => {
  const original = process.cwd();
  try {
    // Change to a completely unrelated directory.
    process.chdir(os.tmpdir());
    const m = loadCanonicalDeployment();
    assert.strictEqual(m.network.chainId, EXPECTED_CHAIN_ID);
  } finally {
    process.chdir(original);
  }
});

// ── Negative tests using temp fixtures ────────────────────────────────────────

test("missing required contract (VestingContract) is rejected", () => {
  const fixture = validFixture();
  delete fixture.contracts.VestingContract;
  const p = writeTempManifest(fixture);
  assert.throws(
    () => loadCanonicalDeployment({ manifestPath: p }),
    /schema validation|VestingContract/i
  );
});

test("malformed contract address is rejected", () => {
  const fixture = validFixture();
  fixture.contracts.EquityToken.address = "not-an-address";
  const p = writeTempManifest(fixture);
  assert.throws(
    () => loadCanonicalDeployment({ manifestPath: p }),
    /schema validation|pattern|address/i
  );
});

test("wrong chainId is rejected", () => {
  const fixture = validFixture();
  fixture.network.chainId = 1; // Ethereum mainnet
  const p = writeTempManifest(fixture);
  assert.throws(
    () => loadCanonicalDeployment({ manifestPath: p }),
    /chainId|84532/i
  );
});

test("unexpected top-level property is rejected", () => {
  const fixture = validFixture();
  fixture.undocumentedField = "drift";
  const p = writeTempManifest(fixture);
  assert.throws(
    () => loadCanonicalDeployment({ manifestPath: p }),
    /schema validation|additional/i
  );
});

test("malformed JSON is rejected", () => {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), "rail-manifest-test-"));
  const file = path.join(dir, "bad.json");
  fs.writeFileSync(file, "{ this is not json }");
  assert.throws(
    () => loadCanonicalDeployment({ manifestPath: file }),
    /not valid JSON/i
  );
});

test("missing manifest file is rejected", () => {
  assert.throws(
    () => loadCanonicalDeployment({ manifestPath: "/nonexistent/path/manifest.json" }),
    /Cannot read deployment manifest/i
  );
});

test("unsupported schemaVersion is rejected", () => {
  // schemaVersion: 99 fails the schema const check (const: 1),
  // which surfaces as a schema validation error.
  const fixture = validFixture();
  fixture.schemaVersion = 99;
  const p = writeTempManifest(fixture);
  assert.throws(
    () => loadCanonicalDeployment({ manifestPath: p }),
    /schema validation|schemaVersion|unsupported/i
  );
});

test("missing governance.safe is rejected", () => {
  const fixture = validFixture();
  delete fixture.governance.safe;
  const p = writeTempManifest(fixture);
  assert.throws(
    () => loadCanonicalDeployment({ manifestPath: p }),
    /schema validation|safe/i
  );
});
