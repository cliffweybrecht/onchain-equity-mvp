#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;
if (!RPC_URL) {
  console.error("Missing BASE_SEPOLIA_RPC_URL");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../../..");

const stackConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, "manifests/migration/stack-config.json"), "utf8")
);

const token = getAddress(stackConfig.old_stack.token);

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const adminAbi = [
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];

const admin = getAddress(
  await client.readContract({ address: token, abi: adminAbi, functionName: "admin" })
);

const output = `token=${token}\nadmin=${admin}\n`;
process.stdout.write(output);

const outPath = path.join(ROOT, "contracts/evidence/phase-8.4.B.B/old-token-admin-read.txt");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, output);
console.error(`Wrote ${outPath}`);
