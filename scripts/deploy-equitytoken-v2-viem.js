import "dotenv/config";
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;

const ADMIN = "0x6C775411e11cAb752Af03C5BBb440618788E13Be";
const POLICY = process.env.POLICY;

if (!pk) throw new Error("Missing PRIVATE_KEY in env");
if (!POLICY) throw new Error("Missing POLICY env var (set it to deployed policy address)");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

function loadArtifact(relPath) {
  const p = path.resolve(relPath);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  console.log("\n== Deploy EquityTokenV2 (viem) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("deployer:", account.address);
  console.log("admin:", ADMIN);
  console.log("policy:", POLICY);

  const art = loadArtifact("artifacts/contracts/EquityTokenV2.sol/EquityTokenV2.json");

  const hash = await walletClient.deployContract({
    abi: art.abi,
    bytecode: art.bytecode,
    args: [ADMIN, POLICY],
  });

  console.log("deploy tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status);
  console.log("✅ EquityTokenV2 deployed:", receipt.contractAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
