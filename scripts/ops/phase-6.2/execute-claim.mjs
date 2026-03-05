// scripts/ops/phase-6.2/execute-claim.mjs
//
// Phase 6.2 — Deterministic Claim Execution + Receipt Capture (Execution Phase)
//
// Goals:
// - Execute (or recover) a vesting claim deterministically
// - Capture canonical claim receipt JSON (claim-receipt-v1)
// - Anchor all state reads to deterministic block numbers (blockNumber-1, blockNumber)
//
// Modes:
// 1) Send mode (default): sends tx using PRIVATE_KEY
// 2) Recovery mode: set TX=0x... to rebuild claim receipt without sending
//
// Required env:
//   VESTING=0x...
//   BENEFICIARY=0x...
//   PRIVATE_KEY=0x... (EOA executor)
// Optional env:
//   RPC_URL (defaults to https://sepolia.base.org)
//   TX=0x... (recovery mode; do not send, only rebuild evidence)
//   INPUT=/path/to/json (use calldata built elsewhere; expects {to,data} or {tx:{to,data|encodedData}})
//   AMOUNT_OEQ=... (if claim fn requires uint amount; OEQ decimals=0)
//   EQUITY_TOKEN=0x...   (override discovery)
//   IDENTITY_REGISTRY=0x...
//   POLICY=0x...

import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  isHex,
  keccak256,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { nowIsoSafe, writeJsonDeterministic, copyLatest } from "../_evidence.mjs";

const PHASE = "phase-6.2";
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

const VESTING = process.env.VESTING ? getAddress(process.env.VESTING) : null;
const BENEFICIARY = process.env.BENEFICIARY ? getAddress(process.env.BENEFICIARY) : null;

const EQUITY_TOKEN_ENV = process.env.EQUITY_TOKEN ? getAddress(process.env.EQUITY_TOKEN) : null;
const IDENTITY_REGISTRY_ENV = process.env.IDENTITY_REGISTRY ? getAddress(process.env.IDENTITY_REGISTRY) : null;
const POLICY_ENV = process.env.POLICY ? getAddress(process.env.POLICY) : null;

const INPUT = process.env.INPUT || null;
const TX = process.env.TX || null;

const AMOUNT_OEQ = process.env.AMOUNT_OEQ ? BigInt(process.env.AMOUNT_OEQ) : null;

function loadAbiFromArtifacts() {
  const candidates = [
    "artifacts/contracts/VestingContract.sol/VestingContract.json",
    "artifacts/contracts/Vesting.sol/Vesting.json",
    "out/VestingContract.sol/VestingContract.json",
    "out/Vesting.sol/Vesting.json",
  ].map((p) => path.resolve(p));

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (!j.abi) throw new Error(`Artifact found but missing .abi: ${p}`);
      return j.abi;
    }
  }
  throw new Error("Missing vesting artifact ABI (compile locally or add your artifact path).");
}

const TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const GETTERS_MIN_ABI = parseAbi([
  "function token() view returns (address)",
  "function equityToken() view returns (address)",
  "function identityRegistry() view returns (address)",
  "function policy() view returns (address)",
  "function compliancePolicy() view returns (address)",
]);

const PREFERRED_CLAIM_FN_NAMES = [
  "claim",
  "release",
  "claimFor",
  "releaseFor",
  "claimTo",
  "releaseTo",
  "withdraw",
  "withdrawTo",
];

function findClaimFunction(abi) {
  const fns = abi.filter((x) => x.type === "function");
  for (const name of PREFERRED_CLAIM_FN_NAMES) {
    const matches = fns.filter((f) => f.name === name);
    if (matches.length === 1) return matches[0];

    if (matches.length > 1) {
      const best = matches.find((m) => {
        const ts = m.inputs.map((i) => i.type);
        const ok = ts.every((t) => t === "address" || t.startsWith("uint"));
        return ok && ts.length <= 3;
      });
      if (best) return best;
    }
  }
  return null;
}

// NOTE: use blockNumber (BigInt) not blockTag string, for RPC compatibility
async function bestEffortReadAddress(client, contract, abi, fnNames, blockNumber) {
  for (const fn of fnNames) {
    try {
      const out = await client.readContract({
        address: contract,
        abi,
        functionName: fn,
        args: [],
        blockNumber,
      });
      if (typeof out === "string" && out.startsWith("0x") && out.length === 42) return getAddress(out);
    } catch {}
  }
  return null;
}

function isViewFnCandidate(fn, nameSet) {
  if (fn.type !== "function") return false;
  if (fn.stateMutability !== "view" && fn.stateMutability !== "pure") return false;
  if (!nameSet.has(fn.name)) return false;
  if (!fn.outputs || fn.outputs.length !== 1) return false;
  if (!fn.outputs[0].type.startsWith("uint")) return false;
  return fn.inputs.length === 1 && fn.inputs[0].type === "address";
}

