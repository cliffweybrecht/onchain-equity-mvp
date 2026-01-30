import fs from "fs";
import { createWalletClient, createPublicClient, http, formatUnits, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const CONTRACT = "0xf9a2e60af436f6bc940d36030b91e4e7aa6e4bd1";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const PRIVATE_KEY = mustGetEnv("PRIVATE_KEY");
  const account = privateKeyToAccount(PRIVATE_KEY);

  const artifact = JSON.parse(
    fs.readFileSync("./artifacts/contracts/EquityToken.sol/EquityToken.json", "utf8")
  );
  const abi = artifact.abi;

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });

  console.log("🌐 RPC:", RPC_URL);
  console.log("📄 Contract:", CONTRACT);
  console.log("👤 Deployer:", account.address);

  const decimals = await publicClient.readContract({ address: CONTRACT, abi, functionName: "decimals" });
  console.log("🔢 decimals:", decimals);

  // Mint 100 tokens (adjust if you want)
  const amount = parseUnits("100", Number(decimals));
  console.log("🪙 Minting:", `100 (raw: ${amount.toString()}) to ${account.address}`);

  const hash = await walletClient.writeContract({
    address: CONTRACT,
    abi,
    functionName: "mint",
    args: [account.address, amount],
  });

  console.log("📨 mint tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ mint confirmed in block:", receipt.blockNumber);

  const bal = await publicClient.readContract({
    address: CONTRACT,
    abi,
    functionName: "balanceOf",
    args: [account.address],
  });

  const supply = await publicClient.readContract({
    address: CONTRACT,
    abi,
    functionName: "totalSupply",
  });

  console.log("✅ balance:", formatUnits(bal, Number(decimals)));
  console.log("✅ totalSupply:", formatUnits(supply, Number(decimals)));
}

main().catch((e) => {
  console.error("❌ Mint test failed:", e);
  process.exit(1);
});
