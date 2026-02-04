import "dotenv/config";
import { createPublicClient, http, getAddress, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const FREEZE_POLICY = getAddress(process.env.FREEZE_POLICY || "0x72dAf10067387bb9022356246a1734E871931e58");

// Caller we want to test (your deployer/admin EOA)
const FROM = getAddress(process.env.FROM || "0x6C775411e11cAb752Af03C5BBb440618788E13Be");

// Any valid-looking address to test rotation to (does NOT send)
const TO_TEST = getAddress(process.env.TO_TEST || "0x1111111111111111111111111111111111111111");

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

const ABI = parseAbi(["function setEmergencyAdmin(address newAdmin)"]);

async function main() {
  console.log("\n== Can Rotate Emergency Admin? (eth_estimateGas) ==");
  console.log("chainId:", baseSepolia.id);
  console.log("rpcUrl:", RPC);
  console.log("freezePolicy:", FREEZE_POLICY);
  console.log("from:", FROM);
  console.log("to_test:", TO_TEST);

  // also print slot0 for visibility
  const slot0 = await client.getStorageAt({ address: FREEZE_POLICY, slot: 0n });
  console.log("\nslot0:", slot0);

  try {
    const gas = await client.estimateContractGas({
      address: FREEZE_POLICY,
      abi: ABI,
      functionName: "setEmergencyAdmin",
      args: [TO_TEST],
      account: FROM,
    });
    console.log("\nResult: ✅ estimate succeeded");
    console.log("estimatedGas:", gas.toString());
    console.log("Interpretation: FROM is very likely current emergency admin.");
  } catch (e) {
    console.log("\nResult: ❌ estimate failed");
    console.log("error:", e?.shortMessage || e?.message || String(e));
    console.log("Interpretation: FROM is likely NOT current emergency admin (or call is otherwise blocked).");
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});
