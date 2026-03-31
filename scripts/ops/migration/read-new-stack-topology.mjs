import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { readFileSync, mkdirSync } from "fs";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const config = JSON.parse(
  readFileSync(path.join(repoRoot, "manifests/migration/stack-config.json"), "utf8")
);

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
if (!rpcUrl) throw new Error("BASE_SEPOLIA_RPC_URL is not set");

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

const ADMIN_ABI = [{ name: "admin", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }];
const TOKEN_ABI = [
  { name: "admin", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "identityRegistry", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
];
const VESTING_ABI = [
  { name: "admin", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "token", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "identityRegistry", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
];

const tokenAddr = getAddress(config.new_stack.token);
const vestingAddr = getAddress(config.new_stack.vesting);

const [
  tokenAdmin,
  tokenIdentityRegistry,
  tokenDecimals,
  vestingAdmin,
  vestingToken,
  vestingIdentityRegistry,
] = await Promise.all([
  client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "admin" }),
  client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "identityRegistry" }),
  client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "decimals" }),
  client.readContract({ address: vestingAddr, abi: VESTING_ABI, functionName: "admin" }),
  client.readContract({ address: vestingAddr, abi: VESTING_ABI, functionName: "token" }),
  client.readContract({ address: vestingAddr, abi: VESTING_ABI, functionName: "identityRegistry" }),
]);

const artifact = {
  configured_safe: getAddress(config.safe),
  configured_identity_registry: getAddress(config.identity_registry),
  configured_new_token: tokenAddr,
  configured_new_vesting: vestingAddr,
  observed_token_admin: getAddress(tokenAdmin),
  observed_token_identity_registry: getAddress(tokenIdentityRegistry),
  observed_token_decimals: tokenDecimals,
  observed_vesting_admin: getAddress(vestingAdmin),
  observed_vesting_token: getAddress(vestingToken),
  observed_vesting_identity_registry: getAddress(vestingIdentityRegistry),
};

const outDir = path.join(repoRoot, "contracts/evidence/phase-8.4.B.B");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "new-stack-topology.json"), JSON.stringify(artifact, null, 2) + "\n");

console.log("New stack topology:");
console.log(`  safe:                          ${artifact.configured_safe}`);
console.log(`  identity_registry (config):    ${artifact.configured_identity_registry}`);
console.log(`  new token:                     ${artifact.configured_new_token}`);
console.log(`  new vesting:                   ${artifact.configured_new_vesting}`);
console.log(`  token.admin():                 ${artifact.observed_token_admin}`);
console.log(`  token.identityRegistry():      ${artifact.observed_token_identity_registry}`);
console.log(`  token.decimals():              ${artifact.observed_token_decimals}`);
console.log(`  vesting.admin():               ${artifact.observed_vesting_admin}`);
console.log(`  vesting.token():               ${artifact.observed_vesting_token}`);
console.log(`  vesting.identityRegistry():    ${artifact.observed_vesting_identity_registry}`);
console.log(`\nWrote: contracts/evidence/phase-8.4.B.B/new-stack-topology.json`);
