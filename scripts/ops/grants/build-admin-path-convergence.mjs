#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

const rpcUrl = arg("--rpc") || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const registry = getAddress(arg("--registry") || process.env.IDENTITY_REGISTRY_ADDRESS || "");
const vesting = getAddress(arg("--vesting") || process.env.VESTING_ADDRESS || "");
const sender = getAddress(arg("--sender") || process.env.CONFIGURED_SENDER || "");
const out = path.resolve(
  arg("--out") || "contracts/evidence/phase-8.1.C/admin-path-convergence.json"
);

if (!registry) die("Missing registry");
if (!vesting) die("Missing vesting");
if (!sender) die("Missing sender");

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
});

const abi = [
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }]
  }
];

const registryAdmin = getAddress(
  await client.readContract({ address: registry, abi, functionName: "admin", args: [] })
);

const vestingAdmin = getAddress(
  await client.readContract({ address: vesting, abi, functionName: "admin", args: [] })
);

const sameAdmin = registryAdmin === vestingAdmin;
const senderMatches = sender === registryAdmin && sender === vestingAdmin;

const result = {
  phase: "8.1.C",
  generated_at: new Date().toISOString(),
  configured_sender: sender,
  registry: {
    address: registry,
    admin: registryAdmin
  },
  vesting: {
    address: vesting,
    admin: vestingAdmin
  },
  convergence: {
    same_admin_for_registry_and_vesting: sameAdmin,
    converged_admin: sameAdmin ? registryAdmin : null,
    configured_sender_matches_converged_admin: senderMatches
  },
  verdict:
    sameAdmin && !senderMatches
      ? "SAFE_ADMIN_CONVERGENCE_CONFIRMED"
      : sameAdmin && senderMatches
        ? "DIRECT_ADMIN_ALIGNMENT_CONFIRMED"
        : "ADMIN_PATHS_DIVERGE"
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
