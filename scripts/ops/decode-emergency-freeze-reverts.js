import "dotenv/config";
import fs from "fs";
import { createPublicClient, http, decodeErrorResult } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const EMERGENCY = process.env.EMERGENCY;
const SAFE = process.env.SAFE;
const DEPLOYER = process.env.DEPLOYER;

if (!EMERGENCY || !SAFE || !DEPLOYER) throw new Error("Set EMERGENCY, SAFE, DEPLOYER.");

const artifactPath = "artifacts/contracts/policies/EmergencyFreezePolicyV2.sol/EmergencyFreezePolicyV2.json";
if (!fs.existsSync(artifactPath)) throw new Error(`Artifact not found: ${artifactPath}`);

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const abi = artifact.abi;

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

async function sim(fn, account) {
  try {
    await client.simulateContract({ address: EMERGENCY, abi, functionName: fn, args: [], account });
    console.log(`SIM OK   ${fn} as ${account}`);
  } catch (e) {
    const data = e?.data || e?.cause?.data;
    console.log(`SIM FAIL ${fn} as ${account}`);
    const short = (e?.shortMessage || e?.message || "").toString().split("\n")[0];
    console.log("  msg:", short);

    if (data) {
      try {
        const decoded = decodeErrorResult({ abi, data });
        console.log("  decoded:", decoded.errorName, decoded.args ?? []);
      } catch {
        console.log("  revertData:", data);
      }
    } else {
      console.log("  (no revert data surfaced by viem)");
    }
  }
}

async function main() {
  console.log("\n== Decode EmergencyFreezePolicyV2 revert reasons ==");
  console.log("artifact:", artifactPath);
  console.log("emergency:", EMERGENCY);
  console.log("safe:", SAFE);
  console.log("deployer:", DEPLOYER);

  try {
    const frozen = await client.readContract({ address: EMERGENCY, abi, functionName: "frozen" });
    console.log("frozen():", frozen);
  } catch (e) {
    const m = (e?.shortMessage || e?.message || "").toString().split("\n")[0];
    console.log("frozen(): read failed:", m);
  }

  await sim("freeze", SAFE);
  await sim("freeze", DEPLOYER);
  await sim("unfreeze", SAFE);
  await sim("unfreeze", DEPLOYER);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
