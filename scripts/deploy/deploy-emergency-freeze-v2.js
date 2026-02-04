import "dotenv/config";
import { createWalletClient, createPublicClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const SAFE = process.env.SAFE ? getAddress(process.env.SAFE) : null;

if (!SAFE) throw new Error("Set SAFE=0xYourSafeAddress");

const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("Missing PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(RPC), account });

// Load artifact produced by Hardhat compile
const artifactPath = path.resolve(
  "artifacts/contracts/policies/EmergencyFreezePolicyV2.sol/EmergencyFreezePolicyV2.json"
);

if (!fs.existsSync(artifactPath)) {
  throw new Error(
    "Artifact not found. Did you run `npx hardhat compile`?\n" +
    artifactPath
  );
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const { abi, bytecode } = artifact;

async function main() {
  console.log("\n== Deploy EmergencyFreezePolicyV2 ==");
  console.log("chainId:", baseSepolia.id);
  console.log("rpcUrl:", RPC);
  console.log("deployer:", account.address);
  console.log("emergencyAdmin (SAFE):", SAFE);

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [SAFE],
  });

  console.log("txHash:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log("status:", receipt.status);
  console.log("blockNumber:", receipt.blockNumber);
  console.log("contractAddress:", receipt.contractAddress);

  if (!receipt.contractAddress) {
    throw new Error("Deployment failed: no contract address in receipt");
  }

  console.log("\n✅ NEW_FREEZE_POLICY =", receipt.contractAddress);
}

main().catch((e) => {
  console.error("ERROR:", e.message || e);
  process.exit(1);
});
