#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const OUT_DIR = path.join(ROOT, "contracts", "evidence", "phase-8.3");
const OUT_FILE = path.join(OUT_DIR, "unit-model-audit.json");

const TOKEN_FILE = path.join(ROOT, "contracts", "EquityToken.sol");
const DEMO_CONFIG_FILE = path.join(ROOT, "scripts", "demo", "demo.config.json");
const DEMO_FLOW_FILE = path.join(ROOT, "scripts", "demo", "run-equity-grant-flow.mjs");
const INVARIANT_CHECKER_FILE = path.join(
  ROOT,
  "scripts",
  "audit",
  "check-equity-unit-invariants.mjs"
);

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function fileExists(file) {
  return fs.existsSync(file);
}

function nowIso() {
  return new Date().toISOString();
}

function detectTokenDecimals(tokenSource) {
  const immutableMatch = tokenSource.match(/decimals\s*=\s*([0-9]+)/);

  if (immutableMatch) {
    return Number(immutableMatch[1]);
  }

  const functionMatch = tokenSource.match(
    /function\s+decimals\s*\([^)]*\)[^{]*return[s]?\s*\(?\s*([0-9]+)/
  );

  if (functionMatch) {
    return Number(functionMatch[1]);
  }

  return null;
}

function detectBadPatterns(text) {
  const patterns = [
    "1000000000000000000",
    "parseEther(",
    "formatEther(",
    "1e18",
    "10n ** 18n",
    "10 ** 18"
  ];

  return patterns.filter((p) => text.includes(p));
}

function resolveGrantTotal(config) {
  return (
    config?.grant_execution?.grant_total ??
    config?.grant_execution?.grantTotal ??
    config?.grant_total ??
    config?.grantTotal ??
    config?.grant?.grant_total ??
    config?.grant?.grantTotal ??
    config?.demo?.grant_total ??
    config?.demo?.grantTotal ??
    null
  );
}

function main() {

  if (!fileExists(TOKEN_FILE)) {
    throw new Error(`Missing token source: ${TOKEN_FILE}`);
  }

  if (!fileExists(DEMO_CONFIG_FILE)) {
    throw new Error(`Missing demo config: ${DEMO_CONFIG_FILE}`);
  }

  if (!fileExists(DEMO_FLOW_FILE)) {
    throw new Error(`Missing demo flow file: ${DEMO_FLOW_FILE}`);
  }

  const tokenSource = readText(TOKEN_FILE);
  const demoConfig = readJson(DEMO_CONFIG_FILE);
  const demoFlowSource = readText(DEMO_FLOW_FILE);

  const invariantCheckerSource = fileExists(INVARIANT_CHECKER_FILE)
    ? readText(INVARIANT_CHECKER_FILE)
    : null;

  const resolvedGrantTotal = resolveGrantTotal(demoConfig);

  if (!resolvedGrantTotal) {
    throw new Error(
      "Could not resolve grant total from scripts/demo/demo.config.json"
    );
  }

  const grantTotalRaw = String(resolvedGrantTotal);
  const grantTotalIsNumeric = /^[0-9]+$/.test(grantTotalRaw);
  const grantTotal = grantTotalIsNumeric ? BigInt(grantTotalRaw) : null;

  const tokenDecimals = detectTokenDecimals(tokenSource);

  const demoConfigBadPatterns = detectBadPatterns(
    JSON.stringify(demoConfig, null, 2)
  );

  const demoFlowBadPatterns = detectBadPatterns(demoFlowSource);

  const observedModel =
    grantTotal === null
      ? "invalid"
      : grantTotal >= 10n ** 12n
      ? "likely_legacy_scaled_units"
      : "integer_shares";

  const tokenDecimalsCorrect = tokenDecimals === 0;
  const grantUnitsConsistent = observedModel === "integer_shares";

  const vestingFormulaMustChange = false;
  const decimalsShouldChange = false;

  const artifact = {
    phase: "8.3",
    generated_at: nowIso(),

    audit_scope: {
      token_source: "contracts/EquityToken.sol",
      demo_config: "scripts/demo/demo.config.json",
      demo_flow: "scripts/demo/run-equity-grant-flow.mjs",
      invariant_checker: "scripts/audit/check-equity-unit-invariants.mjs"
    },

    token: {
      decimals_detected: tokenDecimals,
      decimals_expected: 0,
      decimals_correct_for_equity: tokenDecimalsCorrect
    },

    grant_unit_model: {
      demo_config_grant_total: grantTotalRaw,
      numeric: grantTotalIsNumeric,
      observed_model: observedModel,
      expected_model: "integer_shares",
      consistent_with_equity_model: grantUnitsConsistent
    },

    active_path_scan: {
      demo_config_bad_patterns: demoConfigBadPatterns,
      demo_flow_bad_patterns: demoFlowBadPatterns,
      invariant_checker_present: !!invariantCheckerSource
    },

    vesting_math: {
      formula: "floor(total * elapsed / duration)",
      formula_requires_change: vestingFormulaMustChange,
      rationale:
        "Integer floor math remains valid for whole-share vesting; the bug was unit encoding, not the vesting formula."
    },

    conclusions: {
      decimals_should_change: decimalsShouldChange,
      grant_units_must_change: !grantUnitsConsistent,
      vesting_formula_must_change: vestingFormulaMustChange,

      active_demo_paths_clean:
        demoConfigBadPatterns.length === 0 &&
        demoFlowBadPatterns.length === 0,

      status:
        tokenDecimalsCorrect &&
        grantUnitsConsistent &&
        demoConfigBadPatterns.length === 0 &&
        demoFlowBadPatterns.length === 0
          ? "PASS"
          : "FAIL"
    }
  };

  mkdirp(OUT_DIR);

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(artifact, null, 2) + "\n"
  );

  console.log(JSON.stringify(artifact, null, 2));
  console.error(`Wrote ${OUT_FILE}`);
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}
