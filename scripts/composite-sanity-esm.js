import "dotenv/config";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const COMPOSITE = process.env.COMPOSITE || "0x2f84c9918ec2602efa68000eae8b1fbe550311dc";
const TOKEN = process.env.TOKEN || "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17";

const ADMIN = process.env.ADMIN || "0x6C775411e11cAb752Af03C5BBb440618788E13Be";
const VERIFIED = process.env.VERIFIED_BENEFICIARY || "0x8B24E58442c0ECc9Ac11A22beb89C8eE53ED4544";
const UNVERIFIED = process.env.UNVERIFIED || "0x000000000000000000000000000000000000dEaD";

const abi = parseAbi([
  "function getPolicies() view returns (address[])",
  "function canTransfer(address token,address from,address to,uint256 amount) view returns (bool)",
  "function canTransferTrace(address token,address from,address to,uint256 amount) view returns (bool,uint256,address)",
]);

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

async function main() {
  console.log("\n== CompositePolicy Sanity (AND) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("token:", TOKEN);
  console.log("composite:", COMPOSITE);

  const policies = await client.readContract({
    address: COMPOSITE,
    abi,
    functionName: "getPolicies",
  });
  console.log("policies:", policies);

  const amt = 1n;

  const okV = await client.readContract({
    address: COMPOSITE,
    abi,
    functionName: "canTransfer",
    args: [TOKEN, ADMIN, VERIFIED, amt],
  });
  console.log("canTransfer admin -> verified:", okV);

  const traceV = await client.readContract({
    address: COMPOSITE,
    abi,
    functionName: "canTransferTrace",
    args: [TOKEN, ADMIN, VERIFIED, amt],
  });
  console.log("trace admin -> verified:", traceV);

  const okU = await client.readContract({
    address: COMPOSITE,
    abi,
    functionName: "canTransfer",
    args: [TOKEN, ADMIN, UNVERIFIED, amt],
  });
  console.log("canTransfer admin -> unverified:", okU);

  const traceU = await client.readContract({
    address: COMPOSITE,
    abi,
    functionName: "canTransferTrace",
    args: [TOKEN, ADMIN, UNVERIFIED, amt],
  });
  console.log("trace admin -> unverified:", traceU);

  console.log("\n✅ Sanity complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