function findFirstViewFn(abi, names) {
  const set = new Set(names);
  const fns = abi.filter((x) => x.type === "function");
  return fns.find((f) => isViewFnCandidate(f, set)) || null;
}

// NOTE: use blockNumber (BigInt) not blockTag string, for RPC compatibility
async function readUintForBeneficiary(client, vesting, abi, fnNames, beneficiary, blockNumber) {
  const fn = findFirstViewFn(abi, fnNames);
  if (!fn) return null;

  const v = await client.readContract({
    address: vesting,
    abi,
    functionName: fn.name,
    args: [beneficiary],
    blockNumber,
  });

  return BigInt(v);
}

// Fallback accumulator for this VestingContract: grants(employee)[1] = released
async function readReleasedFromGrants(client, vesting, abi, beneficiary, blockNumber) {
  try {
    const g = await client.readContract({
      address: vesting,
      abi,
      functionName: "grants",
      args: [beneficiary],
      blockNumber,
    });
    // grants tuple observed: [total, released, start, cliff, duration, active]
    return BigInt(g[1]);
  } catch {
    return null;
  }
}

function toDecStr(x) {
  if (x === null || x === undefined) return null;
  return typeof x === "bigint" ? x.toString() : BigInt(x).toString();
}

function calldataDigestObj(dataHex) {
  return { alg: "keccak256", value: keccak256(dataHex) };
}

// CRITICAL: Prevent NaN -> null in JSON (JSON.stringify converts NaN to null)
function normStatus(s) {
  if (typeof s === "bigint") return s === 1n ? 1 : 0;
  if (typeof s === "number") return Number.isFinite(s) ? s : 0;

  if (typeof s === "string") {
    const sl = s.toLowerCase();
    if (sl === "success") return 1;
    if (sl === "reverted" || sl === "failed" || sl === "failure") return 0;
    if (sl.startsWith("0x")) return parseInt(sl, 16);
    const n = Number(sl);
    return Number.isFinite(n) ? n : 0;
  }

  return 0;
}

function normReceipt(receipt) {
  return {
    status: normStatus(receipt.status),
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    transactionIndex: Number(receipt.transactionIndex),
    gasUsed: receipt.gasUsed?.toString?.() ?? String(receipt.gasUsed),
    effectiveGasPrice: receipt.effectiveGasPrice?.toString?.() ?? String(receipt.effectiveGasPrice),
    cumulativeGasUsed: receipt.cumulativeGasUsed?.toString?.() ?? String(receipt.cumulativeGasUsed),
    logsBloom: receipt.logsBloom,
  };
}

function isoFromUnixSeconds(sec) {
  return new Date(Number(sec) * 1000).toISOString();
}

function safeGetAddress(x) {
  try {
    return getAddress(x);
  } catch {
    return null;
  }
}

function computeTransfers(onchainReceipt, equityTokenMaybe, beneficiary) {
  const transferTopic0 = keccak256("0x" + Buffer.from("Transfer(address,address,uint256)").toString("hex"));

  const transfers = [];
  for (const log of onchainReceipt.logs || []) {
    if (!log?.topics?.length) continue;
    if ((log.topics[0] || "").toLowerCase() !== transferTopic0.toLowerCase()) continue;

    if (equityTokenMaybe) {
      const la = safeGetAddress(log.address);
      if (!la || la !== equityTokenMaybe) continue;
    }

    try {
      const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
      if (decoded?.eventName !== "Transfer") continue;

      const from = getAddress(decoded.args.from);
      const to = getAddress(decoded.args.to);
      const value = BigInt(decoded.args.value);

      transfers.push({
        token: getAddress(log.address),
        from,
        to,
        amount: value.toString(),
      });
    } catch {}
  }

  const tokensToBeneficiary = beneficiary
    ? transfers
        .filter((t) => safeGetAddress(t.to) === beneficiary)
        .reduce((acc, t) => acc + BigInt(t.amount), 0n)
    : 0n;

  const summary = {
    token: equityTokenMaybe || (transfers[0]?.token ? getAddress(transfers[0].token) : zeroAddress),
    from: transfers[0]?.from ? getAddress(transfers[0].from) : zeroAddress,
    to: beneficiary || (transfers[0]?.to ? getAddress(transfers[0].to) : zeroAddress),
    amount: tokensToBeneficiary.toString(),
  };

  return { transfers, tokensToBeneficiary, summary };
}

