import "dotenv/config";
import fs from "fs";
import path from "path";
import { createWalletClient, createPublicClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("Missing PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const SAFE = process.env.SAFE ? getAddress(process.env.SAFE) : null;

// We keep admin as the deployer EOA for this recovery deploy,
// then rotate Composite admin to SAFE in Step 5 (same pattern as token/registry/vesting).
const ADMIN = account.address;

const POLICY_STACK_ID = process.env.POLICY_STACK_ID || "BASESEP-84532-STACK-2026-01-28-v1.3-recover1";

const NEW_FREEZE_POLICY = getAddress(process.env.NEW_FREEZE_POLICY || "0x7df0bb151637c8cc18642fd9aa005b1d418fc7bb");
const COMPLIANCE_POLICY = getAddress(process.env.COMPLIANCE_POLICY || "0x38c905c289b3ef1a244d95c8b1925a37c34839c8");
const MIN_AMOUNT_POLICY = getAddress(process.env.MIN_AMOUNT_POLICY || "0x97c9a7b6155ca7a794ee23f48c33427a4adb3cf8");

const POLICIES = [NEW_FREEZE_POLICY, COMPLIANCE_POLICY, MIN_AMOUNT_POLICY];

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(RPC), account });

const artifactPath = path.resolve("artifacts/contracts/policy/CompositePolicyV111.sol/CompositePolicyV111.json");
if (!fs.existsSync(artifactPath)) {
  throw new Error("Artifact not found. Expected:\n" + artifactPath + "\nRun `npx hardhat compile` if needed.");
}
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const { abi, bytecode } = artifact;

async function main() {
  console.log("\n== Deploy CompositePolicyV111 (v1.3 recovery root) ==");
  console.log("chainId:", baseSepolia.id);
  console.log("rpcUrl:", RPC);
  console.log("deployer:", account.address);
  console.log("admin (initial):", ADMIN);
  if (SAFE) console.log("SAFE (planned admin):", SAFE);
  console.log("policyStackId:", POLICY_STACK_ID);
  console.log("\nPolicies (AND ordered):");
  console.log("  [0] EmergencyFreezePolicyV2:", NEW_FREEZE_POLICY);
  console.log("  [1] ComplianceGatedPolicyV1:", COMPLIANCE_POLICY);
  console.log("  [2] MinAmountPolicyV1:", MIN_AMOUNT_POLICY);

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [ADMIN, POLICY_STACK_ID, POLICIES],
  });

  console.log("\ntxHash:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status);
  console.log("blockNumber:", receipt.blockNumber);
  console.log("contractAddress:", receipt.contractAddress);

  if (!receipt.contractAddress) throw new Error("No contractAddress in receipt");
  console.log("\n✅ NEW_COMPOSITE_ROOT =", receipt.contractAddress);
}

main().catch((e) => {
  console.error("ERROR:", e.message || e);
  process.exit(1);
});
