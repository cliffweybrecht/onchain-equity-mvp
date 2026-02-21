#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

/**
 * Phase 6.1.I — Deterministic Pinned Snapshot
 *
 * Supports:
 *  - BLOCK or PINBLOCK env var (explicit block number)
 *  - Optional OUT override for output filename
 *  - Deterministic BigInt canonical JSON
 */

function canonicalize(value) {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    out[k] = canonicalize(value[k]);
  }
  return out;
}

function writeCanonical(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(canonicalize(obj), null, 2) + "\n"
  );
}

function loadAbiFor(nameCandidates) {
  const tries = [];

  for (const name of nameCandidates) {
    tries.push(`artifacts/contracts/${name}.sol/${name}.json`);
    tries.push(`artifacts/contracts/${name}.sol/${name}.dbg.json`);
  }

  tries.push("artifacts/contracts/VestingContract.sol/VestingContract.json");

  for (const p of tries) {
    if (fs.existsSync(p)) {
      const json = JSON.parse(fs.readFileSync(p, "utf8"));
      if (json.abi) return { abi: json.abi, artifactPath: p };
    }
  }

  throw new Error(
    "Could not find VestingContract ABI artifact. Expected artifacts/contracts/VestingContract.sol/VestingContract.json"
  );
}

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const vesting = process.env.VESTING;
  const beneficiary = process.env.BENEFICIARY;

  // Accept either BLOCK or PINBLOCK
  const blockStr = process.env.BLOCK || process.env.PINBLOCK;

  if (!rpcUrl) throw new Error("Set RPC_URL");
  if (!vesting) throw new Error("Set VESTING");
  if (!beneficiary) throw new Error("Set BENEFICIARY");
  if (!blockStr)
    throw new Error(
      "Set BLOCK (or PINBLOCK) — explicit block number for pinned read"
    );

  const BLOCK = BigInt(blockStr);
  const VESTING = getAddress(vesting);
  const BENEFICIARY = getAddress(beneficiary);

  const { abi, artifactPath } = loadAbiFor(["VestingContract"]);

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const contract = { address: VESTING, abi };

  async function tryRead(fn, args = []) {
    try {
      const val = await client.readContract({
        ...contract,
        functionName: fn,
        args,
        blockNumber: BLOCK,
      });
      return { ok: true, value: val };
    } catch (e) {
      return {
        ok: false,
        error: String(e?.shortMessage || e?.message || e),
      };
    }
  }

  const snapshot = {
    schema: "phase-6.1.I.pinned-snapshot.v1",
    network: { name: "baseSepolia", chainId: 84532 },
    rpc: rpcUrl,
    vestingContract: VESTING,
    beneficiary: BENEFICIARY,
    block: blockStr,
    abiArtifact: artifactPath,
    reads: {
      vestedAmount: await tryRead("vestedAmount", [BENEFICIARY]),
      claimed: await tryRead("claimed", [BENEFICIARY]),
      claimedAmount: await tryRead("claimedAmount", [BENEFICIARY]),
      claimableAmount: await tryRead("claimableAmount", [BENEFICIARY]),
      grants: await tryRead("grants", [BENEFICIARY]),
      released: await tryRead("released", [BENEFICIARY]),
      releasedAmount: await tryRead("releasedAmount", [BENEFICIARY]),
      totalVested: await tryRead("totalVested", [BENEFICIARY]),
    },
  };

  // Allow override of output path
  const out =
    process.env.OUT ||
    `evidence/phase-6.1.I/pinned-snapshot.block-${blockStr}.json`;

  writeCanonical(out, snapshot);
  console.log("✅ wrote", out);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