async function main() {
  if (!VESTING) throw new Error("Set VESTING=0x...");
  if (!BENEFICIARY) throw new Error("Set BENEFICIARY=0x...");

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) throw new Error("Set PRIVATE_KEY=0x... (EOA that will execute the claim)");

  const abi = loadAbiFromArtifacts();
  const claimFn = findClaimFunction(abi);

  if (!claimFn && !INPUT) {
    throw new Error(
      `Could not auto-find a claim/release function.\n` +
        `Searched: ${PREFERRED_CLAIM_FN_NAMES.join(", ")}\n` +
        `Either provide INPUT=/path/to/build-claim-*.json OR tell me the function name.`
    );
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(RPC_URL), account });

  // Build calldata
  let to = VESTING;
  let data = null;
  let requestedAmount = AMOUNT_OEQ; // may remain null

  if (INPUT) {
    const j = JSON.parse(fs.readFileSync(INPUT, "utf8"));
    const t = j?.tx ?? j;
    if (!t?.to) throw new Error("INPUT JSON missing tx.to");
    if (!t?.encodedData && !t?.data) throw new Error("INPUT JSON missing tx.encodedData or tx.data");
    to = getAddress(t.to);
    data = t.encodedData || t.data;
    if (!isHex(data)) throw new Error("INPUT tx data is not hex");
    if (t?.argsHuman?.amountBaseUnits_OEQ_decimals0) {
      requestedAmount = BigInt(t.argsHuman.amountBaseUnits_OEQ_decimals0);
    }
  } else {
    // Auto-build args based on claim function inputs:
    // - address => BENEFICIARY
    // - first uint => AMOUNT_OEQ (required if exists)
    // - other uints => 0
    let uintCount = 0;
    const args = (claimFn.inputs || []).map((inp) => {
      if (inp.type === "address") return BENEFICIARY;

      if (inp.type.startsWith("uint")) {
        uintCount += 1;
        if (uintCount === 1) {
          if (AMOUNT_OEQ === null) throw new Error(`Claim function needs uint amount; set AMOUNT_OEQ=...`);
          return AMOUNT_OEQ;
        }
        return 0n;
      }

      throw new Error(`Unsupported param type in ${claimFn.name}: ${inp.type}`);
    });

    data = encodeFunctionData({ abi, functionName: claimFn.name, args });
  }

  if (!data) throw new Error("Failed to construct tx data");

  const calldataDigest = calldataDigestObj(data);
  const nonce = await publicClient.getTransactionCount({ address: account.address });

  // Execute (or recover)
  let txHash = TX;

  if (!txHash) {
    txHash = await walletClient.sendTransaction({
      account,
      to,
      data,
      value: 0n,
    });
    console.log("txHash:", txHash);
  } else {
    console.log("recovering txHash:", txHash);
  }

  // Receipt
  const rawReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const receipt = normReceipt(rawReceipt);

  // Block timestamp (fallback to blockHash if number lookup lags)
  let blk;
  try {
    blk = await publicClient.getBlock({ blockNumber: BigInt(receipt.blockNumber) });
  } catch {
    blk = await publicClient.getBlock({ blockHash: receipt.blockHash });
  }
  const blockTimestamp = Number(blk.timestamp);

  // Deterministic state reads at anchored blocks
  const blockNumberBefore = BigInt(receipt.blockNumber - 1);
  const blockNumberAfter = BigInt(receipt.blockNumber);

  // Claimed accumulator:
  // Prefer claimed/released-style view fn if present, otherwise fallback to grants(employee)[1] (released)
  let claimedBefore = await readUintForBeneficiary(
    publicClient,
    VESTING,
    abi,
    ["claimed", "claimedAmount", "claimedOf", "released", "releasedAmount", "releasedOf"],
    BENEFICIARY,
    blockNumberBefore
  );

  let claimedAfter = await readUintForBeneficiary(
    publicClient,
    VESTING,
    abi,
    ["claimed", "claimedAmount", "claimedOf", "released", "releasedAmount", "releasedOf"],
    BENEFICIARY,
    blockNumberAfter
  );

  if (claimedBefore === null || claimedAfter === null) {
    const rPre = await readReleasedFromGrants(publicClient, VESTING, abi, BENEFICIARY, blockNumberBefore);
    const rPost = await readReleasedFromGrants(publicClient, VESTING, abi, BENEFICIARY, blockNumberAfter);
    if (rPre !== null && rPost !== null) {
      claimedBefore = rPre;
      claimedAfter = rPost;
    }
  }

  const releasableBefore = await readUintForBeneficiary(
    publicClient,
    VESTING,
    abi,
    ["releasable", "releasableAmount", "available", "claimable", "claimableAmount"],
    BENEFICIARY,
    blockNumberBefore
  );

  const releasableAfter = await readUintForBeneficiary(
    publicClient,
    VESTING,
    abi,
    ["releasable", "releasableAmount", "available", "claimable", "claimableAmount"],
    BENEFICIARY,
    blockNumberAfter
  );

  const vestedBefore = await readUintForBeneficiary(
    publicClient,
    VESTING,
    abi,
    ["vestedAmount", "vested", "totalVested", "totalVestedAmount"],
    BENEFICIARY,
    blockNumberBefore
  );

  const vestedAfter = await readUintForBeneficiary(
    publicClient,
    VESTING,
    abi,
    ["vestedAmount", "vested", "totalVested", "totalVestedAmount"],
    BENEFICIARY,
    blockNumberAfter
  );

  // Best-effort contract discovery at AFTER block
  const equityToken =
    EQUITY_TOKEN_ENV ||
    (await bestEffortReadAddress(publicClient, VESTING, GETTERS_MIN_ABI, ["equityToken", "token"], blockNumberAfter)) ||
    zeroAddress;

  const identityRegistry =
    IDENTITY_REGISTRY_ENV ||
    (await bestEffortReadAddress(publicClient, VESTING, GETTERS_MIN_ABI, ["identityRegistry"], blockNumberAfter)) ||
    zeroAddress;

  const policy =
    POLICY_ENV ||
    (await bestEffortReadAddress(publicClient, VESTING, GETTERS_MIN_ABI, ["policy", "compliancePolicy"], blockNumberAfter)) ||
    zeroAddress;

  const equityTokenFilter = equityToken !== zeroAddress ? equityToken : null;

  const { transfers, tokensToBeneficiary, summary } = computeTransfers(
    rawReceipt,
    equityTokenFilter,
    BENEFICIARY
  );

  const claimedIncrease =
    claimedBefore !== null && claimedAfter !== null ? claimedAfter - claimedBefore : null;

  const payload = {
    schema: "claim-receipt-v1",
    type: "claim-receipt",
    chain: { chainId: 84532, name: "base-sepolia" },

    tx: {
      hash: txHash,
      from: account.address,
      to,
      data,
      nonce: Number(nonce),
    },

    receipt,

    block: {
      timestamp: blockTimestamp,
      timestampISO: isoFromUnixSeconds(blockTimestamp),
    },

    contracts: {
      vesting: VESTING,
      equityToken,
      identityRegistry,
      policy,
    },

    claim: {
      beneficiary: BENEFICIARY,
      operator: account.address,
      requestedAmount: requestedAmount ? requestedAmount.toString() : "0",
      calldataDigest,
    },

    state: {
      before: {
        claimed: toDecStr(claimedBefore) ?? "0",
        releasable: toDecStr(releasableBefore) ?? "0",
        vested: toDecStr(vestedBefore) ?? "0",
      },
      after: {
        claimed: toDecStr(claimedAfter) ?? "0",
        releasable: toDecStr(releasableAfter) ?? "0",
        vested: toDecStr(vestedAfter) ?? "0",
      },
      delta: {
        claimedIncrease: claimedIncrease !== null ? claimedIncrease.toString() : "0",
        tokensTransferred: tokensToBeneficiary.toString(),
      },
    },

    events: {
      decoded: transfers,
      transferSummary: summary,
    },

    verification: {
      rules: { deterministicBlockTags: { before: "blockNumber-1", after: "blockNumber" } },
      checks: {
        receiptStatus: receipt.status === 1,
        claimedIncreasePositive: claimedIncrease !== null ? claimedIncrease > 0n : null,
        transferMatchesClaimedDelta: claimedIncrease !== null ? tokensToBeneficiary === claimedIncrease : null,
      },
    },
  };

  // Write evidence
  const evidenceDir = path.resolve(`evidence/${PHASE}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const ts = nowIsoSafe();

  const outPath = path.join(evidenceDir, `claim-receipt-${ts}.json`);
  const latestPath = path.join(evidenceDir, `claim-receipt.latest.json`);

  writeJsonDeterministic(outPath, payload);
  copyLatest(latestPath, outPath);

  const execOut = path.join(evidenceDir, `execute-claim-${ts}.json`);
  const execLatest = path.join(evidenceDir, `execute-claim.latest.json`);

  writeJsonDeterministic(execOut, {
    schema: "phase-6.2.execute-claim.v1",
    phase: PHASE,
    at: new Date().toISOString(),
    network: { name: "Base Sepolia", chainId: 84532 },
    rpc: RPC_URL,
    vesting: VESTING,
    beneficiary: BENEFICIARY,
    operator: account.address,
    txHash,
    calldataDigest,
    receipt: payload.receipt,
    input: INPUT || null,
    recoveryTx: TX || null,
  });

  copyLatest(execLatest, execOut);

  console.log("✅ wrote:", outPath);
  console.log("✅ latest ->", latestPath);
  console.log("✅ wrote:", execOut);
  console.log("✅ latest ->", execLatest);
}

main().catch((e) => {
  console.error("❌ execute-claim failed:", e?.message || e);
  process.exit(1);
});
