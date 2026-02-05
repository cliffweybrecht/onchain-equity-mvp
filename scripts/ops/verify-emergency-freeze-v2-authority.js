import "dotenv/config";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const EMERGENCY = process.env.EMERGENCY;
const SAFE = process.env.SAFE;
const DEPLOYER = process.env.DEPLOYER;

if (!EMERGENCY || !SAFE || !DEPLOYER) throw new Error("Set EMERGENCY, SAFE, DEPLOYER.");

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

const abi = parseAbi([
  "function emergencyAdmin() view returns (address)",
  "function frozen() view returns (bool)",
  "function emergencyFreeze(string reason) external",
  "function emergencyUnfreeze(string reason) external"
]);

async function sim(fn, account, reason) {
  try {
    await client.simulateContract({
      address: EMERGENCY,
      abi,
      functionName: fn,
      args: [reason],
      account
    });
    console.log(`SIM OK   ${fn} as ${account}`);
    return true;
  } catch (e) {
    const msg = (e?.shortMessage || e?.message || "").toString().split("\n")[0];
    console.log(`SIM FAIL ${fn} as ${account} :: ${msg}`);
    return false;
  }
}

async function main() {
  console.log("\n== Verify EmergencyFreezePolicyV2 Authority (correct V2 methods) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("emergency:", EMERGENCY);
  console.log("safe:", SAFE);
  console.log("deployer:", DEPLOYER);

  const admin = await client.readContract({ address: EMERGENCY, abi, functionName: "emergencyAdmin" });
  const frozen = await client.readContract({ address: EMERGENCY, abi, functionName: "frozen" });

  console.log("\nemergencyAdmin():", admin);
  console.log("frozen():", frozen);

  console.log("\n-- Simulations (NO STATE CHANGES) --");
  const safeFreeze = await sim("emergencyFreeze", SAFE, "sim-check");
  const depFreeze  = await sim("emergencyFreeze", DEPLOYER, "sim-check");
  const safeUnfreeze = await sim("emergencyUnfreeze", SAFE, "sim-check");
  const depUnfreeze  = await sim("emergencyUnfreeze", DEPLOYER, "sim-check");

  console.log("\n== Decision signal ==");
  console.log("SAFE can emergencyFreeze?       ", safeFreeze);
  console.log("DEPLOYER can emergencyFreeze?   ", depFreeze);
  console.log("SAFE can emergencyUnfreeze?     ", safeUnfreeze);
  console.log("DEPLOYER can emergencyUnfreeze? ", depUnfreeze);
}
main().catch((e)=>{ console.error(e); process.exit(1); });
