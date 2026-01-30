import "dotenv/config";
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY");

  const TOKEN = process.env.TOKEN_V2;
  const ADMIN = process.env.ADMIN;
  if (!TOKEN) throw new Error("Set TOKEN_V2");
  if (!ADMIN) throw new Error("Set ADMIN");

  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  if (account.address.toLowerCase() !== ADMIN.toLowerCase()) {
    console.log("⚠️ account.address != ADMIN (still ok if caller is authorized)");
    console.log("caller:", account.address);
    console.log("ADMIN :", ADMIN);
  }

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

  const abi = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function mint(address to, uint256 amount)",
  ]);

  const balBefore = await publicClient.readContract({ address: TOKEN, abi, functionName: "balanceOf", args: [ADMIN] });
  const tsBefore = await publicClient.readContract({ address: TOKEN, abi, functionName: "totalSupply" });

  console.log("== Mint 1 to admin ==");
  console.log("token:", TOKEN);
  console.log("admin:", ADMIN);
  console.log("balanceBefore:", balBefore.toString());
  console.log("totalSupplyBefore:", tsBefore.toString());

  const hash = await walletClient.writeContract({
    address: TOKEN,
    abi,
    functionName: "mint",
    args: [ADMIN, 1n],
  });

  console.log("tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status);
  console.log("mined in block:", receipt.blockNumber);

  const balAfter = await publicClient.readContract({ address: TOKEN, abi, functionName: "balanceOf", args: [ADMIN] });
  const tsAfter = await publicClient.readContract({ address: TOKEN, abi, functionName: "totalSupply" });

  console.log("balanceAfter:", balAfter.toString());
  console.log("totalSupplyAfter:", tsAfter.toString());

  if (receipt.status !== "success") throw new Error("Mint reverted");
  if (balAfter < 1n) throw new Error("Admin still has < 1 token after mint");
  console.log("✅ Minted 1 to admin.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
