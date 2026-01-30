import "dotenv/config";
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const TOKEN_V2 = process.env.TOKEN_V2;
  const POLICY = process.env.POLICY;
  const BENEFICIARY = process.env.BENEFICIARY;
  const ID_REGISTRY = process.env.ID_REGISTRY;
  const pk = process.env.PRIVATE_KEY;

  if (!TOKEN_V2 || !POLICY || !BENEFICIARY || !ID_REGISTRY) {
    throw new Error("Need TOKEN_V2, POLICY, BENEFICIARY, ID_REGISTRY");
  }
  if (!pk) throw new Error("Set PRIVATE_KEY");

  const FAIL_AMOUNT = 2n;
  const PASS_AMOUNT = 3n;

  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  const admin = account.address;
  const dead = "0x000000000000000000000000000000000000dEaD";

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
    account,
  });

  const tokenAbi = JSON.parse(
    fs.readFileSync(
      path.resolve("artifacts/contracts/EquityTokenV2.sol/EquityTokenV2.json"),
      "utf8"
    )
  ).abi;

  // CompositePolicyV111 ABI (has canTransfer(token,from,to,amount))
  const policyAbi = JSON.parse(
    fs.readFileSync(
      path.resolve(
        "artifacts/contracts/policy/CompositePolicyV111.sol/CompositePolicyV111.json"
      ),
      "utf8"
    )
  ).abi;

  const idAbi = JSON.parse(
    fs.readFileSync(
      path.resolve("artifacts/contracts/IdentityRegistry.sol/IdentityRegistry.json"),
      "utf8"
    )
  ).abi;

  console.log("\n== Prove Policy Gating v1 (no revert data required) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller/admin:", admin);
  console.log("tokenV2:", TOKEN_V2);
  console.log("policy:", POLICY);
  console.log("beneficiary:", BENEFICIARY);

  const totalSupply = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "totalSupply",
  });

  const adminBal = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [admin],
  });

  const deadBal = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [dead],
  });

  const deadVerified = await publicClient.readContract({
    address: ID_REGISTRY,
    abi: idAbi,
    functionName: "isVerified",
    args: [dead],
  });

  const benVerified = await publicClient.readContract({
    address: ID_REGISTRY,
    abi: idAbi,
    functionName: "isVerified",
    args: [BENEFICIARY],
  });

  console.log("\nPre-state:");
  console.log("totalSupply:", totalSupply.toString());
  console.log("admin balance:", adminBal.toString());
  console.log("dead balance:", deadBal.toString());
  console.log("dead isVerified:", deadVerified);
  console.log("beneficiary isVerified:", benVerified);

  if (adminBal < PASS_AMOUNT) {
    throw new Error("Admin must have at least 3 tokens to run this proof");
  }

  console.log("\nPolicy decisions:");

  const canDeadFail = await publicClient.readContract({
    address: POLICY,
    abi: policyAbi,
    functionName: "canTransfer",
    args: [TOKEN_V2, admin, dead, FAIL_AMOUNT],
  });

  const canBenFail = await publicClient.readContract({
    address: POLICY,
    abi: policyAbi,
    functionName: "canTransfer",
    args: [TOKEN_V2, admin, BENEFICIARY, FAIL_AMOUNT],
  });

  const canBenPass = await publicClient.readContract({
    address: POLICY,
    abi: policyAbi,
    functionName: "canTransfer",
    args: [TOKEN_V2, admin, BENEFICIARY, PASS_AMOUNT],
  });

  console.log(`canTransfer(admin -> dead, ${FAIL_AMOUNT}):`, canDeadFail);
  console.log(`canTransfer(admin -> beneficiary, ${FAIL_AMOUNT}):`, canBenFail);
  console.log(`canTransfer(admin -> beneficiary, ${PASS_AMOUNT}):`, canBenPass);

  console.log(`\n1) On-chain attempt: transfer(dead, ${FAIL_AMOUNT}) (should revert if policy=false) ...`);
  try {
    await walletClient.writeContract({
      address: TOKEN_V2,
      abi: tokenAbi,
      functionName: "transfer",
      args: [dead, FAIL_AMOUNT],
    });
    console.log("❌ ERROR: transfer(dead) unexpectedly succeeded");
  } catch {
    console.log("✅ transfer(dead) reverted (as expected)");
  }

  const adminBalAfterFail = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [admin],
  });

  const deadBalAfterFail = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [dead],
  });

  console.log("\nPost attempt balances (should be unchanged if reverted):");
  console.log("admin balance:", adminBalAfterFail.toString());
  console.log("dead balance:", deadBalAfterFail.toString());

  console.log(`\n2) On-chain attempt: transfer(beneficiary, ${PASS_AMOUNT}) (should succeed if policy=true) ...`);

  if (!canBenPass) {
    throw new Error("Policy says beneficiary transfer(3) is false. Expected true.");
  }

  const txHash = await walletClient.writeContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "transfer",
    args: [BENEFICIARY, PASS_AMOUNT],
  });

  console.log("tx:", txHash);
  console.log("✅ transfer(beneficiary) broadcast");

  const adminFinal = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [admin],
  });

  const benFinal = await publicClient.readContract({
    address: TOKEN_V2,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [BENEFICIARY],
  });

  console.log("\nFinal balances:");
  console.log("admin balance:", adminFinal.toString());
  console.log("beneficiary balance:", benFinal.toString());

  console.log("\n✅ Policy gating proof complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
