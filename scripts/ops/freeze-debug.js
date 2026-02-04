import "dotenv/config";
import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
const DEPLOY_FILE = path.resolve("deployments/base-sepolia.json");

function req(name, v) {
  if (!v) throw new Error(`Missing required field: ${name}`);
  return v;
}

function norm(label, addr) {
  try {
    return getAddress(addr);
  } catch {
    throw new Error(`${label} invalid address: ${addr}`);
  }
}

async function tryRead(client, address, sig, fn, args = []) {
  try {
    const abi = parseAbi([sig]);
    const value = await client.readContract({ address, abi, functionName: fn, args });
    return { ok: true, sig, value };
  } catch (e) {
    return { ok: false, sig, err: e };
  }
}

async function main() {
  if (!pk) throw new Error("Missing PRIVATE_KEY in env");
  if (!fs.existsSync(DEPLOY_FILE)) throw new Error(`Missing ${DEPLOY_FILE}`);
  const d = JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));

  const active = req("active", d.active);
  const stacks = req("policyStacks", d.policyStacks);
  const policyStackId = req("active.policyStackId", active.policyStackId);
  const stack = req(`policyStacks[${policyStackId}]`, stacks[policyStackId]);
  const children = req("childPolicies", stack.childPolicies);

  const emergencyRaw =
    children.find((x) => String(x.name).includes("EmergencyFreezePolicyV2"))?.address;
  if (!emergencyRaw) throw new Error("EmergencyFreezePolicyV2 not found in active childPolicies");

  const emergency = norm("EmergencyFreezePolicyV2", emergencyRaw);

  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

  console.log("\n== FREEZE DEBUG ==");
  console.log("RPC:", rpcUrl);
  console.log("Caller:", account.address);
  console.log("EmergencyFreezePolicyV2:", emergency);

  // Confirm frozen() is readable
  const abiFreeze = parseAbi([
    "function freeze()",
    "function unfreeze()",
    "function frozen() view returns (bool)",
  ]);

  try {
    const fr = await publicClient.readContract({ address: emergency, abi: abiFreeze, functionName: "frozen" });
    console.log("frozen():", fr);
  } catch {
    console.log("⚠️ frozen() not readable (unexpected since your freeze.js read it). Continuing.");
  }

  // Try common admin/owner patterns
  const adminReads = [
    ["owner()", "function owner() view returns (address)", "owner"],
    ["admin()", "function admin() view returns (address)", "admin"],
    ["getAdmin()", "function getAdmin() view returns (address)", "getAdmin"],
    ["emergencyAdmin()", "function emergencyAdmin() view returns (address)", "emergencyAdmin"],
    ["guardian()", "function guardian() view returns (address)", "guardian"],
    ["controller()", "function controller() view returns (address)", "controller"],
    ["governor()", "function governor() view returns (address)", "governor"],
  ];

  console.log("\nAdmin/Owner readbacks (best-effort):");
  for (const [label, sig, fn] of adminReads) {
    const r = await tryRead(publicClient, emergency, sig, fn);
    if (r.ok) console.log(`✅ ${label} ->`, String(r.value));
  }
  console.log("Note: missing lines here just means that getter doesn’t exist.\n");

  // If it’s AccessControl, this often exists:
  // hasRole(bytes32,address) + DEFAULT_ADMIN_ROLE()
  const accessControlChecks = [
    ["DEFAULT_ADMIN_ROLE()", "function DEFAULT_ADMIN_ROLE() view returns (bytes32)", "DEFAULT_ADMIN_ROLE", []],
    ["hasRole(DEFAULT_ADMIN_ROLE, caller)", "function hasRole(bytes32,address) view returns (bool)", "hasRole", null],
  ];

  const defaultRole = await tryRead(publicClient, emergency, accessControlChecks[0][1], accessControlChecks[0][2]);
  if (defaultRole.ok) {
    const role = defaultRole.value;
    const hasRole = await tryRead(publicClient, emergency, accessControlChecks[1][1], accessControlChecks[1][2], [
      role,
      account.address,
    ]);
    if (hasRole.ok) {
      console.log("✅ AccessControl detected:");
      console.log("DEFAULT_ADMIN_ROLE:", role);
      console.log("caller hasRole(DEFAULT_ADMIN_ROLE):", hasRole.value);
      console.log("");
    }
  }

  // Simulate freeze() to extract revert info
  console.log("Simulating freeze() to extract revert data...");
  try {
    await publicClient.simulateContract({
      address: emergency,
      abi: abiFreeze,
      functionName: "freeze",
      account: account.address,
    });
    console.log("✅ simulate freeze() succeeded (should not revert). If this happens, your write call should work too.");
  } catch (e) {
    console.log("❌ simulate freeze() reverted.");
    console.log("shortMessage:", e.shortMessage || "(none)");
    if (e.metaMessages?.length) {
      console.log("metaMessages:");
      for (const m of e.metaMessages) console.log(" -", m);
    }
    // Print any raw data attached
    if (e.data) console.log("data:", e.data);
    if (e.cause?.data) console.log("cause.data:", e.cause.data);
    console.log("");
  }

  // Attempt an on-chain write only if simulate succeeded
  console.log("Attempting write freeze() only if simulate succeeded...");
  try {
    const sim = await publicClient.simulateContract({
      address: emergency,
      abi: abiFreeze,
      functionName: "freeze",
      account: account.address,
    });
    const hash = await walletClient.writeContract(sim.request);
    console.log("tx:", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("✅ mined in block:", receipt.blockNumber.toString());
  } catch (e) {
    console.log("⛔ write skipped/failed (expected if simulate reverts).");
    console.log("shortMessage:", e.shortMessage || "(none)");
    if (e.metaMessages?.length) {
      console.log("metaMessages:");
      for (const m of e.metaMessages) console.log(" -", m);
    }
    if (e.data) console.log("data:", e.data);
    if (e.cause?.data) console.log("cause.data:", e.cause.data);
    console.log("");
  }
}

main().catch((e) => {
  console.error("❌ freeze-debug failed:", e.message || e);
  process.exit(1);
});
