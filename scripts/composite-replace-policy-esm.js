import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;

const COMPOSITE = process.env.COMPOSITE;
const NEW_POLICY = process.env.NEW_POLICY;
const INDEX = BigInt(process.env.INDEX || "1");

if (!pk) throw new Error("Missing PRIVATE_KEY");
if (!COMPOSITE) throw new Error("Missing COMPOSITE");
if (!NEW_POLICY) throw new Error("Missing NEW_POLICY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const abi = parseAbi([
  "function getPolicies() view returns (address[])",
  "function replacePolicy(uint256 index, address newPolicy)",
]);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

async function main() {
  console.log("\n== Composite replacePolicy ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("composite:", COMPOSITE);
  console.log("index:", INDEX.toString());
  console.log("newPolicy:", NEW_POLICY);

  const before = await publicClient.readContract({ address: COMPOSITE, abi, functionName: "getPolicies" });
  console.log("policies before:", before);

  const hash = await walletClient.writeContract({
    address: COMPOSITE,
    abi,
    functionName: "replacePolicy",
    args: [INDEX, NEW_POLICY],
  });
  console.log("tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status);
  console.log("blockNumber:", receipt.blockNumber.toString());

  const after = await publicClient.readContract({ address: COMPOSITE, abi, functionName: "getPolicies" });
  console.log("policies after:", after);

  console.log("\n✅ Replaced.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
