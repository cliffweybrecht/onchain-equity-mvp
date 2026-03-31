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
const expectedOldVesting = getAddress(stackConfig.old_stack.vesting);

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

const observedTokenAdmin = getAddress(
  await client.readContract({ address: token, abi: adminAbi, functionName: "admin" })
);

const migrationBlocked = observedTokenAdmin === expectedOldVesting;

const conclusion = {
  token,
  expected_old_vesting: expectedOldVesting,
  observed_token_admin: observedTokenAdmin,
  migration_blocked: migrationBlocked,
  reason: migrationBlocked
    ? "old token admin is old vesting; vesting-only migration cannot change token admin"
    : "old token admin is not old vesting; migration block assumption does not hold",
};

const outPath = path.join(ROOT, "contracts/evidence/phase-8.4.B.B/blocked-migration-conclusion.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(conclusion, null, 2) + "\n");

console.log(`token=${token}`);
console.log(`expected_old_vesting=${expectedOldVesting}`);
console.log(`observed_token_admin=${observedTokenAdmin}`);
console.log(`migration_blocked=${migrationBlocked}`);
console.error(`Wrote ${outPath}`);
