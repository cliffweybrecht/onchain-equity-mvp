import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const DEFAULT_RPC = "https://sepolia.base.org";

const VESTING_DEFAULT = "0xEf444C538769d7626511A4C538d03fFc7e53262B";
const BENEFICIARY_DEFAULT = "0xf7e66Def3745C6642E8bF24c88FEb0501d313F72";

/* ------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------ */

function isoForFilename(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function stringifyWithBigInt(obj) {
  return JSON.stringify(
    obj,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );
}

function writeEvidence(dir, baseName, obj) {
  ensureDir(dir);

  const ts = isoForFilename();
  const stamped = path.join(dir, `${baseName}.${ts}.json`);
  const latest = path.join(dir, `${baseName}.latest.json`);

  fs.writeFileSync(stamped, stringifyWithBigInt(obj) + "\n", "utf-8");
  fs.copyFileSync(stamped, latest);

  return { stamped, latest };
}

function shortErr(e) {
  if (!e) return "unknown error";
  return (e.shortMessage || e.message || String(e)).slice(0, 300);
}

async function safeRead(client, spec) {
  try {
    const value = await client.readContract({
      address: spec.address,
      abi: spec.abi,
      functionName: spec.functionName,
      args: spec.args ?? [],
      blockNumber: spec.blockNumber,
    });

    return {
      ok: true,
      functionName: spec.functionName,
      args: spec.args ?? [],
      value,
    };
  } catch (e) {
    return {
      ok: false,
      functionName: spec.functionName,
      args: spec.args ?? [],
      error: shortErr(e),
    };
  }
}

/* ------------------------------------------------------------ */
/* Main */
/* ------------------------------------------------------------ */

async function main() {
  const rpcUrl = process.env.RPC_URL || DEFAULT_RPC;
  const vesting = process.env.VESTING || VESTING_DEFAULT;
  const beneficiary = process.env.BENEFICIARY || BENEFICIARY_DEFAULT;

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  /* ---------------- PIN BLOCK ---------------- */

  const latestBlock = await client.getBlockNumber();
  const pinnedBlock = process.env.PINNED_BLOCK
    ? BigInt(process.env.PINNED_BLOCK)
    : latestBlock;

  const pinned = await client.getBlock({ blockNumber: pinnedBlock });

  const pinnedTimestamp =
    typeof pinned.timestamp === "bigint"
      ? Number(pinned.timestamp)
      : pinned.timestamp;

  /* ---------------- READ GRANT ---------------- */

  const grantsAbi = [{
    type: "function",
    name: "grants",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "bool" },
    ],
  }];

  const grantRead = await safeRead(client, {
    address: vesting,
    abi: grantsAbi,
    functionName: "grants",
    args: [beneficiary],
    blockNumber: pinnedBlock,
  });

  let grant = null;

  if (grantRead.ok) {
    const [total, claimed, start, cliff, duration, exists] =
      grantRead.value;

    grant = {
      total: total.toString(),
      claimed: claimed.toString(),
      start: Number(start),
      cliff: Number(cliff),
      duration: Number(duration),
      exists: Boolean(exists),
    };
  }

  /* ---------------- EXPECTED VESTING MATH ---------------- */

  let expected = null;

  if (grant && grant.exists) {
    const now = pinnedTimestamp;
    const total = BigInt(grant.total);
    const claimed = BigInt(grant.claimed);
    const start = grant.start;
    const cliff = grant.cliff;
    const duration = grant.duration;

    let status;

    if (now < start || now < cliff) {
      status = "pre-start-or-pre-cliff";
    } else if (now >= start + duration) {
      status = "fully-vested";
    } else {
      status = "in-vesting-window";
    }

    let vested = 0n;

    if (status === "fully-vested") {
      vested = total;
    } else if (status === "in-vesting-window") {
      const elapsed = BigInt(now - start);
      vested = (total * elapsed) / BigInt(duration);
    }

    let claimable = vested - claimed;
    if (claimable < 0n) claimable = 0n;

    expected = {
      pinnedTimestamp: now,
      start,
      cliff,
      duration,
      total: total.toString(),
      claimed: claimed.toString(),
      status,
      expectedVested: vested.toString(),
      expectedClaimable: claimable.toString(),
      assumption:
        "Linear vesting from start over duration; zero before start/cliff.",
    };
  } else {
    expected = {
      pinnedTimestamp,
      note: "Grant missing or does not exist at pinned block.",
    };
  }

  /* ---------------- PROBE COMMON VIEW FUNCTIONS ---------------- */

  const candidates = [
    ["vestedAmount", 1],
    ["vestedAmount", 2],
    ["claimable", 1],
    ["claimable", 2],
    ["available", 1],
    ["available", 2],
    ["releasableAmount", 1],
    ["releasableAmount", 2],
  ];

  const probeResults = [];

  for (const [name, arity] of candidates) {
    const abi = [{
      type: "function",
      name,
      stateMutability: "view",
      inputs: Array.from({ length: arity }, (_, i) => ({
        type: i === 0 ? "address" : "uint256",
      })),
      outputs: [{ type: "uint256" }],
    }];

    const args =
      arity === 1
        ? [beneficiary]
        : [beneficiary, BigInt(pinnedTimestamp)];

    const result = await safeRead(client, {
      address: vesting,
      abi,
      functionName: name,
      args,
      blockNumber: pinnedBlock,
    });

    if (result.ok && typeof result.value === "bigint") {
      result.value = result.value.toString();
    }

    probeResults.push(result);
  }

  /* ---------------- EVIDENCE OBJECT ---------------- */

  const evidence = {
    phase: "6.1.H",
    description:
      "Vesting math verification — pinned block, read-only, no state changes",
    network: {
      name: "Base Sepolia",
      chainId: 84532,
      rpc: rpcUrl,
    },
    addresses: {
      vestingContract: vesting,
      beneficiary,
    },
    pinned: {
      blockNumber: pinnedBlock.toString(),
      blockHash: pinned.hash,
      timestamp: pinnedTimestamp,
    },
    reads: {
      grant: grantRead.ok ? grant : { error: grantRead.error },
      vestingMathProbes: probeResults,
    },
    expected,
    guarantees: [
      "All reads pinned to single blockNumber",
      "No state-changing operations executed",
      "Direct RPC only (no hre)",
    ],
  };

  const outDir = path.join("evidence", "phase-6.1.H");

  const { stamped, latest } = writeEvidence(
    outDir,
    "vesting-math-pinned",
    evidence
  );

  console.log("✅ Phase 6.1.H evidence written");
  console.log("Stamped:", stamped);
  console.log("Latest:", latest);
  console.log("Pinned Block:", pinnedBlock.toString());
  console.log("Pinned Timestamp:", pinnedTimestamp);
  console.log("Expected:", expected);
}

main().catch((err) => {
  console.error("❌ ERROR:", err);
  process.exit(1);
});
