import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
const token = process.env.TOKEN;
const amount = BigInt(process.env.MINT_AMOUNT || "1");

if (!pk || !token) throw new Error("Need PRIVATE_KEY, TOKEN");

const account = privateKeyToAccount(pk);
const pc = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const wc = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

const abi = parseAbi([
  "function mint(address,uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

console.log("RPC:", rpcUrl);
console.log("Token:", token);
console.log("Admin:", account.address);
console.log("Mint amount:", amount.toString());

const before = await pc.readContract({
  address: token,
  abi,
  functionName: "balanceOf",
  args: [account.address],
});
console.log("Admin balance before:", before.toString());

const sim = await pc.simulateContract({
  address: token,
  abi,
  functionName: "mint",
  args: [account.address, amount],
  account,
});

const hash = await wc.writeContract(sim.request);
const receipt = await pc.waitForTransactionReceipt({ hash });
console.log("tx:", receipt.transactionHash, "status:", receipt.status);

const after = await pc.readContract({
  address: token,
  abi,
  functionName: "balanceOf",
  args: [account.address],
});
console.log("Admin balance after:", after.toString());
