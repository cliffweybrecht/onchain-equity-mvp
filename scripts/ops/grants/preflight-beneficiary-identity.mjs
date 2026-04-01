import fs from "fs";
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

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function required(name, value) {
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

const rpcUrl = required("--rpc", argValue("--rpc") || process.env.BASE_SEPOLIA_RPC_URL);
const registry = getAddress(required("--registry", argValue("--registry")));
const beneficiary = getAddress(required("--beneficiary", argValue("--beneficiary")));
const out = required("--out", argValue("--out"));

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
});

let isVerified = null;
let verificationCheck = "NOT_RUN";
let errorMessage = null;

try {
  isVerified = await client.readContract({
    address: registry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "isVerified",
    args: [beneficiary]
  });
  verificationCheck = "OK";
} catch (err) {
  verificationCheck = "CALL_FAILED";
  errorMessage = err instanceof Error ? err.message : String(err);
}

const result = {
  phase: "8.1.C",
  generated_at: new Date().toISOString(),
  registry,
  beneficiary,
  identity_check: {
    verification_check: verificationCheck,
    is_verified: isVerified,
    error_message: errorMessage
  },
  verdict:
    verificationCheck !== "OK"
      ? "IDENTITY_CHECK_UNAVAILABLE"
      : isVerified
        ? "IDENTITY_COMPATIBLE"
        : "IDENTITY_NOT_VERIFIED"
};

fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
