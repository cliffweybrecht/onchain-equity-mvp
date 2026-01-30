import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;

const COMPOSITE = process.env.COMPOSITE;
const NEW_POLICY = process.env.NEW_POLICY;

if (!pk) throw new Error("Missing PRIVATE_KEY");
if (!COMPOSITE) throw new Error("Missing COMPOSITE");
if (!NEW_POLICY) throw new Error("Missing NEW_POLICY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const abi = parseAbi([
  "function getPolicies() view returns (address[])",
  "function addPolicy(address policy)",
]);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

async function main() {
  console.log("\n== Composite addPolicy ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("composite:", COMPOSITE);
  console.log("newPolicy:", NEW_POLICY);

  const before = await publicClient.readContract({
    address: COMPOSITE,
    abi,
    functionName: "getPolicies",
  });
  console.log("policies before:", before);

  const hash = await walletClient.writeContract({
    address: COMPOSITE,
    abi,
    functionName: "addPolicy",
    args: [NEW_POLICY],
  });
  console.log("tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status);

  const after = await publicClient.readContract({
    address: COMPOSITE,
    abi,
    functionName: "getPolicies",
  });
  console.log("policies after:", after);

  console.log("\n✅ Added.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
