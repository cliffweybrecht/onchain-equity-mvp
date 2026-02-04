import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const FREEZE_POLICY_RAW = process.env.FREEZE_POLICY || "0x72dAf10067387bb9022356246a1734E871931e58";
const FREEZE_POLICY = getAddress(FREEZE_POLICY_RAW);
const NEW_ADMIN_RAW = process.env.NEW_EMERGENCY_ADMIN;
if (!NEW_ADMIN_RAW) throw new Error("Set NEW_EMERGENCY_ADMIN=0x... (target multisig/Safe address).");
const NEW_ADMIN = getAddress(NEW_ADMIN_RAW);

const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("Missing PRIVATE_KEY in env (current emergency admin key needed).");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(RPC), account });

const ABI = parseAbi([
  "function setEmergencyAdmin(address newAdmin)",
]);

function addrFromSlot32(slotHex) {
  const hex = slotHex.startsWith("0x") ? slotHex.slice(2) : slotHex;
  const last20 = hex.slice(24);
  return `0x${last20}`.toLowerCase();
}

async function readEmergencyAdminStorage() {
  const slot0 = await publicClient.getStorageAt({ address: FREEZE_POLICY, slot: 0n });
  return { slot0, admin: addrFromSlot32(slot0) };
}

async function main() {
  console.log("\n== Rotate Emergency Admin ==");
  console.log("chainId:", baseSepolia.id);
  console.log("rpcUrl:", RPC);
  console.log("freezePolicy:", FREEZE_POLICY);
  console.log("caller:", account.address);
  console.log("newEmergencyAdmin:", NEW_ADMIN);

  // Pre-state (storage)
  const pre = await readEmergencyAdminStorage();
  console.log("\nPre-state:");
  console.log("  slot0:", pre.slot0);
  console.log("  emergencyAdmin (from slot0):", pre.admin);

  const callerLower = account.address.toLowerCase();
  if (pre.admin !== callerLower) {
    throw new Error(
      `Caller is not current emergencyAdmin.\n` +
      `storage emergencyAdmin=${pre.admin}\ncaller=${callerLower}\n` +
      `Use the key that currently controls emergencyAdmin.`
    );
  }

  const newLower = NEW_ADMIN.toLowerCase(); // checksummed already
  if (pre.admin === newLower) {
    console.log("\nNo-op: emergencyAdmin already set to target. ✅");
    return;
  }

  // Send tx
  console.log("\nSending tx: setEmergencyAdmin(newAdmin) ...");
  const hash = await walletClient.writeContract({
    address: FREEZE_POLICY,
    abi: ABI,
    functionName: "setEmergencyAdmin",
    args: [NEW_ADMIN],
  });

  console.log("txHash:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("\nReceipt:");
  console.log("  status:", receipt.status);
  console.log("  blockNumber:", receipt.blockNumber);
  console.log("  gasUsed:", receipt.gasUsed);

  // Post-state
  const post = await readEmergencyAdminStorage();
  console.log("\nPost-state:");
  console.log("  slot0:", post.slot0);
  console.log("  emergencyAdmin (from slot0):", post.admin);

  if (post.admin !== newLower) {
    throw new Error(`Rotation failed: expected ${newLower} but got ${post.admin}`);
  }

  console.log("\n✅ Emergency admin rotated successfully.");
}

main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});
