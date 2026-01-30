import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const PRIVATE_KEY = mustGetEnv("PRIVATE_KEY");

  if (!/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
    throw new Error(
      `PRIVATE_KEY must be 0x + 64 hex chars. Got: ${PRIVATE_KEY.slice(0, 6)}...`
    );
  }

  const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
  const account = privateKeyToAccount(PRIVATE_KEY);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const artifactPath = path.resolve(
    __dirname,
    "../artifacts/contracts/EquityToken.sol/EquityToken.json"
  );

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const { abi, bytecode } = artifact;

  const name = "EquityToken";
  const symbol = "EQT";

  // ✅ Use the real IdentityRegistry you deployed
  const identityRegistry = "0x36923ae4b0fdcdb99f476c30ac3ef7aa6fbfe655";
  const admin = account.address;

  console.log("🚀 Deploying EquityToken to Base Sepolia...");
  console.log("👤 Deployer:", account.address);
  console.log("🪪 IdentityRegistry:", identityRegistry);
  console.log("🌐 RPC:", RPC_URL);

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [name, symbol, identityRegistry, admin],
  });

  console.log("📨 Deployment tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log("✅ EquityToken deployed at:", receipt.contractAddress);
}

main().catch((err) => {
  console.error("❌ Deploy failed:", err);
  process.exit(1);
});
