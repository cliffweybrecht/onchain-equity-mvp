import "dotenv/config";
import fs from "fs";
import path from "path";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY");

  const ADMIN = process.env.ADMIN || "0x6C775411e11cAb752Af03C5BBb440618788E13Be";

  const CHILD_0 = "0x38c905c289b3ef1a244d95c8b1925a37c34839c8"; // ComplianceGatedPolicyV1
  const CHILD_1 = "0x97c9a7b6155ca7a794ee23f48c33427a4adb3cf8"; // MinAmountPolicyV1 (min=3)

  const POLICY_STACK_ID =
    process.env.POLICY_STACK_ID || "BASESEP-84532-STACK-2026-01-28-v1.1";

  const policies = [CHILD_0, CHILD_1];

  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

  const artifactPath = path.resolve(
    "artifacts/contracts/policy/CompositePolicyV111.sol/CompositePolicyV111.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  console.log("== Deploy CompositePolicyV111 (viem) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("chainId:", baseSepolia.id);
  console.log("deployer:", account.address);
  console.log("constructor admin:", ADMIN);
  console.log("policyStackId:", POLICY_STACK_ID);
  console.log("policies:", policies);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [ADMIN, POLICY_STACK_ID, policies],
  });

  console.log("tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ mined in block:", receipt.blockNumber);
  console.log("✅ CompositePolicyV111 deployed:", receipt.contractAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
