#!/usr/bin/env node

/**
 * Phase 6.1.F — Token Pointer Decimal Integrity Check (LEGACY)
 *
 * -------------------------------------------------------------
 * IMPORTANT — PHASE 8.3 ARCHITECTURE CHANGE
 * -------------------------------------------------------------
 *
 * As of Phase 8.3 the equity unit model has been normalized:
 *
 *   EquityToken.decimals = 0
 *   1 token = 1 share
 *
 * Grant quantities are expressed in INTEGER SHARE UNITS ONLY.
 *
 * This legacy script previously assumed ERC20-style base units
 * (e.g. 10^18) and attempted to interpret grant quantities
 * under that model.
 *
 * That assumption is now INVALID for the architecture.
 *
 * Therefore this script is intentionally disabled so it cannot
 * accidentally be used in the active lifecycle flow.
 *
 * Historical evidence produced by this script remains valid for
 * documenting the Phase 6 decimal integrity investigation.
 *
 * -------------------------------------------------------------
 */

throw new Error(
  "Deprecated script: Phase 8.3 locked the equity unit model to integer shares with decimals = 0. This legacy script assumed 18-decimal base units and must not be executed."
);

/* ------------------------------------------------------------------
   Historical implementation preserved below for audit transparency
-------------------------------------------------------------------*/

import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function must(name) {
  const v = arg(name);
  if (!v) {
    console.error(`Missing required arg ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {

  const rpc = must("--rpc");
  const token = must("--token");

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpc)
  });

  const decimals = await client.readContract({
    address: token,
    abi: [
      {
        name: "decimals",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint8" }]
      }
    ],
    functionName: "decimals"
  });

  // LEGACY CHECK — historical ERC20-style assumption
  const LEGACY_18_DECIMAL_BASE_UNITS = 10n ** 18n;

  const interpretation =
    decimals === 18
      ? "OK: decimals=18 so 1e18 base units == 1.0 token"
      : "WARNING: decimals != 18; 1e18 base units != 1 token. Recalculate grantBaseUnits = tokens * 10^decimals";

  const artifact = {
    phase: "6.1.F",
    check: "token-pointer-decimals-direct",
    token,
    decimals,
    legacy_assumption_base_units: LEGACY_18_DECIMAL_BASE_UNITS.toString(),
    interpretation,
    note:
      "This artifact documents the historical decimal analysis that led to the Phase 8.3 unit-model normalization decision."
  };

  const outDir = "contracts/evidence/phase-6.1.F";

  fs.mkdirSync(outDir, { recursive: true });

  const file = path.join(outDir, "token-metadata-pinned.latest.json");

  fs.writeFileSync(file, JSON.stringify(artifact, null, 2));

  console.log(JSON.stringify(artifact, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
