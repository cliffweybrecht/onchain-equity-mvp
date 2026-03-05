#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { canonStringify, sha256Hex } from "../../lib/canon.mjs";

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

function has(name) {
  return process.argv.includes(name);
}

function isAddress(x) {
  return typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file, obj) {
  fs.writeFileSync(file, canonStringify(obj), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

if (has("--help")) {
  console.log(`Usage (env-driven):
  PRIVATE_KEY=... BASE_SEPOLIA_RPC_URL=... VESTING=... IDENTITY_REGISTRY=...
  BENEFICIARY=0x... GRANT_TOTAL=100 START=... CLIFF=... DURATION=...
  NOTES="..." node scripts/ops/grants/create-grant.mjs

Usage (explicit flags override env):
  node scripts/ops/grants/create-grant.mjs \\
    --employee 0x... --total 100 --start 1730000000 --cliff 1730003600 --duration 31536000 \\
    --vesting 0x... --registry 0x... --notes "Offer letter v1" \\
    [--out manifests/grants] [--evidence evidence/phase-7/grants] [--no-send]

Notes:
  - Deterministic manifest id = sha256Hex(canonStringify(payload))
  - Evidence directory created at evidence/phase-7/grants/<id>/
`);
  process.exit(0);
}

// --- Inputs
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
if (!pk) die("Missing PRIVATE_KEY");

const vesting = arg("--vesting") || process.env.VESTING;
const registry = arg("--registry") || process.env.IDENTITY_REGISTRY;
if (!vesting || !registry) die("Need VESTING and IDENTITY_REGISTRY (or --vesting/--registry)");
if (!isAddress(vesting)) die("VESTING must be an address");
if (!isAddress(registry)) die("IDENTITY_REGISTRY must be an address");

const employee = arg("--employee") || process.env.BENEFICIARY;
if (!employee) die("Need employee via --employee or BENEFICIARY");
if (!isAddress(employee)) die("employee must be an address");

const totalStr = arg("--total") || process.env.GRANT_TOTAL;
if (!totalStr || !/^[0-9]+$/.test(totalStr)) die("Need numeric total via --total or GRANT_TOTAL");
const total = BigInt(totalStr);

const start = Number(arg("--start") || process.env.START || "");
const cliff = Number(arg("--cliff") || process.env.CLIFF || "");
const duration = Number(arg("--duration") || process.env.DURATION || "");

if (!Number.isInteger(start) || start < 0) die("start must be int >= 0 (unix seconds)");
if (!Number.isInteger(cliff) || cliff < 0) die("cliff must be int >= 0 (unix seconds)");
if (!Number.isInteger(duration) || duration < 1) die("duration must be int >= 1 (seconds)");
if (cliff < start) die("cliff must be >= start");

const notes = arg("--notes") || process.env.NOTES || "";
if (typeof notes !== "string") die("notes must be a string");

const outDir = path.resolve(arg("--out") || "manifests/grants");
const evRoot = path.resolve(arg("--evidence") || "evidence/phase-7/grants");
const noSend = has("--no-send");

// --- Clients
const account = privateKeyToAccount(pk);
const pc = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const wc = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

const vestingAbi = parseAbi([
  "function createGrant(address employee, uint256 total, uint64 start, uint64 cliff, uint64 duration)",
  "function grants(address) view returns (uint256 total,uint256 released,uint64 start,uint64 cliff,uint64 duration,bool exists)"
]);

// --- Snapshot (for evidence)
const head = await pc.getBlock({ blockTag: "latest" });
const headNum = Number(head.number);
const headTs = Number(head.timestamp);

// --- Build deterministic manifest
const payload = {
  op: "create",
  chainName: "baseSepolia",
  chainId: 84532,
  rpcHint: rpcUrl,
  vestingContract: vesting,
  identityRegistry: registry,
  issuer: account.address,
  employee,
  createdAt: nowIso(),
  details: {
    total: total.toString(),
    start,
    cliff,
    duration,
    notes
  }
};

const id = sha256Hex(canonStringify(payload));
const manifest = { schema: "grant-manifest-v1", id, payload };

// --- Write manifest to manifests/grants/<id>.json
ensureDir(outDir);
const manifestPath = path.join(outDir, `${id}.json`);
writeJson(manifestPath, manifest);

// --- Evidence directory
const evDir = path.join(evRoot, id);
ensureDir(evDir);

// 01.snapshot
writeJson(path.join(evDir, "01.snapshot.json"), {
  chainName: "baseSepolia",
  chainId: 84532,
  rpcUrl,
  head: {
    blockNumber: headNum,
    blockTimestamp: headTs,
    blockTimeIso: new Date(headTs * 1000).toISOString()
  },
  contracts: { vesting, identityRegistry: registry },
  issuer: account.address,
  employee
});

// 02.manifest
writeJson(path.join(evDir, "02.manifest.json"), manifest);

// 03.calldata
const calldata = encodeFunctionData({
  abi: vestingAbi,
  functionName: "createGrant",
  args: [employee, total, BigInt(start), BigInt(cliff), BigInt(duration)]
});
writeJson(path.join(evDir, "03.calldata.json"), {
  to: vesting,
  function: "createGrant(address,uint256,uint64,uint64,uint64)",
  args: { employee, total: total.toString(), start, cliff, duration },
  data: calldata,
  manifestId: id
});

console.log("✅ Manifest written:", manifestPath);
console.log("manifest id:", id);
console.log("evidence dir:", evDir);

if (noSend) {
  console.log("⚠️  --no-send set, skipping transaction broadcast.");
  process.exit(0);
}

// 04.execution (simulate + send)
const sim = await pc.simulateContract({
  address: vesting,
  abi: vestingAbi,
  functionName: "createGrant",
  args: [employee, total, BigInt(start), BigInt(cliff), BigInt(duration)],
  account
});

writeJson(path.join(evDir, "04.execution.json"), {
  request: {
    to: sim.request.address,
    functionName: sim.request.functionName,
    args: sim.request.args?.map((x) => (typeof x === "bigint" ? x.toString() : x)),
    account: account.address
  },
  gas: sim.request.gas?.toString?.() || null
});

const txHash = await wc.writeContract(sim.request);

// 05.receipt
const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
writeJson(path.join(evDir, "05.receipt.json"), receipt);
console.log("tx:", txHash, "status:", receipt.status, "block:", Number(receipt.blockNumber));

// 06.verify (read stored grant)
const stored = await pc.readContract({
  address: vesting,
  abi: vestingAbi,
  functionName: "grants",
  args: [employee]
});

const storedObj = {
  total: stored[0].toString(),
  released: stored[1].toString(),
  start: Number(stored[2]),
  cliff: Number(stored[3]),
  duration: Number(stored[4]),
  exists: Boolean(stored[5])
};

const matches =
  storedObj.exists === true &&
  storedObj.total === total.toString() &&
  storedObj.start === start &&
  storedObj.cliff === cliff &&
  storedObj.duration === duration;

writeJson(path.join(evDir, "06.verify.json"), {
  manifestId: id,
  employee,
  expected: payload.details,
  stored: storedObj,
  ok: matches
});

if (!matches) {
  die("Post-state does not match manifest. See 06.verify.json");
}

console.log("✅ Verified on-chain grant matches manifest.");
