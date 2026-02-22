import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "node:fs";
import path from "node:path";

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const VESTING = process.env.VESTING || "0xEf444C538769d7626511A4C538d03fFc7e53262B";

const ABI = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

  const pinnedNumber = await client.getBlockNumber();
  const blk = await client.getBlock({ blockNumber: pinnedNumber });
  if (!blk?.hash) throw new Error("Could not fetch pinned block hash.");

  const tok = await client.readContract({
    address: VESTING,
    abi: ABI,
    functionName: "token",
    blockNumber: pinnedNumber,
  });

  const result = {
    phase: "6.1.F",
    check: "vesting.token pointer",
    chain: { name: baseSepolia.name, chainId: baseSepolia.id },
    rpcUrl: RPC_URL,
    pinnedBlock: {
      number: pinnedNumber.toString(),
      hash: blk.hash,
      timestamp: blk.timestamp.toString(),
    },
    vesting: VESTING,
    reads: {
      token: tok,
    },
    executedAt: new Date().toISOString(),
    notes: ["Read-only; no state changes. Pinned block for deterministic evidence."],
  };

  const outDir = path.join("evidence", "phase-6.1.F");
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outJson = path.join(outDir, `vesting-token-pointer-pinned-${stamp}.json`);
  const outLatest = path.join(outDir, "vesting-token-pointer-pinned.latest.json");

  fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
  fs.writeFileSync(outLatest, JSON.stringify(result, null, 2));

  console.log("✅ Pinned block:", `${pinnedNumber} ${blk.hash}`);
  console.log("✅ Vesting:", VESTING);
  console.log("✅ Vesting.token():", tok);
  console.log("🧾 Evidence written:");
  console.log(" -", outJson);
  console.log(" -", outLatest);
}

main().catch((err) => {
  console.error("❌ Vesting token pointer read failed:");
  console.error(err);
  process.exit(1);
});
