#!/usr/bin/env node
import fs from "fs";
import path from "path";
import process from "process";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "isVerified",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }]
  }
];

const VESTING_ABI = [
  {
    type: "function",
    name: "grants",
    stateMutability: "view",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [
      { name: "total", type: "uint256" },
      { name: "released", type: "uint256" },
      { name: "start", type: "uint64" },
      { name: "cliff", type: "uint64" },
      { name: "duration", type: "uint64" },
      { name: "exists", type: "bool" },
      { name: "revoked", type: "bool" },
      { name: "revokedAt", type: "uint64" }
    ]
  }
];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function required(name, value) {
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

const rpcUrl = required("--rpc", argValue("--rpc") || process.env.BASE_SEPOLIA_RPC_URL);
const registry = getAddress(required("--registry", argValue("--registry") || process.env.IDENTITY_REGISTRY));
const vesting = getAddress(required("--vesting", argValue("--vesting") || process.env.VESTING));
const candidatesFile = required("--candidates", argValue("--candidates"));
const out = required("--out", argValue("--out"));

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
});

const candidates = fs.readFileSync(candidatesFile, "utf8")
  .split(/\r?\n/)
  .map(x => x.trim())
  .filter(Boolean);

let selected = null;
const results = [];

for (const raw of candidates) {
  let addr;
  try {
    addr = getAddress(raw);
  } catch {
    results.push({
      address: raw,
      error: "invalid_address_format"
    });
    continue;
  }

  let isVerified = false;
  let exists = true;

  try {
    isVerified = await client.readContract({
      address: registry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "isVerified",
      args: [addr]
    });
  } catch (err) {
    results.push({
      address: addr,
      error: "identity_check_failed",
      message: err.message
    });
    continue;
  }

  try {
    const grant = await client.readContract({
      address: vesting,
      abi: VESTING_ABI,
      functionName: "grants",
      args: [addr]
    });

    exists = grant.exists ?? grant[5];
  } catch (err) {
    results.push({
      address: addr,
      error: "grant_read_failed",
      message: err.message
    });
    continue;
  }

  const verifiedFresh = isVerified === true && exists === false;

  if (verifiedFresh && !selected) {
    selected = addr;
  }

  results.push({
    address: addr,
    isVerified,
    exists,
    verifiedFresh
  });
}

const payload = {
  phase: "8.4.C",
  generated_at: new Date().toISOString(),
  selected_beneficiary: selected,
  candidate_count: candidates.length,
  results
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2));

console.log(JSON.stringify(payload, null, 2));
