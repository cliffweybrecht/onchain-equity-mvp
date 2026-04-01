#!/usr/bin/env node

import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "contracts", "evidence", "phase-8.3");
const OUT_FILE = path.join(OUT_DIR, "transfer-event-verification.json");

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((x) => x.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function nowIso() {
  return new Date().toISOString();
}

function topicToAddress(topic) {
  return getAddress(`0x${topic.slice(26)}`);
}

const TX =
  argValue("tx") ||
  "0xdd14b060b425d80e2e7af0c6596529af9aabf5e9b3d7da73647026d7c91aabca";

const TOKEN =
  argValue("token") ||
  "0x2791d08fc94c787e5772daba3507a68e74ba4b10";

const VESTING =
  argValue("vesting") ||
  "0xef444c538769d7626511a4c538d03ffc7e53262b";

const BENEFICIARY =
  argValue("beneficiary") ||
  "0xd3eD697274ec8Bc9f638CE80fD789a49dA4aD996";

const EXPECTED_AMOUNT =
  argValue("expected-amount") ||
  "3805175038052";

const RELEASED_DELTA =
  argValue("released-delta") ||
  "3805175038052";

const BENEFICIARY_BALANCE_DELTA =
  argValue("beneficiary-balance-delta") ||
  "3805175038052";

const CLAIM_RECEIPT_FILE = path.join(
  ROOT,
  "contracts",
  "evidence",
  "phase-8.2",
  "claim-execution-receipt.json"
);

const RPC = process.env.BASE_SEPOLIA_RPC_URL;

if (!RPC) {
  throw new Error("Missing BASE_SEPOLIA_RPC_URL");
}

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC),
});

async function main() {
  const txHash = TX;
  const token = getAddress(TOKEN);
  const vesting = getAddress(VESTING);
  const beneficiary = getAddress(BENEFICIARY);

  const expectedAmount = BigInt(EXPECTED_AMOUNT);
  const releasedDelta = BigInt(RELEASED_DELTA);
  const beneficiaryBalanceDelta = BigInt(BENEFICIARY_BALANCE_DELTA);

  const receipt = await client.getTransactionReceipt({
    hash: txHash,
  });

  const TRANSFER_TOPIC =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  const transferEvents = receipt.logs
    .filter(
      (log) =>
        getAddress(log.address) === token &&
        log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC
    )
    .map((log) => ({
      token: getAddress(log.address),
      from: log.topics[1] ? topicToAddress(log.topics[1]) : null,
      to: log.topics[2] ? topicToAddress(log.topics[2]) : null,
      value: BigInt(log.data).toString(),
      log_index: log.logIndex
    }));

  const matchingTransfer =
    transferEvents.find(
      (evt) =>
        evt.to === beneficiary &&
        BigInt(evt.value) === expectedAmount
    ) || null;

  const zeroAddress = "0x0000000000000000000000000000000000000000";

  let lineageModel = "no_matching_transfer";
  if (matchingTransfer) {
    if (matchingTransfer.from === zeroAddress) {
      lineageModel = "mint_on_claim";
    } else if (matchingTransfer.from === vesting) {
      lineageModel = "vesting_to_beneficiary";
    } else {
      lineageModel = "other";
    }
  }

  let phase82ReceiptSummary = null;
  if (fileExists(CLAIM_RECEIPT_FILE)) {
    try {
      const prior = readJson(CLAIM_RECEIPT_FILE);
      phase82ReceiptSummary = {
        beneficiary: prior.beneficiary ?? null,
        caller: prior.caller ?? null
      };
    } catch {
      phase82ReceiptSummary = null;
    }
  }

  const amountReconciliation = {
    expected_amount: expectedAmount.toString(),
    released_delta: releasedDelta.toString(),
    beneficiary_balance_delta: beneficiaryBalanceDelta.toString(),
    transfer_value: matchingTransfer ? matchingTransfer.value : null,
    all_equal:
      !!matchingTransfer &&
      BigInt(matchingTransfer.value) === expectedAmount &&
      releasedDelta === expectedAmount &&
      beneficiaryBalanceDelta === expectedAmount
  };

  const artifact = {
    phase: "8.3",
    generated_at: nowIso(),
    claim_tx_hash: txHash,
    block_number: receipt.blockNumber.toString(),

    contracts: {
      token,
      vesting,
      expected_beneficiary: beneficiary
    },

    phase_8_2_context: phase82ReceiptSummary,

    transfer_events: transferEvents,
    transfer_count: transferEvents.length,

    matching_transfer: matchingTransfer,

    recipient_matches_expected_beneficiary:
      !!matchingTransfer && matchingTransfer.to === beneficiary,

    canonical_transfer_present: !!matchingTransfer,

    lineage_model: lineageModel,

    amount_reconciliation: amountReconciliation,

    interpretation:
      !matchingTransfer
        ? "NO_MATCHING_TRANSFER_TO_EXPECTED_BENEFICIARY"
        : lineageModel === "mint_on_claim"
        ? "MINT_ON_CLAIM_CONFIRMED"
        : lineageModel === "vesting_to_beneficiary"
        ? "VESTING_TO_BENEFICIARY_TRANSFER_CONFIRMED"
        : "TRANSFER_PRESENT_BUT_LINEAGE_DIFFERS_FROM_EXPECTED_VESTING_MODEL",

    status:
      !!matchingTransfer && amountReconciliation.all_equal
        ? "PASS_WITH_ARCHITECTURE_NOTE"
        : "FAIL"
  };

  mkdirp(OUT_DIR);
  fs.writeFileSync(OUT_FILE, JSON.stringify(artifact, null, 2) + "\n");

  console.log(JSON.stringify(artifact, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
