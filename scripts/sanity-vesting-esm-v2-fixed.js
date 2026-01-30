// scripts/sanity-vesting-esm-v2-fixed.js
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadArtifact(relPath) {
  const p = path.resolve(relPath);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function robustRead(readFn, { label = "read", tries = 30, delayMs = 1200 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await readFn();
    } catch (e) {
      lastErr = e;
      await sleep(delayMs);
    }
  }
  throw new Error(
    `[robustRead] Failed after ${tries} tries (${label}): ${lastErr?.message ?? lastErr}`
  );
}

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  // Required env vars
  let pk = mustGetEnv("PRIVATE_KEY");
  if (!pk.startsWith("0x")) pk = `0x${pk}`;

  const beneficiary = mustGetEnv("BENEFICIARY");
  const recipient = mustGetEnv("RECIPIENT"); // kept for consistency with your env flow
  const vestAmount = BigInt(mustGetEnv("VEST_AMOUNT"));

  // Deployed addresses (from your logs)
  const registryAddr = "0x9d6831ccb9d6f971cb648b538448d175650cfea4";
  const tokenAddr = "0x2791d08fc94c787e5772daba3507a68e74ba4b10";
  const vestingAddr = "0xd59d171dc3c7c4c220672c077e3738003e17f960";

  // Load ABIs
  const registryJson = loadArtifact("artifacts/contracts/IdentityRegistry.sol/IdentityRegistry.json");
  const tokenJson = loadArtifact("artifacts/contracts/EquityToken.sol/EquityToken.json");
  const vestingJson = loadArtifact("artifacts/contracts/VestingContract.sol/VestingContract.json");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  // ✅ Correct: PRIVATE_KEY -> viem account
  const account = privateKeyToAccount(pk);

  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
    account,
  });

  const admin = account.address;

  console.log("\n== Sanity Vesting Test (V2 FIXED: ESM, viem, deterministic) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("chainId:", baseSepolia.id);
  console.log("admin:", admin);
  console.log("beneficiary:", beneficiary);
  console.log("recipient:", recipient);
  console.log("registry:", registryAddr);
  console.log("token:", tokenAddr);
  console.log("vesting:", vestingAddr);
  console.log("\nVesting amount (raw):", vestAmount.toString(), "(decimals assumed 0)");

  const registry = getContract({
    address: registryAddr,
    abi: registryJson.abi,
    client: { public: publicClient, wallet: walletClient },
  });

  const token = getContract({
    address: tokenAddr,
    abi: tokenJson.abi,
    client: { public: publicClient, wallet: walletClient },
  });

  const vesting = getContract({
    address: vestingAddr,
    abi: vestingJson.abi,
    client: { public: publicClient, wallet: walletClient },
  });

  // --- Verification checks ---
  const beneficiaryVerified = await robustRead(
    () => registry.read.isVerified([beneficiary]),
    { label: "registry.isVerified(beneficiary)" }
  );
  const recipientVerified = await robustRead(
    () => registry.read.isVerified([recipient]),
    { label: "registry.isVerified(recipient)" }
  );
  const vestingVerified = await robustRead(
    () => registry.read.isVerified([vestingAddr]),
    { label: "registry.isVerified(vesting)" }
  );

  console.log("\nVerification:");
  console.log("  beneficiary verified:", beneficiaryVerified);
  console.log("  recipient verified   :", recipientVerified);
  console.log("  vesting verified     :", vestingVerified);

  if (!beneficiaryVerified) throw new Error("Beneficiary is not verified in IdentityRegistry.");
  if (!recipientVerified) throw new Error("Recipient is not verified in IdentityRegistry.");
  if (!vestingVerified) throw new Error("Vesting contract is not verified in IdentityRegistry.");

  // --- Balances before ---
  const balBenefBefore = await robustRead(
    () => token.read.balanceOf([beneficiary]),
    { label: "token.balanceOf(beneficiary) before" }
  );
  const balVestBefore = await robustRead(
    () => token.read.balanceOf([vestingAddr]),
    { label: "token.balanceOf(vesting) before" }
  );

  console.log("\nBalances before (raw):");
  console.log("  beneficiary:", balBenefBefore.toString());
  console.log("  vesting    :", balVestBefore.toString());

  // --- Fund vesting if needed (top-up only) ---
  if (balVestBefore < vestAmount) {
    const topUp = vestAmount - balVestBefore;
    console.log(`\nFunding vesting contract (top-up ${topUp.toString()}): token.mint(vesting, topUp) ...`);
    const mintHash = await token.write.mint([vestingAddr, topUp]);
    console.log("mint tx:", mintHash);
    const mintRcpt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
    console.log("✅ mint mined:", mintRcpt.blockNumber.toString());
  } else {
    console.log("\nVesting contract already funded (no mint needed).");
  }

  // --- Create grant (correct function for your ABI) ---
  console.log("\nGrant/create function: createGrant(address,uint256,uint64,uint64,uint64)");

  const now = BigInt(Math.floor(Date.now() / 1000));
  const start = now; // start immediately
  const cliff = now; // no cliff (timestamp)
  const duration = 60n; // 60 seconds so you can finish quickly

  console.log("Creating grant:");
  console.log("  beneficiary:", beneficiary);
  console.log("  amount     :", vestAmount.toString());
  console.log("  start      :", start.toString());
  console.log("  cliff      :", cliff.toString());
  console.log("  duration   :", duration.toString(), "seconds");

  const grantHash = await vesting.write.createGrant([beneficiary, vestAmount, start, cliff, duration]);
  console.log("createGrant tx:", grantHash);
  const grantRcpt = await publicClient.waitForTransactionReceipt({ hash: grantHash });
  console.log("✅ createGrant mined:", grantRcpt.blockNumber.toString());

  const grant = await robustRead(() => vesting.read.grants([beneficiary]), {
    label: "vesting.grants(beneficiary)",
  });
  const vestedNow = await robustRead(() => vesting.read.vestedAmount([beneficiary]), {
    label: "vesting.vestedAmount(beneficiary) immediate",
  });

  console.log("\nGrant (raw grants[beneficiary]):", grant);
  console.log("Vested now:", vestedNow.toString());

  // --- Release immediately (expected 0 vested or revert) ---
  console.log("\nRelease test #1 (immediate): release(beneficiary) ...");
  try {
    const rel1 = await vesting.write.release([beneficiary]);
    console.log("release tx:", rel1);
    const rel1Rcpt = await publicClient.waitForTransactionReceipt({ hash: rel1 });
    console.log("✅ release mined:", rel1Rcpt.blockNumber.toString());
  } catch (e) {
    console.log("↳ expected failure or 0 release:", e?.shortMessage ?? e?.message ?? e);
  }

  console.log(`\nWaiting ~70 seconds so vesting completes (duration=${duration.toString()}s)...`);
  await sleep(70_000);

  const vestedLater = await robustRead(() => vesting.read.vestedAmount([beneficiary]), {
    label: "vesting.vestedAmount(beneficiary) after wait",
  });
  console.log("Vested after wait:", vestedLater.toString());

  console.log("\nRelease test #2 (after vest): release(beneficiary) ...");
  const rel2 = await vesting.write.release([beneficiary]);
  console.log("release tx:", rel2);
  const rel2Rcpt = await publicClient.waitForTransactionReceipt({ hash: rel2 });
  console.log("✅ release mined:", rel2Rcpt.blockNumber.toString());

  const balBenefAfter = await robustRead(() => token.read.balanceOf([beneficiary]), {
    label: "token.balanceOf(beneficiary) after release",
  });
  const balVestAfter = await robustRead(() => token.read.balanceOf([vestingAddr]), {
    label: "token.balanceOf(vesting) after release",
  });

  console.log("\nBalances after release (raw):");
  console.log("  beneficiary:", balBenefAfter.toString());
  console.log("  vesting    :", balVestAfter.toString());

  console.log("\n✅ Done: createGrant + release flow executed.");
}

main().catch((e) => {
  console.error("\n❌ Script failed:", e?.stack ?? e);
  process.exit(1);
});
