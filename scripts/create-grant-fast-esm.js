import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
const vesting = process.env.VESTING;
const beneficiary = process.env.BENEFICIARY;

const total = BigInt(process.env.GRANT_TOTAL || "100");
const startDelay = BigInt(process.env.START_DELAY || "5");   // seconds from now
const cliffSecs = BigInt(process.env.GRANT_CLIFF || "10");    // seconds after start
const durationSecs = BigInt(process.env.GRANT_DURATION || "20"); // seconds (total duration)

if (!pk || !vesting || !beneficiary) throw new Error("Need PRIVATE_KEY, VESTING, BENEFICIARY");

const account = privateKeyToAccount(pk);
const pc = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const wc = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

const abi = parseAbi([
  "function createGrant(address employee, uint256 total, uint64 start, uint64 cliff, uint64 duration)",
  "function grants(address) view returns (uint256 total,uint256 released,uint64 start,uint64 cliff,uint64 duration,bool exists)"
]);

const block = await pc.getBlock({ blockTag: "latest" });
const now = BigInt(block.timestamp);
const start = now + startDelay;
const cliff = start + cliffSecs;

console.log("now:", now.toString(), new Date(Number(now)*1000).toISOString());
console.log("start:", start.toString(), new Date(Number(start)*1000).toISOString());
console.log("cliff:", cliff.toString(), new Date(Number(cliff)*1000).toISOString());
console.log("duration secs:", durationSecs.toString());
console.log("beneficiary:", beneficiary);
console.log("total:", total.toString());

const sim = await pc.simulateContract({
  address: vesting,
  abi,
  functionName: "createGrant",
  args: [beneficiary, total, start, cliff, durationSecs],
  account,
});

const hash = await wc.writeContract(sim.request);
const receipt = await pc.waitForTransactionReceipt({ hash });

console.log("createGrant tx:", receipt.transactionHash, "status:", receipt.status);

const g = await pc.readContract({
  address: vesting,
  abi,
  functionName: "grants",
  args: [beneficiary],
});
console.log("stored grant:", g);
