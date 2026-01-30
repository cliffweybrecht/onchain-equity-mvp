import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;

const COMPOSITE = process.env.COMPOSITE || "0x2f84c9918ec2602efa68000eae8b1fbe550311dc";
const TOKEN = process.env.TOKEN || "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17";

const ADMIN = process.env.ADMIN || "0x6C775411e11cAb752Af03C5BBb440618788E13Be";
const VERIFIED =
  process.env.VERIFIED_BENEFICIARY || "0x8B24E58442c0ECc9Ac11A22beb89C8eE53ED4544";

// Used when we re-add after removal:
const MIN_POLICY =
  process.env.MIN_POLICY || "0x2626c09ef40176300a0bcf1ddb56cf4a3d530485";

if (!pk) throw new Error("Missing PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const abi = parseAbi([
  // stack views
  "function getPolicies() view returns (address[])",

  // admin ops
  "function movePolicy(uint256 fromIndex,uint256 toIndex)",
  "function removePolicy(uint256 index)",
  "function addPolicy(address policy)",

  // explainable checks
  "function canTransfer(address token,address from,address to,uint256 amount) view returns (bool)",
  "function canTransferTrace(address token,address from,address to,uint256 amount) view returns (bool,uint256,address)",
]);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForBlockHeader(blockNumber) {
  // Base Sepolia RPC can briefly fail historical eth_call on a just-mined block ("header not found").
  // Wait until the node can serve the block header, then receipt-block reads will be stable.
  while (true) {
    try {
      await publicClient.getBlock({ blockNumber });
      return;
    } catch (_) {
      await sleep(750);
    }
  }
}

async function readPoliciesAt(label, blockNumber) {
  const policies = await publicClient.readContract({
    address: COMPOSITE,
    abi,
    functionName: "getPolicies",
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  });
  console.log(`\n${label}`);
  console.log("policy stack:", policies);
  return policies;
}

async function traceCheckAt(label, amount, blockNumber) {
  const ok = await publicClient.readContract({
    address: COMPOSITE,
    abi,
    functionName: "canTransfer",
    args: [TOKEN, ADMIN, VERIFIED, amount],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  });

  const trace = await publicClient.readContract({
    address: COMPOSITE,
    abi,
    functionName: "canTransferTrace",
    args: [TOKEN, ADMIN, VERIFIED, amount],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  });

  console.log(`\n${label}`);
  console.log(`amount=${amount} -> canTransfer:`, ok);
  console.log(`amount=${amount} -> trace:`, trace);

  return { ok, trace };
}

async function sendTx(fnName, args, label) {
  console.log(`\n== ${label} ==`);
  console.log("calling:", fnName, args);

  const hash = await walletClient.writeContract({
    address: COMPOSITE,
    abi,
    functionName: fnName,
    args,
  });

  console.log("tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status);
  console.log("blockNumber:", receipt.blockNumber.toString());

  if (receipt.status !== "success") {
    throw new Error(`${label} failed: ${hash}`);
  }

  // Critical: avoid "header not found" on immediate receipt-block reads
  await waitForBlockHeader(receipt.blockNumber);

  return { hash, receipt };
}

async function main() {
  console.log("\n== Composite Reorder/Remove Proof (Part 3.7C, receipt-accurate) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("composite:", COMPOSITE);
  console.log("token:", TOKEN);
  console.log("verified beneficiary:", VERIFIED);
  console.log("min policy:", MIN_POLICY);

  // Baseline (latest)
  await readPoliciesAt("Baseline stack @latest", undefined);
  await traceCheckAt("Baseline trace @latest (amount=1)", 1n, undefined);

  // ---- Move 1 -> 0 ----
  {
    const { receipt } = await sendTx("movePolicy", [1n, 0n], "Move policy 1 -> 0");
    await readPoliciesAt("Stack @tx block after move 1->0", receipt.blockNumber);
    await traceCheckAt("Trace @tx block after move 1->0 (amount=1)", 1n, receipt.blockNumber);
  }

  // ---- Move 0 -> 1 (restore) ----
  {
    const { receipt } = await sendTx(
      "movePolicy",
      [0n, 1n],
      "Move policy 0 -> 1 (restore order)"
    );
    await readPoliciesAt("Stack @tx block after restore", receipt.blockNumber);
    await traceCheckAt("Trace @tx block after restore (amount=1)", 1n, receipt.blockNumber);
  }

  // ---- Remove index 1 ----
  {
    const { receipt } = await sendTx("removePolicy", [1n], "Remove policy at index 1");
    await readPoliciesAt("Stack @tx block after removal", receipt.blockNumber);
    await traceCheckAt("Trace @tx block after removal (amount=1)", 1n, receipt.blockNumber);
  }

  // ---- Re-add MinAmountPolicyV1 ----
  {
    const { receipt } = await sendTx("addPolicy", [MIN_POLICY], "Re-add MinAmountPolicyV1 (append)");
    await readPoliciesAt("Stack @tx block after re-add", receipt.blockNumber);
    await traceCheckAt("Trace @tx block after re-add (amount=1)", 1n, receipt.blockNumber);
  }

  // Final latest snapshot
  await readPoliciesAt("Final stack @latest", undefined);
  await traceCheckAt("Final trace @latest (amount=1)", 1n, undefined);

  console.log("\n✅ Part 3.7C proof complete (receipt-accurate + header-safe).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
