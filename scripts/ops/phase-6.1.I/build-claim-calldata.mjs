#!/usr/bin/env node
/**
 * Phase 6.1.I — Build deterministic claim calldata (ABI introspection)
 *
 * Direct RPC only (no hre). Reads artifact ABI, discovers claim-like function,
 * simulates candidates via eth_call, and emits deterministic Safe tx JSON.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createPublicClient, encodeFunctionData, http, isAddress } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

const VESTING = process.env.VESTING || "0xEf444C538769d7626511A4C538d03fFc7e53262B";
const SAFE = process.env.SAFE || "0x1eDc758579C66967C42066e8dDCB690a1651517e";
const BENEFICIARY =
  process.env.BENEFICIARY || "0xf7e66Def3745C6642E8bF24c88FEb0501d313F72";

const ARTIFACT =
  process.env.ARTIFACT ||
  "artifacts/contracts/VestingContract.sol/VestingContract.json";

const OUTDIR = "evidence/phase-6.1.I";
const OUT_ABI_EVIDENCE = path.join(OUTDIR, "abi-introspection.json");
const OUT_PICK_EVIDENCE = path.join(OUTDIR, "claim-function-picked.json");
const OUT_SAFE_TX = path.join(OUTDIR, "claim.safeTx.json");

function die(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function stableStringify(x) {
  const seen = new WeakSet();
  const norm = (v) => {
    if (typeof v === "bigint") return v.toString(10);
    if (v === null) return null;
    if (typeof v !== "object") return v;

    if (seen.has(v)) die("cycle in object to stringify");
    seen.add(v);

    if (Array.isArray(v)) return v.map(norm);

    const keys = Object.keys(v).sort();
    const out = {};
    for (const k of keys) out[k] = norm(v[k]);
    return out;
  };
  return JSON.stringify(norm(x), null, 2) + "\n";
}

function loadArtifactAbi(artifactPath) {
  if (!fs.existsSync(artifactPath)) die(`Artifact not found: ${artifactPath}`);
  const raw = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (!raw.abi || !Array.isArray(raw.abi)) die(`No abi[] in artifact: ${artifactPath}`);
  return raw.abi;
}

function fnKey(fn) {
  const inputs = (fn.inputs || []).map((i) => i.type).join(",");
  return `${fn.name}(${inputs})`;
}

function looksClaimLike(name) {
  return /(claim|release|withdraw|redeem|payout|distribute|vest|unlock)/i.test(name);
}

function argCompat(fn) {
  const ins = fn.inputs || [];
  if (ins.length === 0) return { ok: true, args: [] };
  if (ins.length === 1 && ins[0].type === "address") return { ok: true, args: [BENEFICIARY] };
  return { ok: false, reason: `unsupported inputs: ${ins.map((i) => i.type).join(",")}` };
}

async function main() {
  if (![VESTING, SAFE, BENEFICIARY].every(isAddress)) {
    die(`Bad address env. VESTING=${VESTING} SAFE=${SAFE} BENEFICIARY=${BENEFICIARY}`);
  }

  fs.mkdirSync(OUTDIR, { recursive: true });

  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

  const abi = loadArtifactAbi(ARTIFACT);
  const fns = abi.filter((x) => x && x.type === "function");

  const meta = fns.map((fn) => ({
    key: fnKey(fn),
    name: fn.name,
    stateMutability: fn.stateMutability,
    inputs: (fn.inputs || []).map((i) => ({ name: i.name, type: i.type })),
    claimLike: looksClaimLike(fn.name),
    argCompat: argCompat(fn),
  }));

  fs.writeFileSync(
    OUT_ABI_EVIDENCE,
    stableStringify({
      at: new Date().toISOString(),
      artifact: ARTIFACT,
      vesting: VESTING,
      safe: SAFE,
      beneficiary: BENEFICIARY,
      functionCount: fns.length,
      functions: meta,
    })
  );

  const candidates = meta
    .filter(
      (m) =>
        m.claimLike &&
        m.stateMutability !== "view" &&
        m.stateMutability !== "pure" &&
        m.argCompat.ok
    )
    .sort((a, b) => a.key.localeCompare(b.key));

  if (candidates.length === 0) {
    die(`No claim-like candidates. Inspect ${OUT_ABI_EVIDENCE}`);
  }

  const results = [];

  for (const c of candidates) {
    const fn = fns.find((x) => fnKey(x) === c.key);
    const args = c.argCompat.args;

    let data;
    try {
      data = encodeFunctionData({ abi, functionName: fn.name, args });
    } catch (e) {
      results.push({ key: c.key, ok: false, step: "encode", error: String(e) });
      continue;
    }

    try {
      await client.call({ to: VESTING, data, from: SAFE });
      results.push({ key: c.key, ok: true, step: "eth_call", data });
    } catch (e) {
      results.push({ key: c.key, ok: false, step: "eth_call", data, error: String(e) });
    }
  }

  const picked = results.find((r) => r.ok);

  fs.writeFileSync(
    OUT_PICK_EVIDENCE,
    stableStringify({
      at: new Date().toISOString(),
      rpc: RPC_URL,
      vesting: VESTING,
      safe: SAFE,
      beneficiary: BENEFICIARY,
      candidatesTried: candidates.map((c) => c.key),
      simulationResults: results,
      picked: picked ? { key: picked.key, data: picked.data } : null,
    })
  );

  if (!picked) {
    die(`All candidates reverted. Inspect ${OUT_PICK_EVIDENCE}`);
  }

  const safeTx = {
    version: "1.0",
    chainId: "84532",
    createdAt: new Date().toISOString(),
    meta: {
      name: "Phase 6.1.I — Vesting claim",
      description: "Deterministic calldata via ABI introspection + eth_call simulation",
    },
    safe: SAFE,
    to: VESTING,
    value: "0",
    data: picked.data,
    operation: 0,
  };

  fs.writeFileSync(OUT_SAFE_TX, stableStringify(safeTx));

  console.log("✅ Wrote ABI evidence:", OUT_ABI_EVIDENCE);
  console.log("✅ Wrote pick evidence:", OUT_PICK_EVIDENCE);
  console.log("✅ Wrote Safe tx JSON:", OUT_SAFE_TX);
  console.log("Picked:", picked.key);
  console.log("Calldata:", picked.data);
}

main().catch((e) => die(String(e)));
