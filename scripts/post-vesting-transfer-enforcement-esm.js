import { createPublicClient, createWalletClient, http, decodeErrorResult, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function loadArtifact(relPath) {
  const p = path.resolve(relPath);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function assertAddr(label, a) {
  if (!isAddress(a)) throw new Error(`${label} is not a valid address: ${a}`);
}

async function readStatus(publicClient, registryAbi, registry, addr) {
  // Try common patterns without assuming exact function names.
  // Your earlier logs showed getStatus + isVerified exist.
  let status = null;
  let verified = null;

  try {
    status = await publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "getStatus",
      args: [addr],
    });
  } catch {}

  try {
    verified = await publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "isVerified",
      args: [addr],
    });
  } catch {}

  return { status, verified };
}

function decodeRevert(e, abi) {
  // viem errors come in a few shapes; this tries the most useful fields.
  const data =
    e?.data ||
    e?.cause?.data ||
    e?.cause?.cause?.data ||
    e?.details?.data;

  if (data) {
    try {
      const decoded = decodeErrorResult({ abi, data });
      return `Revert (decoded): ${decoded.errorName}${decoded.args?.length ? ` args=${JSON.stringify(decoded.args)}` : ""}`;
    } catch {
      return `Revert (raw data): ${data}`;
    }
  }

  const msg =
    e?.shortMessage ||
    e?.cause?.shortMessage ||
    e?.message ||
    String(e);

  return `Revert (message): ${msg}`;
}

async function trySimulateThenWrite({ label, publicClient, walletClient, token, tokenAbi, account, functionName, args }) {
  process.stdout.write(`\n--- ${label} ---\n`);

  // 1) simulate to capture revert reason reliably (no gas spent)
  try {
    const sim = await publicClient.simulateContract({
      address: token,
      abi: tokenAbi,
      functionName,
      args,
      account: account.address,
    });

    console.log("simulate ✅ OK");
    // 2) broadcast actual tx so we also confirm on-chain behavior (optional but useful)
    const hash = await walletClient.writeContract(sim.request);
    console.log("write ✅ tx hash:", hash);
    return { ok: true, hash };
  } catch (e) {
    console.log("simulate ❌ FAILED");
    console.log(decodeRevert(e, tokenAbi));
    return { ok: false, error: e };
  }
}

