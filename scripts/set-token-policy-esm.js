import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;

const TOKEN = process.env.TOKEN || "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17";
const COMPOSITE = process.env.COMPOSITE;

if (!pk) throw new Error("Missing PRIVATE_KEY");
if (!COMPOSITE) throw new Error("Missing COMPOSITE");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const tokenAbi = parseAbi([
  "function transferPolicy() view returns (address)",
  "function setTransferPolicy(address newPolicy)",
]);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl),
});

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(rpcUrl),
});

async function main() {
  console.log("\n== Set EquityTokenV2 transferPolicy ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("token:", TOKEN);
  console.log("newPolicy:", COMPOSITE);

  const before = await publicClient.readContract({
    address: TOKEN,
    abi: tokenAbi,
    functionName: "transferPolicy",
  });
  console.log("transferPolicy before:", before);

  const hash = await walletClient.writeContract({
    address: TOKEN,
    abi: tokenAbi,
    functionName: "setTransferPolicy",
    args: [COMPOSITE],
  });
  console.log("tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status);

  const after = await publicClient.readContract({
    address: TOKEN,
    abi: tokenAbi,
    functionName: "transferPolicy",
  });
  console.log("transferPolicy after:", after);

  console.log("\n✅ Policy updated successfully.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
