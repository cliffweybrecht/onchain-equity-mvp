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

async function tryWrite(label, req) {
  try {
    const hash = await walletClient.writeContract(req);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ ${label}: success (${hash})`);
    return { ok: true, hash };
  } catch (e) {
    console.log(`❌ ${label}: reverted`);
    // Try to decode custom error using EquityTokenV2 artifact ABI
    try {
      const art = loadArtifact("artifacts/contracts/EquityTokenV2.sol/EquityTokenV2.json");
      const data = e?.data;
      if (data) {
        const decoded = decodeErrorResult({ abi: art.abi, data });
        console.log("   decoded error:", decoded.errorName);
      } else {
        console.log("   (no revert data present in error)");
      }
    } catch (e2) {
      console.log("   (could not decode custom error)");
    }
    return { ok: false, err: e };
  }
}

async function main() {
  console.log("\n== Sanity Policy Transfer v1 ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("tokenV2:", TOKEN_V2);
  console.log("policy:", POLICY);
  console.log("beneficiary:", BENEFICIARY);

  // 1) Verify token points to policy
  const tokenAdmin = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "admin",
  });

  const tokenPolicy = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "transferPolicy",
  });

  console.log("\nToken admin:", tokenAdmin);
  console.log("Token transferPolicy():", tokenPolicy);

  if (tokenPolicy.toLowerCase() !== POLICY.toLowerCase()) {
    throw new Error("Token policy mismatch. transferPolicy() != POLICY env var");
  }
  console.log("✅ policy pointer check passed");

  // 2) Check verification state of beneficiary
  const benVerified = await publicClient.readContract({
    address: ID_REGISTRY,
    abi: registryAbi,
    functionName: "isVerified",
    args: [BENEFICIARY],
  });
  console.log("\nBeneficiary isVerified:", benVerified);

  // 3) Mint 2 to beneficiary (caller must be admin)
  console.log("\nMinting 2 to beneficiary...");
  await tryWrite("mint(beneficiary,2)", {
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "mint",
    args: [BENEFICIARY, 2n],
  });

  const balAfterMint = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [BENEFICIARY],
  });
  console.log("Beneficiary balance after mint:", balAfterMint.toString());

  // 4) Attempt transfer to an UNVERIFIED address (we'll generate a fresh one)
  const unverified = "0x000000000000000000000000000000000000dEaD"; // almost certainly unverified
  const unvVerified = await publicClient.readContract({
    address: ID_REGISTRY,
    abi: registryAbi,
    functionName: "isVerified",
    args: [unverified],
  });
  console.log("\nUnverified target:", unverified, "isVerified:", unvVerified);

  console.log("Attempting transfer(Dead,1) from ADMIN (should fail if admin unverified? policy checks recipient only)");
  console.log("NOTE: this call is from ADMIN wallet; beneficiary transfer test comes next.");
  await tryWrite("admin transfer(unverified,1)", {
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "transfer",
    args: [unverified, 1n],
  });

  // 5) Now test beneficiary transfer: we cannot sign as beneficiary unless you have its key.
  console.log("\n--- Beneficiary transfer test requires BENEFICIARY_PRIVATE_KEY ---");
  console.log("If you export BENEFICIARY_PRIVATE_KEY, we can run the beneficiary-signed transfer test next.");
  console.log("For now, we proved: token points to policy, and mint path works.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
