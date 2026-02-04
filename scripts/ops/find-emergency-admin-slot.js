import "dotenv/config";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const FREEZE_POLICY = getAddress(process.env.FREEZE_POLICY || "0x72dAf10067387bb9022356246a1734E871931e58");

// The admin we expect to find in storage (current controller).
const EXPECT = (process.env.EXPECT_EMERGENCY_ADMIN || "0x6C775411e11cAb752Af03C5BBb440618788E13Be").toLowerCase();

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

function addrFromSlot32(slotHex) {
  const hex = slotHex.startsWith("0x") ? slotHex.slice(2) : slotHex;
  const last20 = hex.slice(24);
  return `0x${last20}`.toLowerCase();
}

async function main() {
  console.log("\n== Find emergencyAdmin storage slot ==");
  console.log("chainId:", baseSepolia.id);
  console.log("rpcUrl:", RPC);
  console.log("freezePolicy:", FREEZE_POLICY);
  console.log("expect:", EXPECT);

  const matches = [];

  // Scan first 64 slots (more than enough for this contract pattern)
  for (let i = 0n; i < 64n; i++) {
    const v = await client.getStorageAt({ address: FREEZE_POLICY, slot: i });
    const a = addrFromSlot32(v);
    if (a === EXPECT) {
      matches.push({ slot: i, raw: v });
    }
  }

  console.log("\nMatches:");
  if (matches.length === 0) {
    console.log("  (none found in slots 0..63)");
  } else {
    for (const m of matches) {
      console.log(`  slot ${m.slot.toString()}: ${m.raw}`);
    }
  }

  console.log("\nTip: if multiple matches, we’ll rotate to a REAL Safe and see which slot changes.");
  console.log("Done.");
}

main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});