async function main() {
  const rpcUrl = req("BASE_SEPOLIA_RPC_URL");

  const TOKEN = req("TOKEN");
  const REGISTRY = req("REGISTRY");

  const ADMIN = req("ADMIN");
  const BENEFICIARY = req("BENEFICIARY");
  const RECIPIENT_VERIFIED = req("RECIPIENT_VERIFIED");
  const RECIPIENT_UNVERIFIED = req("RECIPIENT_UNVERIFIED");

  [ ["TOKEN", TOKEN], ["REGISTRY", REGISTRY], ["ADMIN", ADMIN], ["BENEFICIARY", BENEFICIARY],
    ["RECIPIENT_VERIFIED", RECIPIENT_VERIFIED], ["RECIPIENT_UNVERIFIED", RECIPIENT_UNVERIFIED],
  ].forEach(([k,v]) => assertAddr(k, v));

  const adminPk = req("PRIVATE_KEY");
  const adminAccount = privateKeyToAccount(adminPk.startsWith("0x") ? adminPk : `0x${adminPk}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account: adminAccount });

  const tokenJson = loadArtifact("artifacts/contracts/EquityToken.sol/EquityToken.json");
  const registryJson = loadArtifact("artifacts/contracts/IdentityRegistry.sol/IdentityRegistry.json");

  const tokenAbi = tokenJson.abi;
  const registryAbi = registryJson.abi;

  console.log("\n== Part 3.5 — Post-Vesting Transfer Enforcement ==");
  console.log("RPC:", rpcUrl);
  console.log("Token:", TOKEN);
  console.log("Registry:", REGISTRY);
  console.log("Admin signer:", adminAccount.address, adminAccount.address.toLowerCase() === ADMIN.toLowerCase() ? "(matches ADMIN ✅)" : "(ADMIN mismatch ⚠️)");
  console.log("Beneficiary:", BENEFICIARY);
  console.log("Recipient (verified):", RECIPIENT_VERIFIED);
  console.log("Recipient (unverified):", RECIPIENT_UNVERIFIED);

  // Read balances
  const balBeneficiary = await publicClient.readContract({
    address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [BENEFICIARY],
  });
  const balAdmin = await publicClient.readContract({
    address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [ADMIN],
  });

  console.log("\nBalances:");
  console.log(`- Beneficiary ${shortAddr(BENEFICIARY)}:`, balBeneficiary.toString());
  console.log(`- Admin      ${shortAddr(ADMIN)}:`, balAdmin.toString());

  // Read registry status if available
  const regB = await readStatus(publicClient, registryAbi, REGISTRY, BENEFICIARY);
  const regV = await readStatus(publicClient, registryAbi, REGISTRY, RECIPIENT_VERIFIED);
  const regU = await readStatus(publicClient, registryAbi, REGISTRY, RECIPIENT_UNVERIFIED);

  console.log("\nRegistry checks (null = function missing or call failed):");
  console.log(`- Beneficiary: getStatus=${regB.status?.toString?.() ?? regB.status} isVerified=${regB.verified}`);
  console.log(`- Verified rcpt: getStatus=${regV.status?.toString?.() ?? regV.status} isVerified=${regV.verified}`);
  console.log(`- Unverified rcpt: getStatus=${regU.status?.toString?.() ?? regU.status} isVerified=${regU.verified}`);

  // =============== TEST MATRIX ===============

  // A) Beneficiary transfer attempt (should fail if custody model blocks beneficiary transfers)
  // We can’t sign as beneficiary (no pk), but we CAN still learn the enforced guard using simulateContract
  // by setting `account: BENEFICIARY`. simulate does not need the private key.
  console.log("\nA) Beneficiary transfer attempt (simulate as BENEFICIARY, 1 token):");
  try {
    await publicClient.simulateContract({
      address: TOKEN,
      abi: tokenAbi,
      functionName: "transfer",
      args: [RECIPIENT_VERIFIED, 1n],
      account: BENEFICIARY,
    });
    console.log("simulate ✅ Beneficiary transfer WOULD SUCCEED (custody model may NOT block beneficiary transfers)");
  } catch (e) {
    console.log("simulate ❌ Beneficiary transfer REVERTED (this is expected if custody enforced)");
    console.log(decodeRevert(e, tokenAbi));
  }

  // B) Admin transfer behavior
  // This tests whether admin is allowed to move tokens (custody operator).
  // If admin has 0 balance, we try transferring 0 first (should pass) then only do 1 if balance allows.
  console.log("\nB) Admin transfer behavior:");
  const amountAdminCanSend = balAdmin > 0n ? 1n : 0n;

  await trySimulateThenWrite({
    label: `Admin transfer(${amountAdminCanSend}) to RECIPIENT_VERIFIED`,
    publicClient, walletClient,
    token: TOKEN, tokenAbi,
    account: adminAccount,
    functionName: "transfer",
    args: [RECIPIENT_VERIFIED, amountAdminCanSend],
  });

  await trySimulateThenWrite({
    label: `Admin transfer(${amountAdminCanSend}) to RECIPIENT_UNVERIFIED`,
    publicClient, walletClient,
    token: TOKEN, tokenAbi,
    account: adminAccount,
    functionName: "transfer",
    args: [RECIPIENT_UNVERIFIED, amountAdminCanSend],
  });

  // C) Admin attempts transferFrom beneficiary -> recipient (custody operator model often uses transferFrom)
  // This reveals whether allowance is required, and/or whether the token contract has an admin/operator bypass.
  console.log("\nC) Admin transferFrom(BENEFICIARY -> recipient, 1 token):");

  await trySimulateThenWrite({
    label: "Admin transferFrom(BENEFICIARY -> RECIPIENT_VERIFIED, 1)",
    publicClient, walletClient,
    token: TOKEN, tokenAbi,
    account: adminAccount,
    functionName: "transferFrom",
    args: [BENEFICIARY, RECIPIENT_VERIFIED, 1n],
  });

  await trySimulateThenWrite({
    label: "Admin transferFrom(BENEFICIARY -> RECIPIENT_UNVERIFIED, 1)",
    publicClient, walletClient,
    token: TOKEN, tokenAbi,
    account: adminAccount,
    functionName: "transferFrom",
    args: [BENEFICIARY, RECIPIENT_UNVERIFIED, 1n],
  });

  console.log("\n== Done. Capture the decoded revert reason(s) above for Part 3.5 docs. ==");
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
