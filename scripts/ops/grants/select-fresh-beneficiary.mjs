import fs from "fs";
import process from "process";
import { createPublicClient, http, getAddress, isAddress, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";

const VESTING_ABI = [
  {
    type: "function",
    name: "grants",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "total", type: "uint256" },
      { name: "released", type: "uint256" },
      { name: "start", type: "uint64" },
      { name: "cliff", type: "uint64" },
      { name: "duration", type: "uint64" }
    ]
  }
];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function required(name, value) {
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

const rpcUrl = required("--rpc", argValue("--rpc") || process.env.BASE_SEPOLIA_RPC_URL);
const vesting = getAddress(required("--vesting", argValue("--vesting")));
const beneficiary = getAddress(required("--beneficiary", argValue("--beneficiary")));
const out = required("--out", argValue("--out"));

if (!isAddress(beneficiary)) {
  throw new Error(`Invalid beneficiary address: ${beneficiary}`);
}

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
});

const rawGrant = await client.readContract({
  address: vesting,
  abi: VESTING_ABI,
  functionName: "grants",
  args: [beneficiary]
});

let total;
let released;
let start;
let cliff;
let duration;

if (Array.isArray(rawGrant)) {
  [total, released, start, cliff, duration] = rawGrant;
} else if (rawGrant && typeof rawGrant === "object") {
  total = rawGrant.total;
  released = rawGrant.released;
  start = rawGrant.start;
  cliff = rawGrant.cliff;
  duration = rawGrant.duration;
} else {
  throw new Error(`Unexpected grant shape: ${JSON.stringify(rawGrant)}`);
}

total = BigInt(total ?? 0);
released = BigInt(released ?? 0);
start = Number(start ?? 0);
cliff = Number(cliff ?? 0);
duration = Number(duration ?? 0);

const exists =
  total > 0n ||
  released > 0n ||
  start > 0 ||
  cliff > 0 ||
  duration > 0;

const result = {
  phase: "8.1.C",
  generated_at: new Date().toISOString(),
  vesting,
  beneficiary,
  raw_grant_shape: Array.isArray(rawGrant) ? "tuple_array" : typeof rawGrant,
  grant_state: {
    total_raw: total.toString(),
    total_display: formatUnits(total, 18),
    released_raw: released.toString(),
    released_display: formatUnits(released, 18),
    start,
    cliff,
    duration,
    exists
  },
  verdict: exists ? "BENEFICIARY_ALREADY_HAS_GRANT" : "FRESH_BENEFICIARY_CONFIRMED"
};

fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
