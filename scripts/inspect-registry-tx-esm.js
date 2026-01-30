// scripts/inspect-registry-tx-esm.js
import hre from "hardhat";
import { createPublicClient, http, decodeEventLog } from "viem";
import { baseSepolia } from "viem/chains";

const REGISTRY = "0x9d6831ccb9d6f971cb648b538448d175650cfea4";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function rpcUrl() {
  return process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
}

async function safeRead(publicClient, abi, fn, args) {
  try {
    const v = await publicClient.readContract({
      address: REGISTRY,
      abi,
      functionName: fn,
      args,
    });
    return v;
  } catch (e) {
    return `READ_FAIL: ${e?.shortMessage ?? e?.message ?? e}`;
  }
}

async function main() {
  const txHash = mustGetEnv("TX");
  const target = mustGetEnv("TARGET");
  const admin = mustGetEnv("ADMIN");

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl()),
  });

  const registryArt = await hre.artifacts.readArtifact("IdentityRegistry");
  const abi = registryArt.abi;

  console.log("\n== Inspect Registry Tx ==");
  console.log("rpcUrl:", rpcUrl());
  console.log("chainId:", await publicClient.getChainId());
  console.log("registry:", REGISTRY);
  console.log("tx:", txHash);
  console.log("admin:", admin);
  console.log("target:", target);

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  console.log("\nreceipt.status:", receipt.status);
  console.log("logs:", receipt.logs.length);

  console.log("\nDecoded logs (only ones matching IdentityRegistry ABI):");
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });
      console.log(`- ${decoded.eventName}`, decoded.args);
    } catch {
      // ignore logs that aren't in ABI
    }
  }

  console.log("\nCurrent reads:");
  const adminStatus = await safeRead(publicClient, abi, "getStatus", [admin]);
  const targetStatus = await safeRead(publicClient, abi, "getStatus", [target]);
  const adminVerified = await safeRead(publicClient, abi, "isVerified", [admin]);
  const targetVerified = await safeRead(publicClient, abi, "isVerified", [target]);

  console.log("admin getStatus:", adminStatus?.toString?.() ?? adminStatus);
  console.log("target getStatus:", targetStatus?.toString?.() ?? targetStatus);
  console.log("admin isVerified:", adminVerified);
  console.log("target isVerified:", targetVerified);

  console.log("\nIf admin changed but target didn't, setStatus is likely ignoring the target param (uses msg.sender).");
  console.log("If neither changed, getStatus/isVerified may be based on a different registry key (identity ID).");
  console.log("If logs show a different status value, Verified may not be '1'.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
