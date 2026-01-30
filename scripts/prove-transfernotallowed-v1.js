import "dotenv/config";
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http, decodeErrorResult, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;

const TOKEN_V2 = process.env.TOKEN_V2;
const ID_REGISTRY = process.env.ID_REGISTRY;

if (!pk) throw new Error("Missing PRIVATE_KEY");
if (!TOKEN_V2 || !ID_REGISTRY) throw new Error("Need TOKEN_V2 and ID_REGISTRY env vars");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

function loadArtifact(relPath) {
  const p = path.resolve(relPath);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const tokenAbi = parseAbi([
  "function balanceOf(address) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)"
]);

const registryAbi = parseAbi([
  "function isVerified(address user) external view returns (bool)"
]);

async function main() {
  console.log("\n== Prove TransferNotAllowed (simulate) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("tokenV2:", TOKEN_V2);

  const DEAD = "0x000000000000000000000000000000000000dEaD";

  const [bal, ts, deadVerified] = await Promise.all([
    publicClient.readContract({ address: TOKEN_V2, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: TOKEN_V2, abi: tokenAbi, functionName: "totalSupply" }),
    publicClient.readContract({ address: ID_REGISTRY, abi: registryAbi, functionName: "isVerified", args: [DEAD] }),
  ]);

  console.log("totalSupply:", ts.toString());
  console.log("caller balance:", bal.toString());
  console.log("dead isVerified:", deadVerified);

  if (bal < 1n) {
    console.log("⚠️ Caller has <1 token. Mint 1 to admin first, then re-run.");
    process.exit(1);
  }

  const art = loadArtifact("artifacts/contracts/EquityTokenV2.sol/EquityTokenV2.json");

  console.log("\nSimulating transfer(dead,1) ... expect TransferNotAllowed()");
  try {
    await publicClient.simulateContract({
      account,
      address: TOKEN_V2,
      abi: tokenAbi,
      functionName: "transfer",
      args: [DEAD, 1n],
    });
    console.log("❌ Unexpected: simulation succeeded (policy not blocking?)");
  } catch (e) {
    const data = e?.data;
    if (!data) {
      console.log("❌ Reverted but no data (RPC did not return revert data). Try a different RPC endpoint.");
      process.exit(1);
    }
    const decoded = decodeErrorResult({ abi: art.abi, data });
    console.log("✅ decoded error:", decoded.errorName);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
