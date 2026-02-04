import "dotenv/config";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const ADDRS = {
  token: process.env.TOKEN || "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17",
  registry: process.env.REGISTRY || "0x9d6831ccb9d6f971cb648b538448d175650cfea4",
  vesting: process.env.VESTING || "0xef444c538769d7626511a4c538d03ffc7e53262b",
  freezePolicy: process.env.FREEZE_POLICY || "0x72dAf10067387bb9022356246a1734E871931e58",
};

const DEPLOYER_EOA = (process.env.ADMIN || "0x6C775411e11cAb752Af03C5BBb440618788E13Be").toLowerCase();

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC),
});

// Minimal ABIs for common getters
const ABI_ADMIN = [
  { type: "function", name: "admin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getAdmin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

const ABI_OWNER = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

const ABI_EMERGENCY = [
  { type: "function", name: "emergencyAdmin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getEmergencyAdmin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

async function tryRead(contract, abi, name) {
  try {
    const res = await client.readContract({ address: contract, abi, functionName: name });
    return res;
  } catch {
    return null;
  }
}

async function readAdminLike(address) {
  // Try admin() then getAdmin() then owner()
  let v = await tryRead(address, ABI_ADMIN, "admin");
  if (v) return { kind: "admin()", value: v };

  v = await tryRead(address, ABI_ADMIN, "getAdmin");
  if (v) return { kind: "getAdmin()", value: v };

  v = await tryRead(address, ABI_OWNER, "owner");
  if (v) return { kind: "owner()", value: v };

  return { kind: "unknown", value: null };
}

async function readEmergencyAdmin(address) {
  let v = await tryRead(address, ABI_EMERGENCY, "emergencyAdmin");
  if (v) return { kind: "emergencyAdmin()", value: v };

  v = await tryRead(address, ABI_EMERGENCY, "getEmergencyAdmin");
  if (v) return { kind: "getEmergencyAdmin()", value: v };

  return { kind: "unknown", value: null };
}

function flag(addr) {
  if (!addr) return "";
  return addr.toLowerCase() === DEPLOYER_EOA ? "  ⚠️ STILL DEPLOYER EOA" : "";
}

function fmt(label, obj) {
  if (!obj.value) return `${label}: ${obj.kind} -> (unreadable)`;
  return `${label}: ${obj.kind} -> ${obj.value}${flag(obj.value)}`;
}

async function main() {
  console.log("\n== Verify Admins Snapshot ==");
  console.log("chainId:", baseSepolia.id);
  console.log("rpcUrl:", RPC);
  console.log("deployer/admin EOA:", DEPLOYER_EOA);
  console.log("\nContracts:");
  console.log("  IdentityRegistry:", ADDRS.registry);
  console.log("  EquityTokenV2:", ADDRS.token);
  console.log("  VestingContract:", ADDRS.vesting);
  console.log("  EmergencyFreezePolicyV2:", ADDRS.freezePolicy);

  const registryAdmin = await readAdminLike(ADDRS.registry);
  const tokenAdmin = await readAdminLike(ADDRS.token);
  const vestingAdmin = await readAdminLike(ADDRS.vesting);
  const emergencyAdmin = await readEmergencyAdmin(ADDRS.freezePolicy);

  console.log("\nAdmin/Owner Pointers:");
  console.log(fmt("  Registry", registryAdmin));
  console.log(fmt("  Token", tokenAdmin));
  console.log(fmt("  Vesting", vestingAdmin));
  console.log(fmt("  Emergency Freeze", emergencyAdmin));

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
