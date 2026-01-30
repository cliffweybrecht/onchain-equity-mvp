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

const TOKEN = process.env.TOKEN || "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17";
const FREEZE_POLICY = process.env.FREEZE_POLICY || "0xb09c259771409f472c9b970baaca55f18021bd03";
const BENEFICIARY = process.env.BENEFICIARY || "0x8B24E58442c0ECc9Ac11A22beb89C8eE53ED4544";

function loadArtifact(rel) {
  return JSON.parse(fs.readFileSync(path.resolve(rel), "utf8"));
}

const tokenArt = loadArtifact("artifacts/contracts/EquityTokenV2.sol/EquityTokenV2.json");
const freezeArt = loadArtifact(
  "artifacts/contracts/policies/EmergencyFreezePolicyV2.sol/EmergencyFreezePolicyV2.json"
);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

async function readFrozen() {
  try {
    return await publicClient.readContract({
      address: FREEZE_POLICY,
      abi: freezeArt.abi,
      functionName: "frozen",
    });
  } catch {
    return null;
  }
}

async function tryTransfer(label) {
  console.log(`\n-- ${label}: transfer amount=3 (admin -> beneficiary) --`);
  try {
    const hash = await walletClient.writeContract({
      address: TOKEN,
      abi: tokenArt.abi,
      functionName: "transfer",
      args: [BENEFICIARY, 3n],
    });
    console.log("tx:", hash);
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("✅ transfer success block:", rcpt.blockNumber);
    return true;
  } catch (e) {
    console.log("❌ transfer failed (expected when frozen).");
    console.log(String(e.shortMessage || e.message || e));
    return false;
  }
}

async function main() {
  console.log("\n== Prove Emergency Freeze V1 (E2E) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("token:", TOKEN);
  console.log("freezePolicy:", FREEZE_POLICY);
  console.log("beneficiary:", BENEFICIARY);

  const preFrozen = await readFrozen();
  console.log("pre frozen?:", preFrozen);

  // 1) pre-freeze transfer should succeed (assuming beneficiary verified + min amount satisfied)
  if (!(await tryTransfer("pre-freeze"))) throw new Error("Expected pre-freeze transfer to succeed, but it failed.");

  // 2) freeze
  console.log("\n-- activate freeze --");
  {
    const hash = await walletClient.writeContract({
      address: FREEZE_POLICY,
      abi: freezeArt.abi,
      functionName: "emergencyFreeze",
      args: ["break-glass test freeze"],
    });
    console.log("tx:", hash);
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("✅ freeze confirmed block:", rcpt.blockNumber);
  }

  const midFrozen = await readFrozen();
  console.log("mid frozen?:", midFrozen);

  // 3) transfer should fail while frozen
  const okWhileFrozen = await tryTransfer("while-frozen");
  if (okWhileFrozen) throw new Error("Freeze failed: transfer succeeded while frozen");

  // 4) unfreeze
  console.log("\n-- release freeze --");
  {
    const hash = await walletClient.writeContract({
      address: FREEZE_POLICY,
      abi: freezeArt.abi,
      functionName: "emergencyUnfreeze",
      args: ["break-glass test unfreeze"],
    });
    console.log("tx:", hash);
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("✅ unfreeze confirmed block:", rcpt.blockNumber);
  }

  const postFrozen = await readFrozen();
  console.log("post frozen?:", postFrozen);

  // 5) transfer should succeed again
  if (!(await tryTransfer("post-unfreeze"))) throw new Error("Expected post-unfreeze transfer to succeed, but it failed.");

  console.log("\n✅ Emergency freeze proven end-to-end.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
