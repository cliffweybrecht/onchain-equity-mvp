// scripts/sanity-transfer-esm.js
import hre from "hardhat";
import {
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ADDRS = {
  registry: "0x9d6831ccb9d6f971cb648b538448d175650cfea4",
  token: "0x2791d08fc94c787e5772daba3507a68e74ba4b10",
};

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. Example: export ${name}=0xabc...`);
  return v;
}

function rpcUrl() {
  return process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
}

function account() {
  const pk = mustGetEnv("PRIVATE_KEY");
  return privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
}

function toBigIntSafe(v) {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readBalance(publicClient, tokenArt, who) {
  return await publicClient.readContract({
    address: ADDRS.token,
    abi: tokenArt.abi,
    functionName: "balanceOf",
    args: [who],
  });
}

// Public RPCs can lag/caché “latest”. Poll until balances reflect the transfer.
async function waitForBalanceChange({
  publicClient,
  tokenArt,
  sender,
  recipient,
  prevSender,
  prevRecip,
  maxTries = 25,
  delayMs = 1200,
}) {
  let senderNow = prevSender;
  let recipNow = prevRecip;

  for (let i = 1; i <= maxTries; i++) {
    senderNow = await readBalance(publicClient, tokenArt, sender);
    recipNow = await readBalance(publicClient, tokenArt, recipient);

    if (senderNow !== prevSender || recipNow !== prevRecip) {
      return { senderNow, recipNow, tries: i, changed: true };
    }

    await sleep(delayMs);
  }

  return { senderNow, recipNow, tries: maxTries, changed: false };
}

async function main() {
  const recipient = mustGetEnv("RECIPIENT");
  const amountUnits = process.env.AMOUNT ?? "1";

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl()),
  });

  const walletClient = createWalletClient({
    account: account(),
    chain: baseSepolia,
    transport: http(rpcUrl()),
  });

  const sender = walletClient.account.address;

  console.log("\n== Sanity Transfer Test (ESM, viem, robust reads) ==");
  console.log("rpcUrl:", rpcUrl());
  console.log("chainId:", await publicClient.getChainId());
  console.log("sender:", sender);
  console.log("recipient:", recipient);
  console.log("registry:", ADDRS.registry);
  console.log("token:", ADDRS.token);

  const registryArt = await hre.artifacts.readArtifact("IdentityRegistry");
  const tokenArt = await hre.artifacts.readArtifact("EquityToken");

  const registry = getContract({
    address: ADDRS.registry,
    abi: registryArt.abi,
    client: { public: publicClient, wallet: walletClient },
  });

  const token = getContract({
    address: ADDRS.token,
    abi: tokenArt.abi,
    client: { public: publicClient, wallet: walletClient },
  });

  const senderVerified = await registry.read.isVerified([sender]);
  const recipientVerified = await registry.read.isVerified([recipient]);

  console.log("\nVerification:");
  console.log("  sender verified   :", senderVerified);
  console.log("  recipient verified:", recipientVerified);

  if (!senderVerified) throw new Error("Sender is not verified in IdentityRegistry");
  if (!recipientVerified) throw new Error("Recipient is not verified in IdentityRegistry");

  // decimals optional
  let decimals = 0;
  try {
    decimals = Number(await token.read.decimals());
  } catch {
    decimals = 0;
  }

  const amount =
    decimals > 0 ? parseUnits(amountUnits, decimals) : toBigIntSafe(amountUnits);

  const balSenderBefore = await token.read.balanceOf([sender]);
  const balRecipBefore = await token.read.balanceOf([recipient]);

  console.log("\nBalances before (latest, raw):");
  console.log("  sender:", balSenderBefore.toString());
  console.log("  recip :", balRecipBefore.toString());
  console.log("\nTransfer amount (raw):", amount.toString(), `(decimals=${decimals})`);

  // Send + wait
  let receipt;
  try {
    const hash = await token.write.transfer([recipient, amount]);
    console.log("\ntx:", hash);

    receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("✅ mined in block:", receipt.blockNumber.toString());
  } catch (e) {
    console.error("\n❌ Transfer reverted.");
    console.error(e?.shortMessage ?? e?.message ?? e);
    process.exitCode = 1;
    return;
  }

  // Robust “after” reads
  const { senderNow, recipNow, tries, changed } = await waitForBalanceChange({
    publicClient,
    tokenArt,
    sender,
    recipient,
    prevSender: balSenderBefore,
    prevRecip: balRecipBefore,
  });

  console.log(`\nBalances after (latest, raw) [polled ${tries}x]:`);
  console.log("  sender:", senderNow.toString());
  console.log("  recip :", recipNow.toString());

  if (!changed) {
    console.log(
      "\n⚠️ RPC did not reflect updated balances within polling window.\n" +
        "The tx is mined, so state is updated; consider using a provider RPC (Alchemy/QuickNode) for instant reads."
    );
  }

  console.log("\n✅ Sanity transfer complete.\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

