import "dotenv/config";
import fs from "fs";
import path from "path";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const SAFE = "0x1eDc758579C66967C42066e8dDCB690a1651517e";
const DEPLOYER = "0x6C775411e11cAb752Af03C5BBb440618788E13Be";

// If true, token admin != SAFE is a FAIL (recommended for prod).
// Default false: token admin mismatch shows WARN (acceptable for testnet/pilot).
const STRICT_TOKEN_ADMIN = process.env.STRICT_TOKEN_ADMIN === "true";

const ADDRS = {
  EquityTokenV2: "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17",
  IdentityRegistry: "0x9d6831ccb9d6f971cb648b538448d175650cfea4",
  VestingContract: "0xef444c538769d7626511a4c538d03ffc7e53262b",
  EmergencyFreezePolicyV2: "0x7df0bb151637c8cc18642fd9aa005b1d418fc7bb",
  ComplianceGatedPolicyV1: "0x38c905c289b3ef1a244d95c8b1925a37c34839c8",
  MinAmountPolicyV1: "0x97c9a7b6155ca7a794ee23f48c33427a4adb3cf8",
  CompositePolicyV111: "0xa5dc56eb13a625584c128ad056c23d6e9035f814",
  policyStackId: "BASESEP-84532-STACK-2026-01-28-v1.3-recover1",
};

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

const ABI_ADMIN = parseAbi(["function admin() view returns (address)"]);
const ABI_FROZEN = parseAbi(["function frozen() view returns (bool)"]);

function eq(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

async function readAdmin(addr) {
  return client.readContract({ address: addr, abi: ABI_ADMIN, functionName: "admin" });
}

async function readFrozen(addr) {
  return client.readContract({ address: addr, abi: ABI_FROZEN, functionName: "frozen" });
}

(async () => {
  const chainId = await client.getChainId();
  const block = await client.getBlockNumber();

  const report = {
    meta: {
      part: "3.9",
      timestamp: new Date().toISOString(),
      rpc: RPC,
      chainId,
      blockNumber: block.toString(),
      policyStackId: ADDRS.policyStackId,
      SAFE,
      deployerEOA: DEPLOYER,
      strictTokenAdmin: STRICT_TOKEN_ADMIN,
    },
    checks: [],
    status: "PASS",
  };

  async function checkAdmin(name, addr, mustBeSafe, warnOnly = false) {
    const value = await readAdmin(addr);
    const passed = eq(value, SAFE);
    const severity = mustBeSafe ? "FAIL" : (warnOnly ? "WARN" : "FAIL");
    report.checks.push({ type: "admin", name, address: addr, value, expected: SAFE, passed, severity });

    if (mustBeSafe && !passed) report.status = "FAIL";
    if (warnOnly && STRICT_TOKEN_ADMIN && !passed) report.status = "FAIL";
  }

  async function checkFrozen(name, addr) {
    const value = await readFrozen(addr);
    const passed = (value === false);
    report.checks.push({ type: "frozen", name, address: addr, value, expected: false, passed, severity: "FAIL" });
    if (!passed) report.status = "FAIL";
  }

  // SAFE-governed components (must be SAFE)
  await checkAdmin("IdentityRegistry", ADDRS.IdentityRegistry, true);
  await checkAdmin("VestingContract", ADDRS.VestingContract, true);
  await checkAdmin("CompositePolicyV111", ADDRS.CompositePolicyV111, true);
  await checkAdmin("ComplianceGatedPolicyV1", ADDRS.ComplianceGatedPolicyV1, true);
  await checkAdmin("MinAmountPolicyV1", ADDRS.MinAmountPolicyV1, true);

  // Token admin: WARN by default; FAIL if STRICT_TOKEN_ADMIN=true
  await checkAdmin("EquityTokenV2", ADDRS.EquityTokenV2, false, true);

  // Freeze must be false outside incidents
  await checkFrozen("EmergencyFreezePolicyV2", ADDRS.EmergencyFreezePolicyV2);

  const outPath = path.resolve("evidence/part-3.9", `stack-health-${chainId}-${block}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\\n== STACK HEALTH ==");
  console.log("status:", report.status);
  console.log("block:", block.toString());
  console.log("strictTokenAdmin:", STRICT_TOKEN_ADMIN);
  console.log("wrote:", outPath);
  for (const c of report.checks) {
    const tag = c.passed ? "OK" : c.severity;
    console.log(`${tag} - ${c.type} - ${c.name} - ${c.value}`);
  }

  if (report.status !== "PASS") process.exitCode = 2;
})().catch((e) => {
  console.error("❌ stack-health failed:", e?.shortMessage || e?.message || e);
  process.exit(1);
});
