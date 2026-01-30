// scripts/enforcement-test-esm.js
// Run: npx hardhat run scripts/enforcement-test-esm.js --network baseSepolia
//
// Required env:
//   PRIVATE_KEY
//   TOKEN
//   REGISTRY
//   UNVERIFIED
//
// Optional:
//   VERIFIED
//
// Vesting Tests require:
//   VESTING
//   BENEFICIARY
//   BENEFICIARY_PRIVATE_KEY

import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  http,
  isHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

console.log("\n== Enforcement Test (ESM) ==\n");

// -------------------- ENV --------------------
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN = process.env.TOKEN;
const REGISTRY = process.env.REGISTRY;

const UNVERIFIED = process.env.UNVERIFIED;
const VERIFIED = process.env.VERIFIED;

// Vesting
const VESTING = process.env.VESTING;
const BENEFICIARY = process.env.BENEFICIARY;
const BENEFICIARY_PRIVATE_KEY = process.env.BENEFICIARY_PRIVATE_KEY;

if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY env var");
if (!TOKEN) throw new Error("Missing TOKEN env var");
if (!REGISTRY) throw new Error("Missing REGISTRY env var");
if (!UNVERIFIED) throw new Error("Missing UNVERIFIED env var");

// -------------------- CLIENTS --------------------
const adminAccount = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl),
});

const adminWallet = createWalletClient({
  account: adminAccount,
  chain: baseSepolia,
  transport: http(rpcUrl),
});

const beneficiaryAccount =
  BENEFICIARY_PRIVATE_KEY && isHex(BENEFICIARY_PRIVATE_KEY)
    ? privateKeyToAccount(BENEFICIARY_PRIVATE_KEY)
    : null;

const beneficiaryWallet =
  beneficiaryAccount &&
  createWalletClient({
    account: BENEFICIARY,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

// -------------------- LOAD ARTIFACT ABIS --------------------
function loadArtifact(relPath) {
  const p = path.resolve(relPath);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const tokenArtifact = loadArtifact(
  "artifacts/contracts/EquityToken.sol/EquityToken.json"
);
if (!tokenArtifact?.abi) {
  throw new Error("Could not load EquityToken ABI. Run `npx hardhat compile`.");
}
const tokenAbi = tokenArtifact.abi;

const registryArtifact = loadArtifact(
  "artifacts/contracts/IdentityRegistry.sol/IdentityRegistry.json"
);
const registryAbi =
  registryArtifact?.abi ??
  [
    {
      type: "function",
      name: "isVerified",
      stateMutability: "view",
      inputs: [{ type: "address", name: "" }],
      outputs: [{ type: "bool", name: "" }],
    },
    {
      type: "function",
      name: "getStatus",
      stateMutability: "view",
      inputs: [{ type: "address", name: "" }],
      outputs: [{ type: "uint8", name: "" }],
    },
  ];

const vestingArtifact = loadArtifact(
  "artifacts/contracts/VestingContract.sol/VestingContract.json"
);
const vestingAbi = vestingArtifact?.abi ?? null;

// -------------------- HELPERS --------------------
function firstLine(s) {
  return String(s ?? "").split("\n")[0];
}

function extractRevertData(err) {
  // Try a bunch of common viem error shapes.
  return (
    err?.cause?.data ??
    err?.data ??
    err?.details ??
    err?.cause?.cause?.data ??
    err?.cause?.cause?.cause?.data ??
    null
  );
}

function decodeWithAbi(abi, data) {
  if (!abi || typeof data !== "string" || !data.startsWith("0x")) return null;
  try {
    return decodeErrorResult({ abi, data });
  } catch {
    return null;
  }
}

async function expectRevert(label, fn, decodeAbi) {
  try {
    await fn();
    console.log(`❌ ${label}: expected revert, but it succeeded`);
    process.exitCode = 1;
  } catch (err) {
    console.log(`✅ ${label}: reverted as expected`);

    const data = extractRevertData(err);
    if (data) console.log("   ↳ revert data:", data);

    const decoded = decodeWithAbi(decodeAbi, data);
    if (decoded) {
      console.log(`   ↳ decoded error: ${decoded.errorName}`, decoded.args ?? "");
    } else {
      console.log("   ↳", firstLine(err?.shortMessage || err?.message || err));
    }
  }
}

async function tokenBalance(addr) {
  return publicClient.readContract({
    address: TOKEN,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [addr],
  });
}

async function readRegistry(addr) {
  const [isVerified, status] = await Promise.all([
    publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "isVerified",
      args: [addr],
    }),
    publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "getStatus",
      args: [addr],
    }),
  ]);
  return { isVerified, status };
}

function toUTC(ts) {
  // ts is bigint seconds
  const ms = Number(ts) * 1000;
  return new Date(ms).toISOString();
}

