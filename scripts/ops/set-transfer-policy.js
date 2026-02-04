import "dotenv/config";
import { createPublicClient, createWalletClient, http, getAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const TOKEN = getAddress(process.env.TOKEN || "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17");

const NEW_POLICY = process.env.NEW_COMPOSITE_ROOT
  ? getAddress(process.env.NEW_COMPOSITE_ROOT)
  : null;
if (!NEW_POLICY) throw new Error("Set NEW_COMPOSITE_ROOT=0x...");

const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("Missing PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(RPC), account });

const ABI = parseAbi([
  "function transferPolicy() view returns (address)",
  "function setTransferPolicy(address newPolicy)",
]);

async function main() {
  console.log("\n== Set EquityTokenV2.transferPolicy ==");
  console.log("chainId:", baseSepolia.id);
  console.log("rpcUrl:", RPC);
  console.log("caller:", account.address);
  console.log("token:", TOKEN);
  console.log("newPolicy:", NEW_POLICY);

  const pre = await publicClient.readContract({
    address: TOKEN,
    abi: ABI,
    functionName: "transferPolicy",
  });

  console.log("\nPre-state:");
  console.log("  transferPolicy:", pre);

  if (pre.toLowerCase() === NEW_POLICY.toLowerCase()) {
    console.log("\nNo-op: already set. ✅");
    return;
  }

  console.log("\nSending tx: setTransferPolicy(newPolicy) ...");
  const hash = await walletClient.writeContract({
    address: TOKEN,
    abi: ABI,
    functionName: "setTransferPolicy",
    args: [NEW_POLICY],
  });

  console.log("txHash:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log("\nReceipt:");
  console.log("  status:", receipt.status);
  console.log("  blockNumber:", receipt.blockNumber);
  console.log("  gasUsed:", receipt.gasUsed);

  const post = await publicClient.readContract({
    address: TOKEN,
    abi: ABI,
    functionName: "transferPolicy",
  });

  console.log("\nPost-state:");
  console.log("  transferPolicy:", post);

  if (post.toLowerCase() !== NEW_POLICY.toLowerCase()) {
    throw new Error("Policy update failed.");
  }

  console.log("\n✅ transferPolicy updated successfully.");
}

main().catch((e) => {
  console.error("ERROR:", e.message || e);
  process.exit(1);
});
