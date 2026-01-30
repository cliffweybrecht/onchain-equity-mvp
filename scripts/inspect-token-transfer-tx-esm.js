// scripts/inspect-token-transfer-tx-esm.js
import hre from "hardhat";
import { createPublicClient, http, decodeEventLog } from "viem";
import { baseSepolia } from "viem/chains";

const TOKEN = "0x2791d08fc94c787e5772daba3507a68e74ba4b10";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function rpcUrl() {
  return process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
}

async function safeBalanceAt(publicClient, abi, who, blockNumber) {
  try {
    return await publicClient.readContract({
      address: TOKEN,
      abi,
      functionName: "balanceOf",
      args: [who],
      blockNumber,
    });
  } catch (e) {
    return `READ_FAIL: ${e?.shortMessage ?? e?.message ?? e}`;
  }
}

async function main() {
  const txHash = mustGetEnv("TX");
  const sender = mustGetEnv("SENDER");
  const recipient = mustGetEnv("RECIPIENT");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl()),
  });

  const tokenArt = await hre.artifacts.readArtifact("EquityToken");
  const abi = tokenArt.abi;

  console.log("\n== Inspect Token Transfer Tx ==");
  console.log("rpcUrl:", rpcUrl());
  console.log("chainId:", await publicClient.getChainId());
  console.log("token:", TOKEN);
  console.log("tx:", txHash);
  console.log("sender:", sender);
  console.log("recipient:", recipient);

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  console.log("\nreceipt.status:", receipt.status);
  console.log("blockNumber:", receipt.blockNumber.toString());
  console.log("logs:", receipt.logs.length);

  // Decode any events that match the token ABI (especially Transfer)
  console.log("\nDecoded logs (token ABI matches only):");
  let sawTransfer = false;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== TOKEN.toLowerCase()) continue;

    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });

      console.log(`- ${decoded.eventName}`, decoded.args);

      if (decoded.eventName === "Transfer") {
        sawTransfer = true;
      }
    } catch {
      // ignore logs not in ABI
    }
  }

  console.log("\nSaw Transfer event:", sawTransfer);

  // Read balances at the block where tx was mined, and "latest"
  const bn = receipt.blockNumber;

  const senderAt = await safeBalanceAt(publicClient, abi, sender, bn);
  const recipAt = await safeBalanceAt(publicClient, abi, recipient, bn);

  const senderLatest = await publicClient.readContract({
    address: TOKEN,
    abi,
    functionName: "balanceOf",
    args: [sender],
  });
  const recipLatest = await publicClient.readContract({
    address: TOKEN,
    abi,
    functionName: "balanceOf",
    args: [recipient],
  });

  console.log("\nBalances at receipt block:");
  console.log("  sender:", senderAt?.toString?.() ?? senderAt);
  console.log("  recip :", recipAt?.toString?.() ?? recipAt);

  console.log("\nBalances latest:");
  console.log("  sender:", senderLatest.toString());
  console.log("  recip :", recipLatest.toString());

  console.log("\nIf there is NO Transfer event, your token transfer function is not ERC20-standard or is short-circuiting.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
