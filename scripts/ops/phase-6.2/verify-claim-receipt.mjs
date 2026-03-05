// scripts/ops/phase-6.2/verify-claim-receipt.mjs
//
// Phase 6.2 — Deterministic verification of claim receipt (claim-receipt-v1)
//
// Verifies:
// 1) Receipt fields match on-chain receipt
// 2) calldataDigest matches keccak256(tx.data)
// 3) Transfer logs sum to beneficiary == claimedIncrease
//
// Inputs:
//   IN=/path/to/claim-receipt.json
//   OR
//   TX=0x... (fetch receipt directly)

import fs from "fs";
import path from "path";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isHex,
  keccak256,
  parseAbi,
  zeroAddress
} from "viem";
import { baseSepolia } from "viem/chains";
import { writeJsonDeterministic, nowIsoSafe, copyLatest } from "../_evidence.mjs";

const PHASE = "phase-6.2";
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

const IN_PATH = process.env.IN || null;
const TX = process.env.TX || null;

const TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isoFromUnixSeconds(sec) {
  return new Date(Number(sec) * 1000).toISOString();
}

function normStatus(s) {
  if (typeof s === "bigint") return s === 1n ? 1 : 0;

  if (typeof s === "number") return s;

  if (typeof s === "string") {
    const sl = s.toLowerCase();

    if (sl === "success") return 1;
    if (sl === "reverted") return 0;

    if (sl.startsWith("0x")) return parseInt(sl, 16);

    const n = Number(sl);
    if (Number.isFinite(n)) return n;
  }

  return 0;
}

async function main() {

  must(IN_PATH || TX, "Provide IN=/path/to/claim-receipt.json OR TX=0x...");

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL)
  });

  let payload = null;

  if (IN_PATH) {

    payload = JSON.parse(fs.readFileSync(IN_PATH, "utf8"));

  } else {

    const receipt = await client.waitForTransactionReceipt({ hash: TX });

    const blk = await client.getBlock({
      blockNumber: receipt.blockNumber
    });

    payload = {
      schema: "claim-receipt-v1",
      type: "claim-receipt",
      chain: { chainId: 84532, name: "base-sepolia" },

      tx: { hash: TX },

      receipt: {
        status: normStatus(receipt.status),
        blockNumber: Number(receipt.blockNumber),
        blockHash: receipt.blockHash
      },

      block: {
        timestamp: Number(blk.timestamp),
        timestampISO: isoFromUnixSeconds(Number(blk.timestamp))
      },

      contracts: {
        vesting: zeroAddress,
        equityToken: zeroAddress
      },

      claim: {
        beneficiary: zeroAddress,
        calldataDigest: { alg: "keccak256", value: zeroAddress }
      },

      state: {
        delta: { claimedIncrease: "0" }
      }
    };
  }

  must(payload.schema === "claim-receipt-v1", "schema mismatch");

  const txHash = payload.tx.hash;

  const onchain = await client.waitForTransactionReceipt({
    hash: txHash
  });

  must(
    normStatus(onchain.status) === normStatus(payload.receipt.status),
    `receipt.status mismatch vs onchain`
  );

  must(
    Number(onchain.blockNumber) === Number(payload.receipt.blockNumber),
    "receipt.blockNumber mismatch vs onchain"
  );

  must(
    onchain.blockHash === payload.receipt.blockHash,
    "receipt.blockHash mismatch vs onchain"
  );

  if (payload.tx?.data) {

    must(isHex(payload.tx.data), "tx.data not hex");

    const digest = keccak256(payload.tx.data);

    must(
      digest.toLowerCase() === payload.claim.calldataDigest.value.toLowerCase(),
      "calldataDigest mismatch"
    );
  }

  const transferTopic0 = keccak256(
    "0x" + Buffer.from("Transfer(address,address,uint256)").toString("hex")
  );

  const beneficiary = payload.claim?.beneficiary
    ? getAddress(payload.claim.beneficiary)
    : null;

  const transfers = [];

  for (const log of onchain.logs || []) {

    if (!log?.topics?.length) continue;

    if (log.topics[0]?.toLowerCase() !== transferTopic0.toLowerCase())
      continue;

    try {

      const decoded = decodeEventLog({
        abi: TRANSFER_ABI,
        data: log.data,
        topics: log.topics
      });

      if (decoded?.eventName === "Transfer") {

        const from = getAddress(decoded.args.from);
        const toAddr = getAddress(decoded.args.to);
        const value = BigInt(decoded.args.value);

        transfers.push({
          token: getAddress(log.address),
          from,
          to: toAddr,
          amount: value
        });
      }

    } catch {}
  }

  const tokensToBeneficiary = beneficiary
    ? transfers
        .filter((t) => t.to === beneficiary)
        .reduce((acc, t) => acc + t.amount, 0n)
    : 0n;

  const claimedIncrease = BigInt(payload.state?.delta?.claimedIncrease ?? "0");

  const transferMatchesDelta = tokensToBeneficiary === claimedIncrease;

  const receiptStatus = normStatus(payload.receipt.status) === 1;

  const claimedIncreased = claimedIncrease > 0n;

  const report = {

    schema: "claim-receipt-verify-v1",

    phase: PHASE,

    network: {
      name: "Base Sepolia",
      chainId: 84532
    },

    rpc: RPC_URL,

    txHash,

    checks: {
      receiptStatus,
      claimedIncreased,
      transferMatchesDelta
    },

    derived: {
      tokensTransferredToBeneficiary: tokensToBeneficiary.toString(),
      claimedIncrease: claimedIncrease.toString(),
      transferCount: transfers.length
    },

    notes: [
      "Transfer logs derived from on-chain receipt",
      "Receipt status normalized across viem formats"
    ]
  };

  const evidenceDir = path.resolve(`evidence/${PHASE}`);

  fs.mkdirSync(evidenceDir, { recursive: true });

  const ts = nowIsoSafe();

  const outPath = path.join(
    evidenceDir,
    `verify-claim-${ts}.json`
  );

  const latestPath = path.join(
    evidenceDir,
    `verify-claim.latest.json`
  );

  writeJsonDeterministic(outPath, report);

  copyLatest(latestPath, outPath);

  console.log("✅ wrote:", outPath);
  console.log("✅ receiptStatus:", receiptStatus);
  console.log("✅ claimedIncreased:", claimedIncreased);
  console.log("✅ transferMatchesDelta:", transferMatchesDelta);
  console.log("✅ latest ->", latestPath);

  if (!receiptStatus || !claimedIncreased || !transferMatchesDelta)
    process.exit(2);
}

main().catch((e) => {
  console.error("❌ verify-claim-receipt failed:", e?.message || e);
  process.exit(1);
});
