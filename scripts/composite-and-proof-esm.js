import "dotenv/config";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const COMPOSITE = process.env.COMPOSITE || "0x2f84c9918ec2602efa68000eae8b1fbe550311dc";
const TOKEN = process.env.TOKEN || "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17";

const ADMIN = process.env.ADMIN || "0x6C775411e11cAb752Af03C5BBb440618788E13Be";
const VERIFIED = process.env.VERIFIED_BENEFICIARY || "0x8B24E58442c0ECc9Ac11A22beb89C8eE53ED4544";

const abi = parseAbi([
  "function getPolicies() view returns (address[])",
  "function canTransfer(address token,address from,address to,uint256 amount) view returns (bool)",
  "function canTransferTrace(address token,address from,address to,uint256 amount) view returns (bool,uint256,address)",
]);

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

async function check(amount) {
  const ok = await client.readContract({
    address: COMPOSITE,
    abi,
    functionName: "canTransfer",
    args: [TOKEN, ADMIN, VERIFIED, amount],
  });

  const trace = await client.readContract({
    address: COMPOSITE,
    abi,
    functionName: "canTransferTrace",
    args: [TOKEN, ADMIN, VERIFIED, amount],
  });

  console.log(`\namount=${amount} -> canTransfer:`, ok);
  console.log(`amount=${amount} -> trace:`, trace);
}

async function main() {
  console.log("\n== Composite AND Proof ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("token:", TOKEN);
  console.log("composite:", COMPOSITE);

  const policies = await client.readContract({
    address: COMPOSITE,
    abi,
    functionName: "getPolicies",
  });
  console.log("policy stack:", policies);

  await check(1n); // should fail at index 1 (MinAmountPolicyV1) if added
  await check(2n); // should pass
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
