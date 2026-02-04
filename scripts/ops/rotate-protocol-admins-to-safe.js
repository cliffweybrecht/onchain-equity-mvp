import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const SAFE = process.env.SAFE;
const REGISTRY = process.env.REGISTRY;
const TOKEN = process.env.TOKEN;
const VESTING = process.env.VESTING;
const NEW_COMPOSITE_ROOT = process.env.NEW_COMPOSITE_ROOT;
const pk = process.env.PRIVATE_KEY;

function req(name, v) {
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

req("SAFE", SAFE);
req("REGISTRY", REGISTRY);
req("TOKEN", TOKEN);
req("VESTING", VESTING);
req("NEW_COMPOSITE_ROOT", NEW_COMPOSITE_ROOT);
req("PRIVATE_KEY", pk);

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl),
});

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(rpcUrl),
});

const abiAdmin = parseAbi([
  "function admin() view returns (address)",
  "function setAdmin(address newAdmin)",
]);

async function rotateOne(address, label, newAdmin) {
  const before = await publicClient.readContract({
    address,
    abi: abiAdmin,
    functionName: "admin",
  });

  console.log(`\n${label}: ${address}`);
  console.log(`  before admin(): ${before}`);

  if (before.toLowerCase() === newAdmin.toLowerCase()) {
    console.log("  ✅ already SAFE");
    return;
  }

  console.log(`  -> setAdmin(${newAdmin})`);
  const hash = await walletClient.writeContract({
    address,
    abi: abiAdmin,
    functionName: "setAdmin",
    args: [newAdmin],
  });
  console.log(`     tx: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`     ✅ confirmed in block ${receipt.blockNumber}`);

  const after = await publicClient.readContract({
    address,
    abi: abiAdmin,
    functionName: "admin",
  });
  console.log(`  after admin(): ${after}`);

  if (after.toLowerCase() !== newAdmin.toLowerCase()) {
    throw new Error(`${label}: admin did not update to SAFE (after=${after})`);
  }

  console.log("  ✅ rotated to SAFE");
}

async function main() {
  const chainId = await publicClient.getChainId();
  console.log("== Rotate Protocol Admins to Safe (Step 5) ==");
  console.log(`chainId: ${chainId}`);
  console.log(`rpcUrl: ${rpcUrl}`);
  console.log(`caller/deployer: ${account.address}`);
  console.log(`SAFE: ${SAFE}`);

  await rotateOne(REGISTRY, "IdentityRegistry", SAFE);
  await rotateOne(TOKEN, "EquityTokenV2", SAFE);
  await rotateOne(VESTING, "VestingContract", SAFE);
  await rotateOne(NEW_COMPOSITE_ROOT, "CompositePolicyV111 (root)", SAFE);

  console.log("\n✅ Step 5 complete: Registry/Token/Vesting/Composite root admins rotated to SAFE.");
}

main().catch((e) => {
  console.error("\n❌ Rotation failed:");
  console.error(e);
  process.exit(1);
});
