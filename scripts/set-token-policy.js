import "dotenv/config";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY");

  const TOKEN = process.env.TOKEN;
  const NEW_POLICY = process.env.NEW_POLICY;

  if (!TOKEN) throw new Error("Set TOKEN");
  if (!NEW_POLICY) throw new Error("Set NEW_POLICY");

  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
    account,
  });

  const abi = parseAbi([
    "function transferPolicy() view returns (address)",
    "function setTransferPolicy(address policy)",
    "event TransferPolicyUpdated(address indexed oldPolicy, address indexed newPolicy)",
  ]);

  const oldPolicy = await publicClient.readContract({
    address: TOKEN,
    abi,
    functionName: "transferPolicy",
  });

  console.log("== Set EquityTokenV2.transferPolicy ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("token:", TOKEN);
  console.log("oldPolicy:", oldPolicy);
  console.log("newPolicy:", NEW_POLICY);
  console.log("admin/caller:", account.address);

  const hash = await walletClient.writeContract({
    address: TOKEN,
    abi,
    functionName: "setTransferPolicy",
    args: [NEW_POLICY],
  });

  console.log("tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("mined in block:", receipt.blockNumber);
  console.log("tx status:", receipt.status);

  if (receipt.status !== "success") {
    throw new Error("setTransferPolicy transaction reverted (policy NOT updated)");
  }

  // Decode TransferPolicyUpdated if present
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "TransferPolicyUpdated") {
        console.log("event TransferPolicyUpdated:", decoded.args);
      }
    } catch {
      // ignore unrelated logs
    }
  }

  // Read at the mined block (authoritative) and at latest (human sanity check)
  const updatedAtBlock = await publicClient.readContract({
    address: TOKEN,
    abi,
    functionName: "transferPolicy",
    blockNumber: receipt.blockNumber,
  });

  const updatedLatest = await publicClient.readContract({
    address: TOKEN,
    abi,
    functionName: "transferPolicy",
  });

  console.log("updatedPolicy @ minedBlock:", updatedAtBlock);
  console.log("updatedPolicy @ latest   :", updatedLatest);

  if (updatedAtBlock.toLowerCase() !== NEW_POLICY.toLowerCase()) {
    throw new Error(
      `Policy mismatch: expected ${NEW_POLICY} but got ${updatedAtBlock} at mined block`
    );
  }

  console.log("✅ transferPolicy updated and verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
