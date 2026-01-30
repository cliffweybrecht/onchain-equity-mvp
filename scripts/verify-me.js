import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isAddress(x) {
  return /^0x[a-fA-F0-9]{40}$/.test(x || "");
}

async function main() {
  // Load deployed addresses
  const deploymentsPath = path.join(__dirname, "..", "deployments", "base-sepolia.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const registryAddress = deployments.IdentityRegistry;
  const defaultTarget = deployments.deployer;

  // Choose who to verify (Hardhat v3-friendly): env var first, otherwise verify deployer
  const maybeEnv =
    process.env.TARGET_ADDRESS ||
    process.env.VERIFY_ADDRESS ||
    process.env.ADDRESS;

  const target = isAddress(maybeEnv) ? maybeEnv : defaultTarget;

  // Hardhat 3: plugins live on the network connection
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const walletClient = await viem.getWalletClient();

  const chainId = await publicClient.getChainId();
  const [caller] = await walletClient.getAddresses();

  console.log("\n== Verify IdentityRegistry ==");
  console.log("chainId:", chainId);
  console.log("caller:", caller);
  console.log("registry:", registryAddress);

  if (Number(chainId) !== 84532) {
    throw new Error(`Wrong chainId. Expected 84532 (Base Sepolia), got ${chainId}`);
  }

  // Read contract
  const registry = await viem.getContractAt("IdentityRegistry", registryAddress);

  const admin = await registry.read.admin();
  console.log("registry.admin():", admin);

  // If caller isn't admin, setStatus will revert with NotAdmin()
  if (admin.toLowerCase() !== caller.toLowerCase()) {
    console.log("\n⚠️ Caller is not admin. setStatus will revert.");
    console.log("   admin =", admin);
    console.log("   caller=", caller);
    return;
  }

  console.log("\nTarget to verify:", target);

  // Pre-state
  const beforeStatus = await registry.read.getStatus([target]);
  const beforeVerified = await registry.read.isVerified([target]);
  console.log("Before -> getStatus:", beforeStatus.toString(), "isVerified:", beforeVerified);

  // Simulate first so we get a clean revert reason (if any) BEFORE sending a tx
  try {
    await registry.simulate.setStatus([target, 1]);
    console.log("simulate.setStatus: ✅ would succeed");
  } catch (e) {
    console.log("simulate.setStatus: ❌ would revert");
    console.error(e);
    return;
  }

  console.log("\nSetting status=1 (Verified) for:", target);

  const txHash = await registry.write.setStatus([target, 1]);
  console.log("setStatus tx:", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("mined in block:", receipt.blockNumber.toString());
  console.log("tx status:", receipt.status); // IMPORTANT: tells us if it reverted

  // Post-state
const bn = receipt.blockNumber;

const afterStatus = await registry.read.getStatus([target], { blockNumber: bn });
const afterVerified = await registry.read.isVerified([target], { blockNumber: bn });

const latestStatus = await registry.read.getStatus([target]);
const latestVerified = await registry.read.isVerified([target]);

console.log("After@mined -> getStatus:", afterStatus.toString(), "isVerified:", afterVerified);
console.log("After@latest-> getStatus:", latestStatus.toString(), "isVerified:", latestVerified);

  console.log("After  -> getStatus:", afterStatus.toString());
  console.log("After  -> isVerified:", afterVerified);

  // If it didn't change, make it extremely obvious why this matters
  if (!afterVerified) {
    console.log("\n⚠️ Verification did NOT stick.");
    console.log("   If tx status is 'reverted' (or 0x0), it failed on-chain.");
    console.log("   If tx status is 'success' but state didn't change, ABI/signature/value mismatch is likely.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
