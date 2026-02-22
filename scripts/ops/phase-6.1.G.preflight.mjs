import fs from "fs";
import path from "path";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { nowIsoSafe, writeJsonDeterministic, copyLatest } from "./_evidence.mjs";

const PHASE = "phase-6.1.G";
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

const VESTING = getAddress(process.env.VESTING || "0xEf444C538769d7626511A4C538d03fFc7e53262B");
const BENEFICIARY = process.env.BENEFICIARY ? getAddress(process.env.BENEFICIARY) : null;

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

  throw new Error(
    "Missing vesting artifact ABI.\n" +
      "Tried:\n" +
      candidates.map((p) => `- ${p}`).join("\n") +
      "\n\nFix options:\n" +
      "1) If you use Hardhat: run `npx hardhat compile` (local only; no chain interaction)\n" +
      "2) Or tell me your actual artifact path and we’ll pin it.\n"
  );
}

async function main() {
  if (!BENEFICIARY) throw new Error("Set BENEFICIARY=0x...");

  const abi = loadVestingAbi();

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const pinnedBlockNumber = await client.getBlockNumber();
  const pinnedBlock = await client.getBlock({ blockNumber: pinnedBlockNumber });

  const token = await client.readContract({
    address: VESTING,
    abi,
    functionName: "token",
    args: [],
    blockNumber: pinnedBlockNumber,
  });

  let grant = null;
  let grantReadFn = null;

  for (const fn of ["grants", "grantOf", "getGrant"]) {
    try {
      grant = await client.readContract({
        address: VESTING,
        abi,
        functionName: fn,
        args: [BENEFICIARY],
        blockNumber: pinnedBlockNumber,
      });
      grantReadFn = fn;
      break;
    } catch (_) {}
  }

  let adminHint = null;
  for (const fn of ["admin", "owner", "governor", "safe"]) {
    try {
      adminHint = await client.readContract({
        address: VESTING,
        abi,
        functionName: fn,
        args: [],
        blockNumber: pinnedBlockNumber,
      });
      break;
    } catch (_) {}
  }

  const evidenceDir = path.resolve(`evidence/${PHASE}`);
  const ts = nowIsoSafe();
  const outPath = path.join(evidenceDir, `preflight-pinned-${ts}.json`);
  const latestPath = path.join(evidenceDir, `preflight-pinned.latest.json`);

  const payload = {
    schema: "evidence-pinned-reads-v1",
    phase: PHASE,
    network: { name: "Base Sepolia", chainId: 84532 },
    rpc: RPC_URL,
    contracts: { vesting: VESTING },
    inputs: { beneficiary: BENEFICIARY },
    pinnedBlock: {
      number: pinnedBlock.number?.toString(),
      hash: pinnedBlock.hash,
      timestamp: pinnedBlock.timestamp?.toString(),
    },
    reads: {
      "Vesting.token()": token,
      adminHint,
      beneficiaryGrant: {
        functionUsed: grantReadFn,
        value: grant,
      },
    },
    notes: [
      "All reads executed at pinnedBlock.number via viem readContract(blockNumber=...).",
      "No state changes performed.",
    ],
  };

  const { sha256 } = writeJsonDeterministic(outPath, payload);
  copyLatest(latestPath, outPath);

  console.log("✅ wrote:", outPath);
  console.log("✅ pinnedBlock:", payload.pinnedBlock.number, payload.pinnedBlock.hash);
  console.log("✅ Vesting.token():", token);
  console.log("✅ grantReadFn:", grantReadFn);
  console.log("✅ grantValue:", grant);
  console.log("✅ sha256:", sha256);
  console.log("✅ latest ->", latestPath);
}

main().catch((e) => {
  console.error("❌ preflight failed:", e?.message || e);
  process.exit(1);
});
