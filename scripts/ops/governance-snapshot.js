import "dotenv/config";
import fs from "fs";
import path from "path";
import { createPublicClient, http, parseAbi, isAddress } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const ADDRS = {
  SAFE: "0x1eDc758579C66967C42066e8dDCB690a1651517e",
  DEPLOYER_EOA: "0x6C775411e11cAb752Af03C5BBb440618788E13Be",

  EquityTokenV2: "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17",
  IdentityRegistry: "0x9d6831ccb9d6f971cb648b538448d175650cfea4",
  VestingContract: "0xef444c538769d7626511a4c538d03ffc7e53262b",

  EmergencyFreezePolicyV2: "0x7df0bb151637c8cc18642fd9aa005b1d418fc7bb",
  ComplianceGatedPolicyV1: "0x38c905c289b3ef1a244d95c8b1925a37c34839c8",
  MinAmountPolicyV1: "0x97c9a7b6155ca7a794ee23f48c33427a4adb3cf8",

  CompositePolicyV111: "0xa5dc56eb13a625584c128ad056c23d6e9035f814",
  policyStackId: "BASESEP-84532-STACK-2026-01-28-v1.3-recover1",
};

for (const [k, v] of Object.entries(ADDRS)) {
  if (k.endsWith("Id")) continue;
  if (typeof v === "string" && v.startsWith("0x") && !isAddress(v)) {
    throw new Error(`Bad address for ${k}: ${v}`);
  }
}

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

const ABI_COMMON = parseAbi([
  "function admin() view returns (address)",
  "function owner() view returns (address)",
  "function governance() view returns (address)",
  "function authority() view returns (address)",
  "function getAdmin() view returns (address)",
  "function getOwner() view returns (address)",
]);

const ABI_FREEZE = parseAbi([
  "function frozen() view returns (bool)",
  "function isFrozen() view returns (bool)",
]);

async function getCodeSize(addr) {
  const code = await client.getBytecode({ address: addr });
  return code ? (code.length - 2) / 2 : 0;
}

async function tryRead(address, abi, fn, args = []) {
  try {
    const res = await client.readContract({ address, abi, functionName: fn, args });
    return { ok: true, value: res };
  } catch (e) {
    return { ok: false, error: (e?.shortMessage || e?.message || String(e)).slice(0, 200) };
  }
}

async function resolveSurface(address, abi, fns) {
  const out = {};
  for (const fn of fns) {
    const r = await tryRead(address, abi, fn);
    if (r.ok) out[fn] = r.value;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function matchRole(surface, addr) {
  return Object.values(surface || {}).some(
    (v) => typeof v === "string" && v.toLowerCase() === addr.toLowerCase()
  );
}

(async () => {
  const chainId = await client.getChainId();
  const block = await client.getBlockNumber();

  const targets = [
    ["EquityTokenV2", ADDRS.EquityTokenV2],
    ["IdentityRegistry", ADDRS.IdentityRegistry],
    ["VestingContract", ADDRS.VestingContract],
    ["EmergencyFreezePolicyV2", ADDRS.EmergencyFreezePolicyV2],
    ["ComplianceGatedPolicyV1", ADDRS.ComplianceGatedPolicyV1],
    ["MinAmountPolicyV1", ADDRS.MinAmountPolicyV1],
    ["CompositePolicyV111", ADDRS.CompositePolicyV111],
  ];

  const snapshot = {
    meta: {
      part: "3.9",
      purpose: "Governance/admin surface snapshot + frozen state + evidence capture",
      timestamp: nowIso(),
      rpc: RPC,
      chainId,
      blockNumber: block.toString(),
      policyStackId: ADDRS.policyStackId,
      SAFE: ADDRS.SAFE,
      deployerEOA: ADDRS.DEPLOYER_EOA,
    },
    contracts: {},
    invariants: {},
  };

  for (const [name, addr] of targets) {
    const adminSurface = await resolveSurface(
      addr,
      ABI_COMMON,
      ["admin", "owner", "governance", "authority", "getAdmin", "getOwner"]
    );

    const frozenSurface = await resolveSurface(
      addr,
      ABI_FREEZE,
      ["frozen", "isFrozen"]
    );

    snapshot.contracts[name] = {
      address: addr,
      codeSizeBytes: await getCodeSize(addr),
      adminSurface,
      frozenSurface,
    };

    snapshot.invariants[name] = {
      safeIsAdmin: matchRole(adminSurface, ADDRS.SAFE),
      deployerIsAdmin: matchRole(adminSurface, ADDRS.DEPLOYER_EOA),
    };
  }

  const outPath = path.resolve(
    "evidence/part-3.9",
    `governance-snapshot-${chainId}-${block}.json`
  );

  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  console.log("\\n== Part 3.9 Governance Snapshot ==");
  console.log("chainId:", chainId);
  console.log("block:", block.toString());
  console.log("policyStackId:", ADDRS.policyStackId);
  console.log("SAFE:", ADDRS.SAFE);
  console.log("Deployer EOA:", ADDRS.DEPLOYER_EOA);
  console.log("Wrote:", outPath);
})().catch((e) => {
  console.error("\\n❌ Snapshot failed:", e?.shortMessage || e?.message || e);
  process.exit(1);
});
