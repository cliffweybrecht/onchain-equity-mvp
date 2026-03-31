#!/usr/bin/env node
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const config = JSON.parse(
  readFileSync(path.join(repoRoot, "manifests/migration/stack-config.json"), "utf8")
);

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
if (!rpcUrl) throw new Error("BASE_SEPOLIA_RPC_URL is not set");

const beneficiary = process.env.BENEFICIARY;
if (!beneficiary) throw new Error("BENEFICIARY is not set");

const vestingAddr = getAddress(config.new_stack.vesting);
const beneficiaryAddr = getAddress(beneficiary);

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl),
});

const GRANTS_ABI = [
  {
    name: "grants",
    type: "function",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "total", type: "uint256" },
      { name: "released", type: "uint256" },
      { name: "start", type: "uint64" },
      { name: "cliff", type: "uint64" },
      { name: "duration", type: "uint64" },
      { name: "exists", type: "bool" },
      { name: "revoked", type: "bool" },
      { name: "revokedAt", type: "uint64" },
    ],
    stateMutability: "view",
  },
];

const g = await client.readContract({
  address: vestingAddr,
  abi: GRANTS_ABI,
  functionName: "grants",
  args: [beneficiaryAddr],
});

const [
  total,
  released,
  start,
  cliff,
  duration,
  exists,
  revoked,
  revokedAt,
] = g;

const artifact = {
  vesting: vestingAddr,
  beneficiary: beneficiaryAddr,
  total: total.toString(),
  released: released.toString(),
  start: start.toString(),
  cliff: cliff.toString(),
  duration: duration.toString(),
  exists,
  revoked,
  revokedAt: revokedAt.toString(),
};

const outDir = path.join(repoRoot, "contracts/evidence/phase-8.4.B.B");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "new-grant-surface.json"),
  JSON.stringify(artifact, null, 2) + "\n"
);

console.log("New grant surface:");
console.log(`  vesting:     ${artifact.vesting}`);
console.log(`  beneficiary: ${artifact.beneficiary}`);
console.log(`  total:       ${artifact.total}`);
console.log(`  released:    ${artifact.released}`);
console.log(`  start:       ${artifact.start}`);
console.log(`  cliff:       ${artifact.cliff}`);
console.log(`  duration:    ${artifact.duration}`);
console.log(`  exists:      ${artifact.exists}`);
console.log(`  revoked:     ${artifact.revoked}`);
console.log(`  revokedAt:   ${artifact.revokedAt}`);
console.log(`\nWrote: contracts/evidence/phase-8.4.B.B/new-grant-surface.json`);