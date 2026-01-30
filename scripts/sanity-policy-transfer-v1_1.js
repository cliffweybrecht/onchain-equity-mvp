import "dotenv/config";
import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  decodeErrorResult,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;

const TOKEN_V2 = process.env.TOKEN_V2;
const POLICY = process.env.POLICY;
const BENEFICIARY = process.env.BENEFICIARY;
const ID_REGISTRY = process.env.ID_REGISTRY;

if (!pk) throw new Error("Missing PRIVATE_KEY");
if (!TOKEN_V2 || !POLICY || !BENEFICIARY || !ID_REGISTRY) {
  throw new Error("Need TOKEN_V2, POLICY, BENEFICIARY, ID_REGISTRY env vars");
}

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

const tokenAbi = parseAbi([
  "function admin() external view returns (address)",
  "function transferPolicy() external view returns (address)",
  "function totalSupply() external view returns (uint256)",
  "function mint(address to, uint256 amount) external",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address) external view returns (uint256)",
]);

const registryAbi = parseAbi([
  "function isVerified(address user) external view returns (bool)",
]);

function loadArtifact(relPath) {
  const p = path.resolve(relPath);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function readState(label) {
  const [ts, balAdmin, balBen] = await Promise.all([
    publicClient.readContract({ address: TOKEN_V2, abi: tokenAbi, functionName: "totalSupply" }),
    publicClient.readContract({ address: TOKEN_V2, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: TOKEN_V2, abi: tokenAbi, functionName: "balanceOf", args: [BENEFICIARY] }),
  ]);
  console.log(`\n-- ${label} --`);
  console.log("totalSupply:", ts.toString());
  console.log("admin balance:", balAdmin.toString());
  console.log("beneficiary balance:", balBen.toString());
}

async function tryWrite(label, req) {
  try {
    const hash = await walletClient.writeContract(req);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ ${label}: success (${hash}) status=${receipt.status}`);
    return { ok: true, hash };
  } catch (e) {
    console.log(`❌ ${label}: reverted`);

    // Decode custom errors (TransferNotAllowed / NotAdmin / PolicyZeroAddress)
    try {
      const art = loadArtifact("artifacts/contracts/EquityTokenV2.sol/EquityTokenV2.json");
      const data = e?.data;
      if (data) {
        const decoded = decodeErrorResult({ abi: art.abi, data });
        console.log("   decoded error:", decoded.errorName);
      } else {
        console.log("   (no revert data present — likely string revert like InsufficientBalance)");
      }
    } catch {
      console.log("   (could not decode error)");
    }

    return { ok: false, err: e };
  }
}

async function main() {
  console.log("\n== Sanity Policy Transfer v1.1 ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller/admin:", account.address);
  console.log("tokenV2:", TOKEN_V2);
  console.log("policy:", POLICY);
  console.log("beneficiary:", BENEFICIARY);

  const tokenAdmin = await publicClient.readContract({ address: TOKEN_V2, abi: tokenAbi, functionName: "admin" });
  const tokenPolicy = await publicClient.readContract({ address: TOKEN_V2, abi: tokenAbi, functionName: "transferPolicy" });

  console.log("\nToken admin():", tokenAdmin);
  console.log("Token transferPolicy():", tokenPolicy);

  if (tokenPolicy.toLowerCase() !== POLICY.toLowerCase()) {
    throw new Error("Policy mismatch: transferPolicy() != POLICY env var");
  }
  console.log("✅ policy pointer check passed");

  const [adminVerified, benVerified, deadVerified] = await Promise.all([
    publicClient.readContract({ address: ID_REGISTRY, abi: registryAbi, functionName: "isVerified", args: [account.address] }),
    publicClient.readContract({ address: ID_REGISTRY, abi: registryAbi, functionName: "isVerified", args: [BENEFICIARY] }),
    publicClient.readContract({ address: ID_REGISTRY, abi: registryAbi, functionName: "isVerified", args: ["0x000000000000000000000000000000000000dEaD"] }),
  ]);

  console.log("\nIdentityRegistry checks:");
  console.log("admin isVerified:", adminVerified);
  console.log("beneficiary isVerified:", benVerified);
  console.log("dead isVerified:", deadVerified);

  await readState("Before mint");

  // Mint 2 to ADMIN (so we can test policy gating without InsufficientBalance)
  console.log("\nMinting 2 to ADMIN...");
  await tryWrite("mint(admin,2)", {
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "mint",
    args: [account.address, 2n],
  });

  await readState("After mint(admin,2)");

  // Policy test 1: transfer to UNVERIFIED should revert TransferNotAllowed
  const DEAD = "0x000000000000000000000000000000000000dEaD";
  console.log("\nAttempt transfer(Dead,1) (expect TransferNotAllowed) ...");
  await tryWrite("transfer(dead,1)", {
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "transfer",
    args: [DEAD, 1n],
  });

  // Policy test 2: transfer to VERIFIED should succeed (beneficiary is verified)
  console.log("\nAttempt transfer(beneficiary,1) (expect success) ...");
  await tryWrite("transfer(beneficiary,1)", {
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "transfer",
    args: [BENEFICIARY, 1n],
  });

  await readState("After transfers");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
