import "dotenv/config";
import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
const DEPLOY_FILE = path.resolve("deployments/base-sepolia.json");

function req(name, v) {
  if (!v) throw new Error(`Missing required field: ${name}`);
  return v;
}
function norm(label, addr) {
  try { return getAddress(addr); } catch { throw new Error(`${label} invalid address: ${addr}`); }
}

async function pollFrozen(publicClient, emergency, abi, expected, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const v = await publicClient.readContract({ address: emergency, abi, functionName: "frozen" });
    if (v === expected) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return await publicClient.readContract({ address: emergency, abi, functionName: "frozen" });
}

async function main() {
  if (!pk) throw new Error("Missing PRIVATE_KEY in env");
  if (!fs.existsSync(DEPLOY_FILE)) throw new Error(`Missing ${DEPLOY_FILE}`);
  const d = JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));

  const active = req("active", d.active);
  const stacks = req("policyStacks", d.policyStacks);
  const policyStackId = req("active.policyStackId", active.policyStackId);
  const stack = req(`policyStacks[${policyStackId}]`, stacks[policyStackId]);
  const children = req("childPolicies", stack.childPolicies);

  const emergencyRaw =
    children.find((x) => String(x.name).includes("EmergencyFreezePolicyV2"))?.address;
  if (!emergencyRaw) throw new Error("EmergencyFreezePolicyV2 not found in active childPolicies");
  const emergency = norm("EmergencyFreezePolicyV2", emergencyRaw);

  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

  const abi = parseAbi([
    "function frozen() view returns (bool)",
    "function emergencyAdmin() view returns (address)",
    "function emergencyUnfreeze(string reason)",
  ]);

  console.log("\n== OPS EMERGENCY UNFREEZE ==");
  console.log("RPC:", rpcUrl);
  console.log("Caller:", account.address);
  console.log("EmergencyFreezePolicyV2:", emergency);

  const admin = await publicClient.readContract({ address: emergency, abi, functionName: "emergencyAdmin" });
  const before = await publicClient.readContract({ address: emergency, abi, functionName: "frozen" });
  console.log("emergencyAdmin:", admin);
  console.log("frozen(before):", before);

  if (String(admin).toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Caller is not emergencyAdmin. emergencyAdmin=${admin} caller=${account.address}`);
  }
  if (before === false) {
    console.log("✅ Already unfrozen. No action taken.");
    return;
  }

  const reason =
    process.env.REASON ||
    `pilot-break-glass unfreeze (Part 3.8.2) @ ${new Date().toISOString()}`;

  const hash = await walletClient.writeContract({
    address: emergency,
    abi,
    functionName: "emergencyUnfreeze",
    args: [reason],
  });
  console.log("tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ mined in block:", receipt.blockNumber.toString());

  const after = await pollFrozen(publicClient, emergency, abi, false, 12);
  console.log("frozen(after):", after);
  console.log("");
}

main().catch((e) => {
  console.error("❌ unfreeze failed:", e.message || e);
  process.exit(1);
});
