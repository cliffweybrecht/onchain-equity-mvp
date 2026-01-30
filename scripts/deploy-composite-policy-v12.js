// scripts/deploy-composite-policy-v12.js
import "dotenv/config";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("Set PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const ADMIN = process.env.ADMIN || account.address;

const STACK_ID = process.env.POLICY_STACK_ID;
const P0 = process.env.POLICY_0_FREEZE;
const P1 = process.env.POLICY_1_COMPLIANCE;
const P2 = process.env.POLICY_2_MINAMOUNT;

if (!STACK_ID || !P0 || !P1 || !P2) {
  throw new Error(
    "Missing env vars: POLICY_STACK_ID, POLICY_0_FREEZE, POLICY_1_COMPLIANCE, POLICY_2_MINAMOUNT"
  );
}

// ✅ Correct artifact path for your repo:
function loadArtifact() {
  const c = "artifacts/contracts/policy/CompositePolicyV111.sol/CompositePolicyV111.json";
  const art = JSON.parse(fs.readFileSync(path.resolve(c), "utf8"));
  return { art, path: c };
}

const { art, path: artifactPath } = loadArtifact();

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

async function main() {
  console.log("\n== Deploy CompositePolicy root v1.2 ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("deployer:", account.address);
  console.log("admin:", ADMIN);
  console.log("artifact:", artifactPath);
  console.log("stackId:", STACK_ID);
  console.log("children:", [P0, P1, P2]);

  const ctor = art.abi.find((x) => x.type === "constructor");
  console.log(
    "constructor inputs:",
    ctor?.inputs?.map((i) => `${i.type} ${i.name}`).join(", ") || "(none)"
  );

  // Constructor: (address _admin, string _policyStackId, address[] _policies)
  const args = [ADMIN, STACK_ID, [P0, P1, P2]];

  const hash = await walletClient.deployContract({
    abi: art.abi,
    bytecode: art.bytecode,
    args,
  });

  console.log("deploy tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("deployed at:", receipt.contractAddress);
}

main().catch((e) => {
  console.error("\n❌ Deploy failed.\n");
  console.error(e);
  process.exit(1);
});
