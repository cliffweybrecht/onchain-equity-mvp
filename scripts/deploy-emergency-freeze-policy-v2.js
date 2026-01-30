import "dotenv/config";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("Set PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const ADMIN = process.env.ADMIN || account.address;

const artifactPath = path.resolve(
  "artifacts/contracts/policies/EmergencyFreezePolicyV2.sol/EmergencyFreezePolicyV2.json"
);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

async function main() {
  console.log("\n== Deploy EmergencyFreezePolicyV2 ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("deployer:", account.address);
  console.log("emergencyAdmin:", ADMIN);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [ADMIN],
  });

  console.log("deploy tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("deployed at:", receipt.contractAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
