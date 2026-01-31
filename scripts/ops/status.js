import "dotenv/config";
import fs from "fs";
import path from "path";
import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const DEPLOY_FILE = path.resolve("deployments/base-sepolia.json");

function req(name, v) {
  if (!v) throw new Error(`Missing required field: ${name}`);
  return v;
}

function norm(label, addr) {
  try {
    return getAddress(addr);
  } catch {
    throw new Error(`${label} invalid address: ${addr}`);
  }
}

async function main() {
  if (!fs.existsSync(DEPLOY_FILE)) throw new Error(`Missing ${DEPLOY_FILE}`);
  const d = JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));

  const contracts = req("contracts", d.contracts);
  const active = req("active", d.active);
  const stacks = req("policyStacks", d.policyStacks);

  const policyStackId = req("active.policyStackId", active.policyStackId);
  const compositeRoot = norm("active.compositeRoot", req("active.compositeRoot", active.compositeRoot));
  const stack = req(`policyStacks[${policyStackId}]`, stacks[policyStackId]);
  const children = req("childPolicies", stack.childPolicies);

  const emergencyRaw =
    children.find((x) => String(x.name).includes("EmergencyFreezePolicyV2"))?.address;
  const emergency = emergencyRaw ? norm("EmergencyFreezePolicyV2", emergencyRaw) : null;

  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const latestBlock = await client.getBlockNumber();

  console.log("\n== OPS STATUS ==");
  console.log("RPC:", rpcUrl);
  console.log("chainId:", await client.getChainId());
  console.log("latestBlock:", latestBlock.toString());

  console.log("\nDeployer:", d.deployer);
  console.log("Admin:", d.admin);

  console.log("\nContracts:");
  console.log("  IdentityRegistry:", norm("IdentityRegistry", contracts.IdentityRegistry));
  console.log("  EquityTokenV2:", norm("EquityTokenV2", contracts.EquityTokenV2));
  console.log("  VestingContract:", norm("VestingContract", contracts.VestingContract));

  console.log("\nActive Policy Stack:");
  console.log("  policyStackId:", policyStackId);
  console.log("  compositeRoot:", compositeRoot);
  console.log("  childPolicies:");
  for (const p of children) {
    console.log(`    - ${p.name}: ${norm(p.name, p.address)}`);
  }

  if (emergency) {
    const abi = parseAbi([
      "function frozen() view returns (bool)",
      "function emergencyAdmin() view returns (address)",
    ]);
    const frozen = await client.readContract({ address: emergency, abi, functionName: "frozen" });
    const admin = await client.readContract({ address: emergency, abi, functionName: "emergencyAdmin" });

    console.log("\nEmergency Freeze Policy:");
    console.log("  address:", emergency);
    console.log("  emergencyAdmin:", admin);
    console.log("  frozen:", frozen);
  } else {
    console.log("\nEmergency Freeze Policy: NOT FOUND in childPolicies");
  }

  console.log("");
}

main().catch((e) => {
  console.error("❌ status failed:", e.message || e);
  process.exit(1);
});
