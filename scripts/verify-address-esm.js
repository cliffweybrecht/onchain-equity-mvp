import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const registry = process.env.REGISTRY || "0x9d6831ccb9d6f971cb648b538448d175650cfea4";
const target = process.env.TARGET;
const pk = process.env.PRIVATE_KEY;

if (!target) throw new Error("Set TARGET=0x...");
if (!pk) throw new Error("Set PRIVATE_KEY");

const account = privateKeyToAccount(pk);
const pc = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const wc = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

const abi = parseAbi([
  "function setStatus(address user, uint8 status)",
  "function getStatus(address user) view returns (uint8)",
  "function isVerified(address user) view returns (bool)",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function read(tagOrBlock) {
  const opts =
    typeof tagOrBlock === "bigint" ? { blockNumber: tagOrBlock } : { blockTag: tagOrBlock };
  const [s, v] = await Promise.all([
    pc.readContract({ address: registry, abi, functionName: "getStatus", args: [target], ...opts }),
    pc.readContract({ address: registry, abi, functionName: "isVerified", args: [target], ...opts }),
  ]);
  return { s, v };
}

console.log("RPC:", rpcUrl);
console.log("Registry:", registry);
console.log("Signer:", account.address);
console.log("Target:", target);

const pre = await read("latest");
console.log("\n-- Pre-check --");
console.log("getStatus (before):", Number(pre.s));
console.log("isVerified (before):", pre.v);

console.log("\n-- Simulate setStatus(target, 1) --");
await pc.simulateContract({
  address: registry,
  abi,
  functionName: "setStatus",
  args: [target, 1],
  account,
});
console.log("✅ Simulation passed (call is allowed).");

console.log("\n-- Sending tx --");
const hash = await wc.writeContract({
  address: registry,
  abi,
  functionName: "setStatus",
  args: [target, 1],
});
const receipt = await pc.waitForTransactionReceipt({ hash });
console.log("tx:", receipt.transactionHash);
console.log("receipt.status:", receipt.status);
console.log("receipt.block:", receipt.blockNumber.toString());

// Read at tx block (retry if block not found)
let at;
for (let i = 0; i < 8; i++) {
  try {
    at = await read(receipt.blockNumber);
    break;
  } catch (e) {
    const msg = String(e?.shortMessage || e?.message || e);
    if (msg.includes("block not found") || msg.includes("Requested resource not found")) {
      await sleep(1500);
      continue;
    }
    throw e;
  }
}

console.log("\n-- Post-check (at tx block) --");
console.log("getStatus (at block):", at ? Number(at.s) : "N/A");
console.log("isVerified (at block):", at ? at.v : "N/A");

// Also check latest with a short retry loop
for (let i = 0; i < 10; i++) {
  const latest = await read("latest");
  console.log(`latest try ${i + 1}: status=${Number(latest.s)} verified=${latest.v}`);
  if (Number(latest.s) === 1 && latest.v === true) break;
  await sleep(1200);
}

console.log("\n✅ Done.");
