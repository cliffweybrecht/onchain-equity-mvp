#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const CONTRACTS_ROOT = path.join(ROOT, "contracts");
const PHASE = "8.1.B";
const PHASE_DIR = path.join(CONTRACTS_ROOT, "evidence", `phase-${PHASE}`);
const PRIOR_PHASE_61E_ADMIN_SURFACE = path.join(
  ROOT,
  "evidence",
  "phase-6.1.E",
  "admin-surface.json"
);

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function nowIso() {
  return new Date().toISOString();
}

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((x) => x.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function die(message) {
  throw new Error(message);
}

function parseIntegerShareCount(raw, fieldName) {
  if (raw === null || raw === undefined || raw === "") {
    die(`Missing required integer-share field: ${fieldName}`);
  }

  const value = String(raw);

  if (!/^[0-9]+$/.test(value)) {
    die(`${fieldName} must be a numeric string, got: ${value}`);
  }

  const n = BigInt(value);

  if (n <= 0n) {
    die(`${fieldName} must be a positive integer share count`);
  }

  if (n >= 10n ** 12n) {
    die(
      `${fieldName} is implausibly large for integer-share equity and may indicate deprecated 18-decimal scaling`
    );
  }

  return n.toString();
}

function runNodeScript(args, env = process.env, cwd = ROOT) {
  const result = spawnSync("node", args, {
    cwd,
    env,
    stdio: "pipe",
    encoding: "utf8",
  });

  return {
    command: "node",
    args,
    cwd,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function buildSummary({
  config,
  adminSurface,
  preflight,
  childProcess = null,
  stoppedBeforeCreateGrant,
}) {
  return {
    phase: PHASE,
    generated_at: nowIso(),
    stopped_before_create_grant: stoppedBeforeCreateGrant,
    config,
    admin_surface: adminSurface,
    preflight,
    child_process: childProcess,
  };
}

function buildBundle({
  configResolution,
  vestingAdminSurface,
  grantAdminPreflight,
  summary,
}) {
  return {
    phase: PHASE,
    built_at: nowIso(),
    files: {
      config_resolution: {
        path: `contracts/evidence/phase-${PHASE}/config-resolution.json`,
        contents: configResolution,
      },
      vesting_admin_surface: {
        path: `contracts/evidence/phase-${PHASE}/vesting-admin-surface.json`,
        contents: vestingAdminSurface,
      },
      grant_admin_preflight: {
        path: `contracts/evidence/phase-${PHASE}/grant-admin-preflight.json`,
        contents: grantAdminPreflight,
      },
      summary: {
        path: `contracts/evidence/phase-${PHASE}/grant-execution-summary.json`,
        contents: summary,
      },
    },
  };
}

async function main() {
  mkdirp(PHASE_DIR);

  if (!fileExists(CONTRACTS_ROOT)) {
    throw new Error(`Missing contracts directory: ${CONTRACTS_ROOT}`);
  }

  if (!fileExists(PRIOR_PHASE_61E_ADMIN_SURFACE)) {
    throw new Error(
      `Missing prior evidence file: ${PRIOR_PHASE_61E_ADMIN_SURFACE}`
    );
  }

  const priorAdminSurface = readJson(PRIOR_PHASE_61E_ADMIN_SURFACE);

  const sender =
    argValue("sender") ||
    process.env.DEMO_GRANT_SENDER ||
    process.env.GRANT_SIGNER ||
    process.env.SIGNER_ADDRESS ||
    "0x6C775411e11cAb752Af03C5BBb440618788E13Be";

  const beneficiary =
    argValue("beneficiary") ||
    process.env.DEMO_GRANT_BENEFICIARY ||
    "0xf7e66Def3745C6642E8bF24c88FEb0501d313F72";

  const total = parseIntegerShareCount(
    argValue("total") ||
      process.env.DEMO_GRANT_TOTAL ||
      "100",
    "total"
  );

  const start =
    argValue("start") ||
    process.env.DEMO_GRANT_START ||
    "1770000000";

  const cliff =
    argValue("cliff") ||
    process.env.DEMO_GRANT_CLIFF ||
    "1770000000";

  const duration =
    argValue("duration") ||
    process.env.DEMO_GRANT_DURATION ||
    "31536000";

  const vesting = priorAdminSurface.contracts.vesting;
  const identityRegistry = priorAdminSurface.reads.identityRegistry;
  const token = priorAdminSurface.reads.token;
  const expectedSafeAdmin = priorAdminSurface.contracts.expectedSafeAdmin;

  const configResolution = {
    phase: PHASE,
    resolved_at: nowIso(),
    repo_root: ROOT,
    contracts_root: CONTRACTS_ROOT,
    sender,
    beneficiary,
    total,
    start,
    cliff,
    duration,
    vesting,
    identityRegistry,
    token,
    expectedSafeAdmin,
    prior_evidence_source: "evidence/phase-6.1.E/admin-surface.json",
    canonical_rail: "contracts/scripts/ops/grants/create-grant.mjs",
    unit_model: "integer_shares",
    token_decimals_expected: 0,
  };

  writeJson(
    path.join(PHASE_DIR, "config-resolution.json"),
    configResolution
  );

  const adminSurfaceRun = runNodeScript(
    [
      "scripts/audit/inspect-vesting-admin-surface.mjs",
      `--signer=${sender}`,
    ],
    process.env,
    CONTRACTS_ROOT
  );

  if (adminSurfaceRun.status !== 0) {
    const failure = {
      phase: PHASE,
      step: "inspect-vesting-admin-surface",
      ok: false,
      generated_at: nowIso(),
      config: configResolution,
      child_process: adminSurfaceRun,
    };

    writeJson(path.join(PHASE_DIR, "grant-execution-summary.json"), failure);
    writeJson(path.join(PHASE_DIR, "phase-8.1.B-bundle.json"), {
      phase: PHASE,
      built_at: nowIso(),
      fatal: failure,
    });

    console.error(
      adminSurfaceRun.stderr ||
        adminSurfaceRun.stdout ||
        "admin surface inspection failed"
    );
    process.exit(adminSurfaceRun.status || 1);
  }

  const vestingAdminSurfacePath = path.join(
    PHASE_DIR,
    "vesting-admin-surface.json"
  );

  if (!fileExists(vestingAdminSurfacePath)) {
    throw new Error(
      `Expected admin surface artifact not found: ${vestingAdminSurfacePath}`
    );
  }

  const vestingAdminSurface = readJson(vestingAdminSurfacePath);

  const grantAdminPreflightRun = runNodeScript(
    [
      "scripts/audit/build-grant-admin-preflight.mjs",
      `--signer=${sender}`,
      `--vesting=${vesting}`,
      `--beneficiary=${beneficiary}`,
      `--expected-safe-admin=${expectedSafeAdmin}`,
    ],
    process.env,
    CONTRACTS_ROOT
  );

  if (grantAdminPreflightRun.status !== 0) {
    const failure = {
      phase: PHASE,
      step: "build-grant-admin-preflight",
      ok: false,
      generated_at: nowIso(),
      config: configResolution,
      admin_surface: vestingAdminSurface,
      child_process: grantAdminPreflightRun,
    };

    writeJson(path.join(PHASE_DIR, "grant-execution-summary.json"), failure);
    writeJson(path.join(PHASE_DIR, "phase-8.1.B-bundle.json"), {
      phase: PHASE,
      built_at: nowIso(),
      fatal: failure,
    });

    console.error(
      grantAdminPreflightRun.stderr ||
        grantAdminPreflightRun.stdout ||
        "grant admin preflight failed"
    );
    process.exit(grantAdminPreflightRun.status || 1);
  }

  const grantAdminPreflightPath = path.join(
    PHASE_DIR,
    "grant-admin-preflight.json"
  );

  if (!fileExists(grantAdminPreflightPath)) {
    throw new Error(
      `Expected preflight artifact not found: ${grantAdminPreflightPath}`
    );
  }

  const grantAdminPreflight = readJson(grantAdminPreflightPath);

  if (!grantAdminPreflight?.verdict?.overall?.ok) {
    const summary = buildSummary({
      config: configResolution,
      adminSurface: vestingAdminSurface,
      preflight: grantAdminPreflight,
      childProcess: null,
      stoppedBeforeCreateGrant: true,
    });

    writeJson(path.join(PHASE_DIR, "grant-execution-summary.json"), summary);

    const bundleRun = runNodeScript(
      ["scripts/ops/grants/build-phase-8.1.B-bundle.mjs"],
      process.env,
      CONTRACTS_ROOT
    );

    const bundlePath = path.join(PHASE_DIR, "phase-8.1.B-bundle.json");

    if (fileExists(bundlePath)) {
      const bundle = readJson(bundlePath);
      bundle.summary = summary;
      writeJson(bundlePath, bundle);
    } else {
      const fallbackBundle = buildBundle({
        configResolution,
        vestingAdminSurface,
        grantAdminPreflight,
        summary,
      });
      writeJson(bundlePath, fallbackBundle);
    }

    if (bundleRun.status !== 0) {
      console.error(bundleRun.stderr || bundleRun.stdout);
    }

    console.error(
      `Phase ${PHASE} preflight failed: ${
        Array.isArray(grantAdminPreflight?.verdict?.overall?.failure_reasons)
          ? grantAdminPreflight.verdict.overall.failure_reasons.join(", ")
          : "UNKNOWN_PREFLIGHT_FAILURE"
      }`
    );
    process.exit(1);
  }

  const child = runNodeScript(
    [
      "scripts/ops/grants/create-grant.mjs",
      `--employee=${beneficiary}`,
      `--total=${total}`,
      `--start=${start}`,
      `--cliff=${cliff}`,
      `--duration=${duration}`,
      `--vesting=${vesting}`,
      `--registry=${identityRegistry}`,
      `--token=${token}`,
    ],
    process.env,
    CONTRACTS_ROOT
  );

  const summary = buildSummary({
    config: configResolution,
    adminSurface: vestingAdminSurface,
    preflight: grantAdminPreflight,
    childProcess: child,
    stoppedBeforeCreateGrant: false,
  });

  writeJson(path.join(PHASE_DIR, "grant-execution-summary.json"), summary);

  const bundleRun = runNodeScript(
    ["scripts/ops/grants/build-phase-8.1.B-bundle.mjs"],
    process.env,
    CONTRACTS_ROOT
  );

  const bundlePath = path.join(PHASE_DIR, "phase-8.1.B-bundle.json");

  if (fileExists(bundlePath)) {
    const bundle = readJson(bundlePath);
    bundle.summary = summary;
    writeJson(bundlePath, bundle);
  } else {
    const fallbackBundle = buildBundle({
      configResolution,
      vestingAdminSurface,
      grantAdminPreflight,
      summary,
    });
    writeJson(bundlePath, fallbackBundle);
  }

  if (bundleRun.status !== 0) {
    console.error(bundleRun.stderr || bundleRun.stdout);
  }

  if (child.status !== 0) {
    console.error(child.stderr || child.stdout || "create-grant.mjs failed");
    process.exit(child.status || 1);
  }

  process.stdout.write(child.stdout);
}

main().catch((error) => {
  mkdirp(PHASE_DIR);

  const fatal = {
    phase: PHASE,
    failed_at: nowIso(),
    ok: false,
    error: {
      name: error?.name || "Error",
      message: error?.message || String(error),
      stack: error?.stack || null,
    },
  };

  try {
    writeJson(path.join(PHASE_DIR, "grant-execution-summary.json"), fatal);
    writeJson(path.join(PHASE_DIR, "phase-8.1.B-bundle.json"), {
      phase: PHASE,
      built_at: nowIso(),
      fatal,
    });
  } catch {
    // best effort only
  }

  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
