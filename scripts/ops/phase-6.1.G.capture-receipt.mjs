import path from "path";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { nowIsoSafe, writeJsonDeterministic, copyLatest } from "./_evidence.mjs";

const PHASE = "phase-6.1.G";
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

async function main() {
  const TX = process.env.TX;
  if (!TX) throw new Error("Set TX=0x...");

  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

  const receipt = await client.waitForTransactionReceipt({ hash: TX });

  const evidenceDir = path.resolve(`evidence/${PHASE}`);
  const ts = nowIsoSafe();
  const outPath = path.join(evidenceDir, `tx-receipt-${ts}.json`);
  const latestPath = path.join(evidenceDir, `tx-receipt.latest.json`);

  const payload = {
    schema: "evidence-tx-receipt-v1",
    phase: PHASE,
    network: { name: "Base Sepolia", chainId: 84532 },
    rpc: RPC_URL,
    txHash: TX,
    receipt,
    notes: [
      "Receipt captured via viem waitForTransactionReceipt (direct RPC).",
      "Includes logs/events (if any) and mined block data.",
    ],
  };

  const { sha256 } = writeJsonDeterministic(outPath, payload);
  copyLatest(latestPath, outPath);

  console.log("✅ wrote:", outPath);
  console.log("✅ status:", receipt.status);
  console.log("✅ blockNumber:", receipt.blockNumber?.toString?.() ?? String(receipt.blockNumber));
  console.log("✅ sha256:", sha256);
  console.log("✅ latest ->", latestPath);
}

main().catch((e) => {
  console.error("❌ capture-receipt failed:", e?.message || e);
  process.exit(1);
});
