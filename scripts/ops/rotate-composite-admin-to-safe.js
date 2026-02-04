import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const ROOT = process.env.NEW_COMPOSITE_ROOT;
const SAFE = process.env.SAFE;
const pk = process.env.PRIVATE_KEY;

if (!ROOT || !SAFE || !pk) throw new Error("Need NEW_COMPOSITE_ROOT, SAFE, PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

const abi = parseAbi([
  "function admin() view returns (address)",
  "function setAdmin(address newAdmin)"
]);

console.log("== Rotate CompositePolicyV111 admin to SAFE ==");
console.log("ROOT:", ROOT);
console.log("SAFE:", SAFE);

const before = await publicClient.readContract({
  address: ROOT,
  abi,
  functionName: "admin",
});
console.log("before admin():", before);

if (before.toLowerCase() === SAFE.toLowerCase()) {
  console.log("✅ already SAFE");
  process.exit(0);
}

const hash = await walletClient.writeContract({
  address: ROOT,
  abi,
  functionName: "setAdmin",
  args: [SAFE],
});
console.log("tx:", hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("✅ confirmed in block", receipt.blockNumber);

const after = await publicClient.readContract({
  address: ROOT,
  abi,
  functionName: "admin",
});
console.log("after admin():", after);
console.log(after.toLowerCase() === SAFE.toLowerCase() ? "✅ rotated to SAFE" : "⚠️ NOT SAFE");
