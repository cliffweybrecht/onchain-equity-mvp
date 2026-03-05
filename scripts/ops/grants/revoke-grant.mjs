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

function isHex32(x) {
  return typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
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
  console.log(`Usage (revocation == IdentityRegistry restriction):
  PRIVATE_KEY=... BASE_SEPOLIA_RPC_URL=... VESTING=... IDENTITY_REGISTRY=...
  BENEFICIARY=0x... GRANT_ID=0x... REVOKE_REASON="..." \\
    node scripts/ops/grants/revoke-grant.mjs

Or flags:
  node scripts/ops/grants/revoke-grant.mjs \\
    --employee 0x... --grant-id 0x... --reason "Termination" \\
    --vesting 0x... --registry 0x... \\
    [--out manifests/grants] [--evidence evidence/phase-7/grants] [--no-send]

What it does:
  - Writes a deterministic revoke-manifest (op=revoke)
  - Sends IdentityRegistry.setStatus(employee, 2) (Restricted) :contentReference[oaicite:2]{index=2}
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

const grantId = arg("--grant-id") || process.env.GRANT_ID;
if (!grantId || !isHex32(grantId)) die("Need --grant-id / GRANT_ID (0x + 64 hex chars)");

const reason = arg("--reason") || process.env.REVOKE_REASON || "";
if (typeof reason !== "string" || reason.length === 0) die("Need non-empty --reason / REVOKE_REASON");

const outDir = path.resolve(arg("--out") || "manifests/grants");
const evRoot = path.resolve(arg("--evidence") || "evidence/phase-7/grants");
const noSend = has("--no-send");

// --- Clients
const account = privateKeyToAccount(pk);
const pc = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const wc = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

const registryAbi = parseAbi([
  "function setStatus(address user, uint8 newStatus)",
  "function getStatus(address user) view returns (uint8)"
]);

// --- Snapshot
const head = await pc.getBlock({ blockTag: "latest" });
const headNum = Number(head.number);
const headTs = Number(head.timestamp);

// --- Build deterministic revoke-manifest
const payload = {
  op: "revoke",
  chainName: "baseSepolia",
  chainId: 84532,
  rpcHint: rpcUrl,
  vestingContract: vesting,
  identityRegistry: registry,
  issuer: account.address,
  employee,
  createdAt: nowIso(),
  grantId,
  details: {
    total: "0",
    start: 0,
    cliff: 0,
    duration: 1,
    notes: `Revocation of ${grantId}`,
    revocation: { status: 2, reason }
  }
};

const id = sha256Hex(canonStringify(payload));
const manifest = { schema: "grant-manifest-v1", id, payload };

// --- Write manifest
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
  employee,
  grantId
});

// 02.manifest
writeJson(path.join(evDir, "02.manifest.json"), manifest);

// 03.calldata
const calldata = encodeFunctionData({
  abi: registryAbi,
  functionName: "setStatus",
  args: [employee, 2]
});
writeJson(path.join(evDir, "03.calldata.json"), {
  to: registry,
  function: "setStatus(address,uint8)",
  args: { employee, newStatus: 2, reason },
  data: calldata,
  manifestId: id,
  revokesGrantId: grantId
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
  address: registry,
  abi: registryAbi,
  functionName: "setStatus",
  args: [employee, 2],
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

// 06.verify (read status)
const status = await pc.readContract({
  address: registry,
  abi: registryAbi,
  functionName: "getStatus",
  args: [employee]
});

const ok = Number(status) === 2;

writeJson(path.join(evDir, "06.verify.json"), {
  manifestId: id,
  employee,
  expectedStatus: 2,
  observedStatus: Number(status),
  ok
});

if (!ok) die("Post-state status != 2. See 06.verify.json");

console.log("✅ Verified IdentityRegistry status=2 (restricted).");
