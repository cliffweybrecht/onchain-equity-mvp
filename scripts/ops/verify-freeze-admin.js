import "dotenv/config";
import { createPublicClient, http, decodeAbiParameters } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const FREEZE_POLICY = process.env.FREEZE_POLICY || "0x72dAf10067387bb9022356246a1734E871931e58";

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

const ABI_EMERGENCY = [
  { type: "function", name: "emergencyAdmin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

function addrFromSlot32(slotHex) {
  // slotHex is 0x + 64 hex chars
  const hex = slotHex.startsWith("0x") ? slotHex.slice(2) : slotHex;
  const last20 = hex.slice(24); // last 40 chars = 20 bytes
  return `0x${last20}`;
}

async function main() {
  console.log("\n== Verify Emergency Admin ==");
  console.log("chainId:", baseSepolia.id);
  console.log("rpcUrl:", RPC);
  console.log("freezePolicy:", FREEZE_POLICY);

  // 1) Try normal getter
  try {
    const v = await client.readContract({ address: FREEZE_POLICY, abi: ABI_EMERGENCY, functionName: "emergencyAdmin" });
    console.log("\nGetter:");
    console.log("  emergencyAdmin():", v);
  } catch (e) {
    console.log("\nGetter:");
    console.log("  emergencyAdmin(): (failed)");
  }

  // 2) Always read slot0 (common pattern when emergencyAdmin is first state var)
  const code = await client.getBytecode({ address: FREEZE_POLICY });
  console.log("\nBytecode:");
  console.log("  deployed code present:", !!code);

  const slot0 = await client.getStorageAt({ address: FREEZE_POLICY, slot: 0n });
  console.log("\nStorage:");
  console.log("  slot0:", slot0);
  console.log("  slot0 as address:", addrFromSlot32(slot0));

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
