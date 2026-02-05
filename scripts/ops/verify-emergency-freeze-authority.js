import "dotenv/config";
import { createPublicClient, http, parseAbi, keccak256, toHex } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const EMERGENCY = process.env.EMERGENCY;
const SAFE = process.env.SAFE;
const DEPLOYER = process.env.DEPLOYER;

if (!EMERGENCY || !SAFE || !DEPLOYER) {
  throw new Error("Missing env vars: EMERGENCY, SAFE, DEPLOYER (and optionally BASE_SEPOLIA_RPC_URL)");
}

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

async function tryRead(label, abi, fn, args = []) {
  try {
    const res = await client.readContract({ address: EMERGENCY, abi, functionName: fn, args });
    console.log(`${label}:`, res);
    return res;
  } catch {
    return undefined;
  }
}

async function trySim(label, abi, fn, account, args = []) {
  try {
    await client.simulateContract({
      address: EMERGENCY,
      abi,
      functionName: fn,
      args,
      account
    });
    console.log(`SIM OK   ${label} as ${account}`);
    return true;
  } catch (e) {
    const msg = (e?.shortMessage || e?.message || "").toString().split("\n")[0];
    console.log(`SIM FAIL ${label} as ${account} :: ${msg}`);
    return false;
  }
}

function roleId(name) {
  return keccak256(toHex(name));
}

const abiOwnable = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)"
]);

const abiAdmin = parseAbi([
  "function admin() view returns (address)",
  "function getAdmin() view returns (address)"
]);

const abiFreeze = parseAbi([
  "function freeze() external",
  "function unfreeze() external",
  "function frozen() view returns (bool)",
  "function isFrozen() view returns (bool)"
]);

const abiAccessControl = parseAbi([
  "function hasRole(bytes32,address) view returns (bool)",
  "function getRoleAdmin(bytes32) view returns (bytes32)"
]);

async function main() {
  console.log("\n== Verify EmergencyFreezePolicyV2 Authority (read-only + simulations) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("emergency:", EMERGENCY);
  console.log("safe:", SAFE);
  console.log("deployer:", DEPLOYER);

  const owner = await tryRead("owner()", abiOwnable, "owner");
  await tryRead("pendingOwner()", abiOwnable, "pendingOwner");
  const admin = await tryRead("admin()", abiAdmin, "admin");
  const getAdmin = await tryRead("getAdmin()", abiAdmin, "getAdmin");

  const frozenA = await tryRead("frozen()", abiFreeze, "frozen");
  const frozenB = await tryRead("isFrozen()", abiFreeze, "isFrozen");
  const frozen =
    (typeof frozenA === "boolean") ? frozenA :
    (typeof frozenB === "boolean") ? frozenB :
    undefined;

  const roleNames = ["FREEZER_ROLE", "PAUSER_ROLE", "EMERGENCY_ROLE", "GUARDIAN_ROLE", "DEFAULT_ADMIN_ROLE"];
  console.log("\n-- AccessControl probes (if supported) --");
  for (const rn of roleNames) {
    const rid = rn === "DEFAULT_ADMIN_ROLE" ? ("0x" + "00".repeat(32)) : roleId(rn);
    const safeHas = await tryRead(`hasRole(${rn}, SAFE)`, abiAccessControl, "hasRole", [rid, SAFE]);
    const depHas = await tryRead(`hasRole(${rn}, DEPLOYER)`, abiAccessControl, "hasRole", [rid, DEPLOYER]);
    if (typeof safeHas === "boolean" || typeof depHas === "boolean") {
      console.log(`role ${rn} id ${rid}`);
      await tryRead(`getRoleAdmin(${rn})`, abiAccessControl, "getRoleAdmin", [rid]);
    }
  }

  console.log("\n-- Controller hints --");
  if (owner) console.log("Ownable.owner:", owner);
  if (admin) console.log("admin():", admin);
  if (getAdmin) console.log("getAdmin():", getAdmin);
  if (frozen !== undefined) console.log("frozen state:", frozen);
  if (!owner && !admin && !getAdmin) console.log("No owner()/admin() surface detected (may be custom).");

  console.log("\n-- Simulations (NO STATE CHANGES) --");
  const safeFreeze = await trySim("freeze()", abiFreeze, "freeze", SAFE);
  const depFreeze  = await trySim("freeze()", abiFreeze, "freeze", DEPLOYER);

  const safeUnfreeze = await trySim("unfreeze()", abiFreeze, "unfreeze", SAFE);
  const depUnfreeze  = await trySim("unfreeze()", abiFreeze, "unfreeze", DEPLOYER);

  console.log("\n== Decision signal ==");
  console.log("SAFE can freeze?       ", safeFreeze);
  console.log("DEPLOYER can freeze?   ", depFreeze);
  console.log("SAFE can unfreeze?     ", safeUnfreeze);
  console.log("DEPLOYER can unfreeze? ", depUnfreeze);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