async function main() {
  // -------------------- PRINT CONFIG --------------------
  console.log("RPC:", rpcUrl);
  console.log("Admin:", adminAccount.address);
  console.log("Registry:", REGISTRY);
  console.log("Token:", TOKEN);
  console.log("UNVERIFIED:", UNVERIFIED);
  if (VERIFIED) console.log("VERIFIED:", VERIFIED);
  if (VESTING) console.log("VESTING:", VESTING);
  if (BENEFICIARY) console.log("BENEFICIARY:", BENEFICIARY);
  if (beneficiaryAccount) console.log("BENEFICIARY signer:", beneficiaryAccount.address);

  // -------------------- Registry checks --------------------
  console.log("\n-- Registry checks --");
  const u = await readRegistry(UNVERIFIED);
  console.log("UNVERIFIED getStatus:", u.status);
  console.log("UNVERIFIED isVerified:", u.isVerified);

  if (u.isVerified) {
    console.log("\n❌ UNVERIFIED is actually verified. Pick another address.\n");
    process.exitCode = 1;
    return;
  }

  if (VERIFIED) {
    const v = await readRegistry(VERIFIED);
    console.log("VERIFIED getStatus:", v.status);
    console.log("VERIFIED isVerified:", v.isVerified);
  }

  // -------------------- Token checks --------------------
  console.log("\n-- Token checks --");
  const adminBal = await tokenBalance(adminAccount.address);
  console.log("Admin token balance:", adminBal.toString());

  if (adminBal === 0n) {
    console.log("\n❌ Admin has 0 tokens. Mint at least 1 token to admin.\n");
    process.exitCode = 1;
    return;
  }

  // =========================
  // TEST 1: KYC enforcement
  // =========================
  console.log("\n== Test 1: Block transfer to UNVERIFIED recipient ==");
  await expectRevert(
    "transfer(UNVERIFIED, 1)",
    async () => {
      const hash = await adminWallet.writeContract({
        address: TOKEN,
        abi: tokenAbi,
        functionName: "transfer",
        args: [UNVERIFIED, 1n],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    },
    tokenAbi
  );

  // =========================
  // TEST 1b: Verified success
  // =========================
  if (VERIFIED) {
    console.log("\n== Test 1b: Transfer to VERIFIED recipient ==");
    const v = await readRegistry(VERIFIED);
    if (!v.isVerified) {
      console.log("⚠️ VERIFIED is not verified; skipping success transfer.");
    } else {
      const hash = await adminWallet.writeContract({
        address: TOKEN,
        abi: tokenAbi,
        functionName: "transfer",
        args: [VERIFIED, 1n],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("✅ transfer(VERIFIED, 1) success. tx:", receipt.transactionHash);
    }
  }

  // =========================
  // TEST 2 + 3: Vesting enforcement
  // =========================
  console.log("\n== Test 2/3: Vesting enforcement (custody-based) ==");

  if (!VESTING || !vestingAbi) {
    console.log("⚠️ Skipping vesting tests: set VESTING and ensure VestingContract artifact exists.");
    console.log("   Need artifacts/contracts/VestingContract.sol/VestingContract.json");
    return;
  }
  if (!BENEFICIARY) {
    console.log("⚠️ Skipping vesting tests: set BENEFICIARY.");
    return;
  }

  const grant = await publicClient.readContract({
    address: VESTING,
    abi: vestingAbi,
    functionName: "grants",
    args: [BENEFICIARY],
  });

  const exists = Array.isArray(grant) ? grant[5] : false;
  console.log("Grant (raw):", grant);
  console.log("Grant exists:", exists);

  if (!exists) {
    console.log("⚠️ No grant exists. Run sanity-vesting-esm.js once to create it.");
    return;
  }

  const block = await publicClient.getBlock({ blockTag: "latest" });
  const now = BigInt(block.timestamp);
  const startTs = BigInt(grant[2]);
  const cliffTs = BigInt(grant[3]);

  console.log("block.timestamp:", now.toString(), toUTC(now));
  console.log("grant.start   :", startTs.toString(), toUTC(startTs));
  console.log("grant.cliff   :", cliffTs.toString(), toUTC(cliffTs));

  const benBalBefore = await tokenBalance(BENEFICIARY);
  console.log("Beneficiary balance before:", benBalBefore.toString());

  if (now < cliffTs) {
    const secs = cliffTs - now;
    console.log(`\n-- Pre-cliff: ${secs.toString()} seconds remaining --`);
    console.log("-- Simulate release(BENEFICIARY) (should revert or release 0) --");

    // We EXPECT revert pre-cliff in your implementation, so treat success as suspicious
    await expectRevert(
      "simulate release pre-cliff",
      async () => {
        await publicClient.simulateContract({
          address: VESTING,
          abi: vestingAbi,
          functionName: "release",
          args: [BENEFICIARY],
          account: BENEFICIARY,
        });
      },
      vestingAbi
    );

    console.log("\n✅ Test 2 passed (enforced pre-cliff).");
    console.log(`Re-run this script after cliff time: ${toUTC(cliffTs)} (UTC)`);
    return;
  }

  // If we are past cliff, we run Test 3 automatically (custody model)
  console.log("\n-- Post-cliff: custody model checks --");

  // (A) Beneficiary cannot self-release (admin-only custody)
  await expectRevert(
    "beneficiary release() should revert (custody model enforced)",
    async () => {
      await publicClient.simulateContract({
        address: VESTING,
        abi: vestingAbi,
        functionName: "release",
        args: [BENEFICIARY],
        account: BENEFICIARY,
      });
    },
    vestingAbi
  );

  // (B) Admin can release post-cliff
  console.log("\n-- Post-cliff: admin executing release(BENEFICIARY) --");

  const benBal0 = await tokenBalance(BENEFICIARY);
  const vestGrant0 = await publicClient.readContract({
    address: VESTING,
    abi: vestingAbi,
    functionName: "grants",
    args: [BENEFICIARY],
  });

  console.log("Beneficiary balance before:", benBal0.toString());
  console.log("Grant before (raw):", vestGrant0);

  // If fully released already, release() should revert with NothingToRelease and that is a PASS.
  const total = vestGrant0[0];
  const released = vestGrant0[1];
  if (released === total) {
    console.log("✅ Grant already fully released (released == total). Skipping admin release tx.");
    console.log("\n✅ Enforcement tests complete\n");
    return;
  }


  const simAdmin = await publicClient.simulateContract({
    address: VESTING,
    abi: vestingAbi,
    functionName: "release",
    args: [BENEFICIARY],
    account: adminAccount,
  });

  const relHash = await adminWallet.writeContract(simAdmin.request);
  const relReceipt = await publicClient.waitForTransactionReceipt({ hash: relHash });

  console.log("✅ admin release tx:", relReceipt.transactionHash, "status:", relReceipt.status, "block:", relReceipt.blockNumber?.toString?.() ?? "");

  // Decode receipt logs (proof bundle)
  // NOTE: these are standard event signatures (no need full ABI)
  const { parseAbi, decodeEventLog } = await import("viem");

  const tokenEvents = parseAbi([
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ]);

  const vestingEvents = parseAbi([
    "event GrantReleased(address indexed employee, uint256 amountReleased)",
  ]);

  for (const log of relReceipt.logs) {
    const addr = log.address.toLowerCase();

    if (addr === TOKEN.toLowerCase()) {
      try {
        const d = decodeEventLog({ abi: tokenEvents, data: log.data, topics: log.topics });
        console.log("TOKEN EVENT:", d.eventName, d.args);
      } catch {}
    }

    if (addr === VESTING.toLowerCase()) {
      try {
        const d = decodeEventLog({ abi: vestingEvents, data: log.data, topics: log.topics });
        console.log("VESTING EVENT:", d.eventName, d.args);
      } catch {}
    }
  }

  // Block-tagged reads at receipt block (avoids provider lag / stale reads)
  const bn = relReceipt.blockNumber;
  const benBal1 = await publicClient.readContract({
    address: TOKEN,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [BENEFICIARY],
    blockNumber: bn,
  });

  const supply1 = await publicClient.readContract({
    address: TOKEN,
    abi: tokenAbi,
    functionName: "totalSupply",
    args: [],
    blockNumber: bn,
  });

  const vestGrant1 = await publicClient.readContract({
    address: VESTING,
    abi: vestingAbi,
    functionName: "grants",
    args: [BENEFICIARY],
    blockNumber: bn,
  });

  console.log("Beneficiary balance @receipt block:", benBal1.toString());
  console.log("TotalSupply @receipt block:", supply1.toString());
  console.log("Grant @receipt block (raw):", vestGrant1);

  // Assertions
  if (benBal1 <= benBal0) {
    console.log("❌ Expected beneficiary balance to increase after admin release.");
    process.exitCode = 1;
  } else {
    console.log("✅ Beneficiary balance increased after admin release.");
  }

  // released should match vested (commonly equals total once fully vested)
  if (Array.isArray(vestGrant1) && vestGrant1[1] === 0n) {
    console.log("❌ Expected grants(beneficiary).released to update (non-zero).");
    process.exitCode = 1;
  } else {
    console.log("✅ grants(beneficiary).released updated.");
  }

  console.log("\n✅ Enforcement tests complete\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exitCode = 1;
});