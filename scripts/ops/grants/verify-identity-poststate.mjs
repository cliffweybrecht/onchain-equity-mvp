#!/usr/bin/env node
/**
 * Phase 8.4.C — Identity Registry poststate verification.
 * Run after the Safe setStatus tx confirms. Reads on-chain status and asserts
 * it matches the expected value. Compares against the prestate artifact.
 * Exits non-zero if the expected status is not observed on-chain.
 */
import fs from "fs";
import path from "path";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "getStatus",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint8" }]
  },
  {
    type: "function",
    name: "isVerified",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }]
  }
];

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function required(name, val) {
  if (!val) { console.error(`Missing required: ${name}`); process.exit(1); }
  return val;
}

const rpcUrl = arg("--rpc") || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const registry = getAddress(required("--registry", arg("--registry") || process.env.IDENTITY_REGISTRY));
const user = getAddress(required("--user", arg("--user") || process.env.TARGET_ADDRESS));
const expectedStatus = Number(arg("--expected-status") ?? "1");
const prestatePath = arg("--prestate");
const out = required("--out", arg("--out") || process.env.OUT_FILE);

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

const [block, rawStatus, verified] = await Promise.all([
  client.getBlock({ blockTag: "latest" }),
  client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getStatus", args: [user] }),
  client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "isVerified", args: [user] })
]);

const STATUS_LABELS = { 0: "Unverified", 1: "Verified", 2: "Restricted" };
const observedStatus = Number(rawStatus);
const statusMatch = observedStatus === expectedStatus;

let prestate = null;
if (prestatePath && fs.existsSync(prestatePath)) {
  prestate = JSON.parse(fs.readFileSync(prestatePath, "utf8"));
}

const payload = {
  phase: "8.4.C",
  snapshot_type: "identity_poststate",
  generated_at: new Date().toISOString(),
  chain_id: baseSepolia.id,
  block: {
    number: block.number.toString(),
    hash: block.hash,
    timestamp: block.timestamp.toString(),
    timestamp_iso: new Date(Number(block.timestamp) * 1000).toISOString()
  },
  registry,
  user,
  expected: {
    raw: expectedStatus,
    label: STATUS_LABELS[expectedStatus] ?? "Unknown"
  },
  observed: {
    raw: observedStatus,
    label: STATUS_LABELS[observedStatus] ?? "Unknown",
    isVerified: verified
  },
  prestate_raw: prestate?.status?.raw ?? null,
  delta: observedStatus - (prestate?.status?.raw ?? 0),
  ok: statusMatch,
  verdict: statusMatch ? "POSTSTATE_VERIFIED" : "POSTSTATE_MISMATCH"
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify(payload, null, 2));

if (!statusMatch) {
  console.error(`FAIL: expected status ${expectedStatus}, observed ${observedStatus}`);
  process.exit(1);
}
