import "dotenv/config";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const COMPOSITE = process.env.COMPOSITE;
const EMERGENCY = process.env.EMERGENCY;
const COMPLIANCE = process.env.COMPLIANCE;
const MINAMOUNT = process.env.MINAMOUNT;

const TOKEN = process.env.TOKEN;
const FROM = process.env.DEPLOYER;
const TO = process.env.SAFE;
const AMOUNT = 1n;

for (const [k, v] of Object.entries({ COMPOSITE, TOKEN, FROM, TO, EMERGENCY, COMPLIANCE, MINAMOUNT })) {
  if (!v) throw new Error(`Missing env var: ${k}`);
}

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

const abi = parseAbi([
  "function canTransfer(address,address,address,uint256) view returns (bool)",
  "function canTransferTrace(address,address,address,uint256) view returns (bool,uint256,address)"
]);

const ok = await client.readContract({
  address: COMPOSITE,
  abi,
  functionName: "canTransfer",
  args: [TOKEN, FROM, TO, AMOUNT],
});

const [ok2, idx, failedPolicy] = await client.readContract({
  address: COMPOSITE,
  abi,
  functionName: "canTransferTrace",
  args: [TOKEN, FROM, TO, AMOUNT],
});

const fp = failedPolicy.toLowerCase();
let name = "UNKNOWN";
if (fp === EMERGENCY.toLowerCase()) name = "EMERGENCY_FREEZE_POLICY_V2";
else if (fp === COMPLIANCE.toLowerCase()) name = "COMPLIANCE_GATED_POLICY_V1";
else if (fp === MINAMOUNT.toLowerCase()) name = "MIN_AMOUNT_POLICY_V1";
else if (fp === "0x0000000000000000000000000000000000000000") name = "NONE";

console.log("\n== Composite Root Trace ==");
console.log("rpcUrl:", rpcUrl);
console.log("token:", TOKEN);
console.log("from :", FROM);
console.log("to   :", TO);
console.log("amount:", AMOUNT.toString());

console.log("\nComposite canTransfer:", ok);
console.log("Composite trace:", [ok2, idx, failedPolicy]);
console.log("FAILED POLICY NAME:", name);

if (ok !== ok2) console.log("WARN: canTransfer and trace ok differ (unexpected).");
