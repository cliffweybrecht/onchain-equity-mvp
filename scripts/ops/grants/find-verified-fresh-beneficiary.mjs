import fs from "fs";
import process from "process";
import { createPublicClient, http, getAddress, formatUnits } from "viem";
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
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

const rpcUrl = required("--rpc", argValue("--rpc") || process.env.BASE_SEPOLIA_RPC_URL);
const registry = getAddress(required("--registry", argValue("--registry")));
const vesting = getAddress(required("--vesting", argValue("--vesting")));
const candidatesFile = required("--candidates", argValue("--candidates"));
const out = required("--out", argValue("--out"));

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
});

const rawCandidates = fs
  .readFileSync(candidatesFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const uniqueCandidates = [...new Set(rawCandidates.map((x) => getAddress(x)))];

async function readGrantState(beneficiary) {
  const rawGrant = await client.readContract({
    address: vesting,
    abi: VESTING_ABI,
    functionName: "grants",
    args: [beneficiary]
  });

  let total, released, start, cliff, duration;

  if (Array.isArray(rawGrant)) {
    [total, released, start, cliff, duration] = rawGrant;
  } else {
    total = rawGrant?.total;
    released = rawGrant?.released;
    start = rawGrant?.start;
    cliff = rawGrant?.cliff;
    duration = rawGrant?.duration;
  }

  total = BigInt(total ?? 0);
  released = BigInt(released ?? 0);
  start = Number(start ?? 0);
  cliff = Number(cliff ?? 0);
  duration = Number(duration ?? 0);

  const hasGrant =
    total > 0n ||
    released > 0n ||
    start > 0 ||
    cliff > 0 ||
    duration > 0;

  return {
    total_raw: total.toString(),
    total_display: formatUnits(total, 18),
    released_raw: released.toString(),
    released_display: formatUnits(released, 18),
    start,
    cliff,
    duration,
    exists: hasGrant
  };
}

const results = [];

for (const beneficiary of uniqueCandidates) {
  let isVerified = false;
  let verificationError = null;
  let grantState = null;
  let grantError = null;

  try {
    isVerified = await client.readContract({
      address: registry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "isVerified",
      args: [beneficiary]
    });
  } catch (err) {
    verificationError = err instanceof Error ? err.message : String(err);
  }

  try {
    grantState = await readGrantState(beneficiary);
  } catch (err) {
    grantError = err instanceof Error ? err.message : String(err);
  }

  const verifiedFresh =
    verificationError === null &&
    grantError === null &&
    isVerified === true &&
    grantState?.exists === false;

  results.push({
    beneficiary,
    identity: {
      is_verified: isVerified,
      error_message: verificationError
    },
    grant_state: grantState,
    grant_error: grantError,
    verified_fresh: verifiedFresh
  });
}

const firstMatch = results.find((r) => r.verified_fresh) ?? null;

const output = {
  phase: "8.1.C",
  generated_at: new Date().toISOString(),
  registry,
  vesting,
  candidates_file: candidatesFile,
  candidate_count: uniqueCandidates.length,
  first_verified_fresh_beneficiary: firstMatch?.beneficiary ?? null,
  results
};

fs.writeFileSync(out, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));
