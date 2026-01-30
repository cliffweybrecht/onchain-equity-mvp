import "dotenv/config";
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;

const ADMIN = process.env.ADMIN || "0x6C775411e11cAb752Af03C5BBb440618788E13Be";
const MIN_AMOUNT = BigInt(process.env.MIN_AMOUNT || "2");

if (!pk) throw new Error("Missing PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const artifactPath = path.resolve(
  "artifacts/contracts/policy/MinAmountPolicyV1.sol/MinAmountPolicyV1.json"
);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

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
  console.log("\n== Deploy MinAmountPolicyV1 ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("chainId:", baseSepolia.id);
  console.log("deployer:", account.address);
  console.log("admin:", ADMIN);
  console.log("minAmount:", MIN_AMOUNT.toString());

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [ADMIN, MIN_AMOUNT],
  });

  console.log("deploy tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status);
  console.log("contractAddress:", receipt.contractAddress);

  if (!receipt.contractAddress) {
    throw new Error("No contractAddress in receipt");
  }

  console.log("\n✅ MinAmountPolicyV1 deployed:", receipt.contractAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
