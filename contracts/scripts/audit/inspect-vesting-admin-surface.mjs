#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_URL;
if (!RPC_URL) {
  console.error("Missing BASE_SEPOLIA_RPC_URL or RPC_URL");
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

async function safeRead(client, address, abi, functionName, args = []) {
  try {
    const value = await client.readContract({
      address,
      abi,
      functionName,
      args,
    });
    return { supported: true, ok: true, value };
  } catch (error) {
    return {
      supported: false,
      ok: false,
      error: {
        name: error?.name || "Error",
        message: error?.shortMessage || error?.message || String(error),
      },
    };
  }
}

const ROOT = process.cwd();
const REPO_ROOT = path.resolve(ROOT, "..");
const phase61AdminSurfacePath = path.join(
  REPO_ROOT,
  "evidence",
  "phase-6.1.E",
  "admin-surface.json"
);

if (!fs.existsSync(phase61AdminSurfacePath)) {
  console.error(`Missing prior evidence file: ${phase61AdminSurfacePath}`);
  process.exit(1);
}

const phase61AdminSurface = readJson(phase61AdminSurfacePath);

const vesting = getAddress(phase61AdminSurface.contracts.vesting);
const expectedSafeAdmin = getAddress(phase61AdminSurface.contracts.expectedSafeAdmin);

const signerArg = process.argv.find((x) => x.startsWith("--signer="));
if (!signerArg) {
  console.error("Usage: node scripts/audit/inspect-vesting-admin-surface.mjs --signer=0x...");
  process.exit(1);
}
const signer = getAddress(signerArg.split("=")[1]);

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const ownableAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];

const adminAbi = [
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];

const accessControlAbi = [
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
  },
];

const isAdminAbi = [
  {
    type: "function",
    name: "isAdmin",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bool" }],
  },
];

const code = await client.getBytecode({ address: vesting });
if (!code || code === "0x") {
  console.error(`No bytecode at vesting address ${vesting}`);
  process.exit(1);
}

const chainId = await client.getChainId();
const latestBlock = await client.getBlockNumber();

const adminRead = await safeRead(client, vesting, adminAbi, "admin");
const ownerRead = await safeRead(client, vesting, ownableAbi, "owner");
const defaultAdminRoleRead = await safeRead(
  client,
  vesting,
  accessControlAbi,
  "DEFAULT_ADMIN_ROLE"
);

let signerHasDefaultAdminRole = {
  supported: false,
  ok: false,
  error: { name: "Skipped", message: "DEFAULT_ADMIN_ROLE unavailable" },
};

let expectedSafeHasDefaultAdminRole = {
  supported: false,
  ok: false,
  error: { name: "Skipped", message: "DEFAULT_ADMIN_ROLE unavailable" },
};

if (defaultAdminRoleRead.supported && defaultAdminRoleRead.ok) {
  signerHasDefaultAdminRole = await safeRead(
    client,
    vesting,
    accessControlAbi,
    "hasRole",
    [defaultAdminRoleRead.value, signer]
  );

  expectedSafeHasDefaultAdminRole = await safeRead(
    client,
    vesting,
    accessControlAbi,
    "hasRole",
    [defaultAdminRoleRead.value, expectedSafeAdmin]
  );
}

const signerIsAdmin = await safeRead(client, vesting, isAdminAbi, "isAdmin", [signer]);
const expectedSafeIsAdmin = await safeRead(
  client,
  vesting,
  isAdminAbi,
  "isAdmin",
  [expectedSafeAdmin]
);

const derived = {
  signer_matches_admin:
    adminRead.supported && adminRead.ok
      ? getAddress(adminRead.value) === signer
      : null,
  signer_matches_owner:
    ownerRead.supported && ownerRead.ok
      ? getAddress(ownerRead.value) === signer
      : null,
  signer_has_default_admin_role:
    signerHasDefaultAdminRole.supported && signerHasDefaultAdminRole.ok
      ? Boolean(signerHasDefaultAdminRole.value)
      : null,
  signer_is_admin:
    signerIsAdmin.supported && signerIsAdmin.ok
      ? Boolean(signerIsAdmin.value)
      : null,

  expected_safe_matches_admin:
    adminRead.supported && adminRead.ok
      ? getAddress(adminRead.value) === expectedSafeAdmin
      : null,
  expected_safe_matches_owner:
    ownerRead.supported && ownerRead.ok
      ? getAddress(ownerRead.value) === expectedSafeAdmin
      : null,
  expected_safe_has_default_admin_role:
    expectedSafeHasDefaultAdminRole.supported && expectedSafeHasDefaultAdminRole.ok
      ? Boolean(expectedSafeHasDefaultAdminRole.value)
      : null,
  expected_safe_is_admin:
    expectedSafeIsAdmin.supported && expectedSafeIsAdmin.ok
      ? Boolean(expectedSafeIsAdmin.value)
      : null,
};

const authorizationSignals = [
  derived.signer_matches_admin,
  derived.signer_matches_owner,
  derived.signer_has_default_admin_role,
  derived.signer_is_admin,
].filter((x) => x === true);

const expectedSafeSignals = [
  derived.expected_safe_matches_admin,
  derived.expected_safe_matches_owner,
  derived.expected_safe_has_default_admin_role,
  derived.expected_safe_is_admin,
].filter((x) => x === true);

const result = {
  phase: "8.1.B",
  checked_at: new Date().toISOString(),
  chain_id: chainId,
  block_number: latestBlock.toString(),
  vesting,
  configured_signer: signer,
  expected_safe_admin: expectedSafeAdmin,
  bytecode_present: true,

  probes: {
    admin: adminRead,
    owner: ownerRead,
    DEFAULT_ADMIN_ROLE: defaultAdminRoleRead,
    hasRole_default_admin_configured_signer: signerHasDefaultAdminRole,
    hasRole_default_admin_expected_safe_admin: expectedSafeHasDefaultAdminRole,
    isAdmin_configured_signer: signerIsAdmin,
    isAdmin_expected_safe_admin: expectedSafeIsAdmin,
  },

  derived,

  verdict: {
    signer_authorized_by_detected_surface: authorizationSignals.length > 0,
    expected_safe_authorized_by_detected_surface: expectedSafeSignals.length > 0,
    authorization_model_detected:
      adminRead.supported ||
      ownerRead.supported ||
      defaultAdminRoleRead.supported ||
      signerIsAdmin.supported,
  },
};

const outPath = path.join(
  ROOT,
  "evidence/phase-8.1.B/vesting-admin-surface.json"
);

writeJson(outPath, result);
console.log(`Wrote ${outPath}`);
