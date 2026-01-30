import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const PRIVATE_KEY = mustGetEnv("PRIVATE_KEY");
  const account = privateKeyToAccount(PRIVATE_KEY);

  const artifactPath = path.resolve(
    __dirname,
    "../artifacts/contracts/IdentityRegistry.sol/IdentityRegistry.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const { abi, bytecode } = artifact;

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("🚀 Deploying IdentityRegistry...");
  console.log("👤 Admin:", account.address);

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [account.address],
  });

  console.log("📨 Deployment tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log("✅ IdentityRegistry deployed at:", receipt.contractAddress);
}

main().catch((e) => {
  console.error("❌ Deploy failed:", e);
  process.exit(1);
});
