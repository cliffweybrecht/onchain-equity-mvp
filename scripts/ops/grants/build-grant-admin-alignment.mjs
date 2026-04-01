import fs from "fs";
import process from "process";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

const VESTING_ADMIN_ABI = [
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
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
const vesting = getAddress(required("--vesting", argValue("--vesting")));
const configuredSender = getAddress(required("--configured-sender", argValue("--configured-sender")));
const out = required("--out", argValue("--out"));

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
});

const detectedAdmin = await client.readContract({
  address: vesting,
  abi: VESTING_ADMIN_ABI,
  functionName: "admin",
  args: []
});

const senderMatchesAdmin =
  configuredSender.toLowerCase() === detectedAdmin.toLowerCase();

const result = {
  phase: "8.1.C",
  generated_at: new Date().toISOString(),
  vesting,
  authority_surface: {
    method_used: "admin()",
    detected_admin: detectedAdmin,
    owner_supported: false,
    role_based_admin_supported: false
  },
  configured_sender: configuredSender,
  sender_matches_admin: senderMatchesAdmin,
  required_execution_path: senderMatchesAdmin
    ? "DIRECT_ADMIN_CALL_POSSIBLE"
    : "SAFE_OR_ADMIN_CONTRACT_EXECUTION_REQUIRED",
  verdict: senderMatchesAdmin
    ? "ADMIN_PATH_ALIGNED"
    : "CONFIGURED_SENDER_NOT_ADMIN"
};

fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
