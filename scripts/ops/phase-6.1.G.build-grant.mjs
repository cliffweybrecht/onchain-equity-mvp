import fs from "fs";
import path from "path";
import { createPublicClient, http, encodeFunctionData, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { nowIsoSafe, writeJsonDeterministic, copyLatest } from "./_evidence.mjs";

const PHASE = "phase-6.1.G";
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

const VESTING = getAddress(process.env.VESTING || "0xEf444C538769d7626511A4C538d03fFc7e53262B");
const BENEFICIARY = process.env.BENEFICIARY ? getAddress(process.env.BENEFICIARY) : null;

// Hard requirement: decimals=0 => base units == integer tokens
const AMOUNT_OEQ = process.env.AMOUNT_OEQ ? BigInt(process.env.AMOUNT_OEQ) : null;

// Unix seconds
const START = process.env.START ? BigInt(process.env.START) : null;
const CLIFF = process.env.CLIFF ? BigInt(process.env.CLIFF) : null;
const DURATION = process.env.DURATION ? BigInt(process.env.DURATION) : null;

const REVOCABLE = process.env.REVOCABLE === "true";

function loadVestingAbi() {
  const candidates = [
    "artifacts/contracts/VestingContract.sol/VestingContract.json",
    "artifacts/contracts/Vesting.sol/Vesting.json",
    "out/VestingContract.sol/VestingContract.json",
    "out/Vesting.sol/Vesting.json",
  ].map((p) => path.resolve(p));

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (!j.abi) throw new Error(`Artifact found but missing .abi: ${p}`);
      return j.abi;
    }
  }
  throw new Error("Missing vesting artifact ABI (compile locally or add your artifact path).");
}

const PREFERRED_FN_NAMES = [
  "createGrant",
  "createVesting",
  "createVestingGrant",
  "grant",
  "grantTo",
  "createGrantFor",
];

function findGrantFunction(abi) {
  const fns = abi.filter((x) => x.type === "function");
  for (const name of PREFERRED_FN_NAMES) {
    const matches = fns.filter((f) => f.name === name);
    if (matches.length === 1) return matches[0];

    if (matches.length > 1) {
      const best = matches.find((m) => {
        const ts = m.inputs.map((i) => i.type);
        return (
          ts.length >= 3 &&
          ts[0] === "address" &&
          ts.includes("bool") &&
          ts.filter((t) => t.startsWith("uint")).length >= 2
        );
      });
      if (best) return best;
    }
  }
  return null;
}

async function main() {
  if (!BENEFICIARY) throw new Error("Set BENEFICIARY=0x...");
  if (AMOUNT_OEQ === null) throw new Error("Set AMOUNT_OEQ (integer OEQ, decimals=0).");
  if (START === null || CLIFF === null || DURATION === null) {
    throw new Error("Set START, CLIFF, DURATION (unix seconds).");
  }

  const abi = loadVestingAbi();
  const grantFn = findGrantFunction(abi);
  if (!grantFn) {
    throw new Error(
      `Could not auto-find a grant-create function.\n` +
        `Searched: ${PREFERRED_FN_NAMES.join(", ")}\n` +
        `Open ABI and tell me the function name.`
    );
  }

  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const pinnedBlockNumber = await client.getBlockNumber();
  const pinnedBlock = await client.getBlock({ blockNumber: pinnedBlockNumber });

  // Deterministic arg resolution:
  // address -> BENEFICIARY
  // uints -> [AMOUNT, START, CLIFF, DURATION], extras => 0
  // bool -> REVOCABLE
  let uintCount = 0;
  const args = grantFn.inputs.map((inp) => {
    if (inp.type === "address") return BENEFICIARY;
    if (inp.type.startsWith("uint")) {
      uintCount += 1;
      if (uintCount === 1) return AMOUNT_OEQ;
      if (uintCount === 2) return START;
      if (uintCount === 3) return CLIFF;
      if (uintCount === 4) return DURATION;
      return 0n;
    }
    if (inp.type === "bool") return REVOCABLE;
    throw new Error(`Unsupported param type in ${grantFn.name}: ${inp.type}`);
  });

  const data = encodeFunctionData({
    abi,
    functionName: grantFn.name,
    args,
  });

  const evidenceDir = path.resolve(`evidence/${PHASE}`);
  const ts = nowIsoSafe();

  const outPath = path.join(evidenceDir, `build-grant-${ts}.json`);
  const latestPath = path.join(evidenceDir, `build-grant.latest.json`);

  const payload = {
    schema: "evidence-build-calldata-v1",
    phase: PHASE,
    network: { name: "Base Sepolia", chainId: 84532 },
    rpc: RPC_URL,
    pinnedBlock: {
      number: pinnedBlock.number?.toString(),
      hash: pinnedBlock.hash,
      timestamp: pinnedBlock.timestamp?.toString(),
    },
    tx: {
      to: VESTING,
      value: "0",
      functionName: grantFn.name,
      functionInputs: grantFn.inputs,
      argsResolved: args,
      argsHuman: {
        beneficiary: BENEFICIARY,
        amountBaseUnits_OEQ_decimals0: AMOUNT_OEQ.toString(),
        start: START.toString(),
        cliff: CLIFF.toString(),
        duration: DURATION.toString(),
        revocable: REVOCABLE,
      },
      encodedData: data,
    },
    warnings: [
      uintCount > 4
        ? "Grant function has >4 uint params; any extras were set to 0n. Verify ABI expectations."
        : null,
    ].filter(Boolean),
    notes: [
      "Calldata built only. No transaction sent.",
      "Amount uses OEQ decimals=0 => baseUnits == integer tokens.",
    ],
  };

  const { sha256 } = writeJsonDeterministic(outPath, payload);
  copyLatest(latestPath, outPath);

  const safePath = path.join(evidenceDir, `safe-calldata-${ts}.json`);
  const safeLatest = path.join(evidenceDir, `safe-calldata.latest.json`);

  const safePayload = {
    to: VESTING,
    value: "0",
    data,
    operation: 0,
    chainId: 84532,
    description: `${PHASE} vesting grant`,
  };

  writeJsonDeterministic(safePath, safePayload);
  copyLatest(safeLatest, safePath);

  console.log("✅ wrote:", outPath);
  console.log("✅ pinnedBlock:", payload.pinnedBlock.number, payload.pinnedBlock.hash);
  console.log("✅ function:", grantFn.name);
  console.log("✅ calldata:", data);
  console.log("✅ sha256:", sha256);
  console.log("✅ latest ->", latestPath);
  console.log("✅ safe payload ->", safePath);
}

main().catch((e) => {
  console.error("❌ build-grant failed:", e?.message || e);
  process.exit(1);
});
