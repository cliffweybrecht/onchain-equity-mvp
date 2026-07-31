#!/usr/bin/env node
/**
 * Phase 8.4.C — Identity Registry prestate snapshot.
 * Captures the on-chain status of a target address before a Safe setStatus tx.
 * Outputs a deterministic JSON artifact for auditor comparison against poststate.
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
  },
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
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
const out = required("--out", arg("--out") || process.env.OUT_FILE);

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

const [block, rawStatus, verified, admin] = await Promise.all([
  client.getBlock({ blockTag: "latest" }),
  client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getStatus", args: [user] }),
  client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "isVerified", args: [user] }),
  client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "admin", args: [] })
]);

const STATUS_LABELS = { 0: "Unverified", 1: "Verified", 2: "Restricted" };

const payload = {
  phase: "8.4.C",
  snapshot_type: "identity_prestate",
  generated_at: new Date().toISOString(),
  chain_id: baseSepolia.id,
  block: {
    number: block.number.toString(),
    hash: block.hash,
    timestamp: block.timestamp.toString(),
    timestamp_iso: new Date(Number(block.timestamp) * 1000).toISOString()
  },
  registry,
  admin,
  user,
  status: {
    raw: Number(rawStatus),
    label: STATUS_LABELS[Number(rawStatus)] ?? "Unknown",
    isVerified: verified
  },
  expected_after_safe_tx: {
    raw: 1,
    label: "Verified",
    isVerified: true,
    safe_tx_function: "setStatus(address,uint8)",
    safe_tx_args: { user, newStatus: 1 }
  }
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify(payload, null, 2));
