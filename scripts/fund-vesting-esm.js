import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
const token = process.env.TOKEN;
const vesting = process.env.VESTING;
const amount = BigInt(process.env.FUND_AMOUNT || "1");

if (!pk || !token || !vesting) throw new Error("Need PRIVATE_KEY, TOKEN, VESTING");

const account = privateKeyToAccount(pk);
const pc = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const wc = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

const abi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

console.log("Funding vesting:", vesting, "amount:", amount.toString());
console.log("Sender (admin):", account.address);

const [adminBefore, vestingBefore] = await Promise.all([
  pc.readContract({ address: token, abi, functionName: "balanceOf", args: [account.address] }),
  pc.readContract({ address: token, abi, functionName: "balanceOf", args: [vesting] }),
]);

console.log("Admin balance before:", adminBefore.toString());
console.log("Vesting balance before:", vestingBefore.toString());

const hash = await wc.writeContract({
  address: token,
  abi,
  functionName: "transfer",
  args: [vesting, amount],
});

const receipt = await pc.waitForTransactionReceipt({ hash });
console.log("tx:", receipt.transactionHash, "status:", receipt.status);

const [adminAfter, vestingAfter] = await Promise.all([
  pc.readContract({ address: token, abi, functionName: "balanceOf", args: [account.address] }),
  pc.readContract({ address: token, abi, functionName: "balanceOf", args: [vesting] }),
]);

console.log("Admin balance after:", adminAfter.toString());
console.log("Vesting balance after:", vestingAfter.toString());

console.log("\nReceipt logs (raw):");
console.log(receipt.logs);
