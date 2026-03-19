import fs from "fs";
import path from "path";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { nowIsoSafe, writeJsonDeterministic, copyLatest } from "./_evidence.mjs";

const PHASE = "phase-6.1.G";
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

const VESTING = getAddress(
  process.env.VESTING || "0xEf444C538769d7626511A4C538d03fFc7e53262B"
);
const BENEFICIARY = process.env.BENEFICIARY
  ? getAddress(process.env.BENEFICIARY)
  : null;

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
  throw new Error("Missing vesting artifact ABI.");
}

function normalizeGrantRead(grantValue) {
  if (!grantValue) return null;

  const total = grantValue.total ?? grantValue[0];
  const released = grantValue.released ?? grantValue[1];
  const start = grantValue.start ?? grantValue[2];
  const cliff = grantValue.cliff ?? grantValue[3];
  const duration = grantValue.duration ?? grantValue[4];
  const exists = grantValue.exists ?? grantValue[5];
  const revoked = grantValue.revoked ?? grantValue[6];
  const revokedAt = grantValue.revokedAt ?? grantValue[7];

  return {
    total: total?.toString?.() ?? String(total),
    released: released?.toString?.() ?? String(released),
    start: start?.toString?.() ?? String(start),
    cliff: cliff?.toString?.() ?? String(cliff),
    duration: duration?.toString?.() ?? String(duration),
    exists: Boolean(exists),
    revoked: Boolean(revoked),
    revokedAt: revokedAt?.toString?.() ?? String(revokedAt),
  };
}

async function main() {
  if (!BENEFICIARY) throw new Error("Set BENEFICIARY=0x...");

  const abi = loadVestingAbi();
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Pin a postflight block and read everything at that block.
  const pinnedBlockNumber = await client.getBlockNumber();
  const pinnedBlock = await client.getBlock({ blockNumber: pinnedBlockNumber });

  const token = await client.readContract({
    address: VESTING,
    abi,
    functionName: "token",
    args: [],
    blockNumber: pinnedBlockNumber,
  });

  // Read the full current grant surface from the compiled VestingContract ABI.
  const grant = await client.readContract({
    address: VESTING,
    abi,
    functionName: "grants",
    args: [BENEFICIARY],
    blockNumber: pinnedBlockNumber,
  });

  const normalizedGrant = normalizeGrantRead(grant);

  const evidenceDir = path.resolve(`evidence/${PHASE}`);
  const ts = nowIsoSafe();
  const outPath = path.join(evidenceDir, `postflight-pinned-${ts}.json`);
  const latestPath = path.join(evidenceDir, `postflight-pinned.latest.json`);

  const payload = {
    schema: "evidence-pinned-reads-v2",
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
      "Vesting.grants(beneficiary)": grant,
    },
    normalized: {
      grant: normalizedGrant,
    },
    notes: [
      "Postflight confirmation at pinned block (direct RPC).",
      "Compare grant terms to intended amount/start/cliff/duration.",
      "Current grant surface also includes exists/revoked/revokedAt state.",
    ],
  };

  const { sha256 } = writeJsonDeterministic(outPath, payload);
  copyLatest(latestPath, outPath);

  console.log("✅ wrote:", outPath);
  console.log(
    "✅ pinnedBlock:",
    payload.pinnedBlock.number,
    payload.pinnedBlock.hash
  );
  console.log("✅ Vesting.token():", token);
  console.log("✅ grants():", grant);
  console.log("✅ normalizedGrant:", normalizedGrant);
  console.log("✅ sha256:", sha256);
  console.log("✅ latest ->", latestPath);
}

main().catch((e) => {
  console.error("❌ postflight failed:", e?.message || e);
  process.exit(1);
});
