import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
const token = process.env.TOKEN;
const vesting = process.env.VESTING;
const amount = BigInt(process.env.MINT_AMOUNT || "100");

if (!pk || !token || !vesting) throw new Error("Need PRIVATE_KEY, TOKEN, VESTING");

const account = privateKeyToAccount(pk);
const pc = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const wc = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

const abi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function mint(address,uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function readLatest() {
  const [adminBal, vestBal, supply] = await Promise.all([
    pc.readContract({ address: token, abi, functionName: "balanceOf", args: [account.address] }),
    pc.readContract({ address: token, abi, functionName: "balanceOf", args: [vesting] }),
    pc.readContract({ address: token, abi, functionName: "totalSupply", args: [] }),
  ]);
  return { adminBal, vestBal, supply };
}

async function readAtBlockWithRetry(blockNumber, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const [adminBal, vestBal, supply] = await Promise.all([
        pc.readContract({ address: token, abi, functionName: "balanceOf", args: [account.address], blockNumber }),
        pc.readContract({ address: token, abi, functionName: "balanceOf", args: [vesting], blockNumber }),
        pc.readContract({ address: token, abi, functionName: "totalSupply", args: [], blockNumber }),
      ]);
      return { adminBal, vestBal, supply, ok: true, attempt: i + 1 };
    } catch (e) {
      const msg = String(e?.shortMessage || e?.message || e);
      // load-balanced node behind: block not found
      if (msg.includes("block not found") || msg.includes("Requested resource not found")) {
        await sleep(1500);
        continue;
      }
      throw e;
    }
  }
  return { ok: false };
}

console.log("RPC:", rpcUrl);
console.log("Minting to vesting:", vesting, "amount:", amount.toString());
console.log("Admin:", account.address);

const before = await readLatest();
console.log(
  "Before (latest): admin",
  before.adminBal.toString(),
  "vesting",
  before.vestBal.toString(),
  "supply",
  before.supply.toString()
);

const hash = await wc.writeContract({
  address: token,
  abi,
  functionName: "mint",
  args: [vesting, amount],
});

const receipt = await pc.waitForTransactionReceipt({ hash });
console.log("tx:", receipt.transactionHash, "status:", receipt.status, "block:", receipt.blockNumber.toString());

// Try to read at the tx block (may fail on public RPC); fallback to latest.
const at = await readAtBlockWithRetry(receipt.blockNumber);
if (at.ok) {
  console.log(
    `After (at tx block, try ${at.attempt}): admin`,
    at.adminBal.toString(),
    "vesting",
    at.vestBal.toString(),
    "supply",
    at.supply.toString()
  );
} else {
  console.log("⚠️ Could not read at tx block due to RPC lag; falling back to latest.");
}

const after = await readLatest();
console.log(
  "After (latest): admin",
  after.adminBal.toString(),
  "vesting",
  after.vestBal.toString(),
  "supply",
  after.supply.toString()
);

console.log("\nReceipt logs (raw):");
console.log(receipt.logs);
