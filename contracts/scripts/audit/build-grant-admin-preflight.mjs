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

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function jsonSafe(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, jsonSafe(v)])
    );
  }
  return value;
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(jsonSafe(value), null, 2) + "\n");
}

function argValue(name) {
  const exact = process.argv.find((x) => x.startsWith(`--${name}=`));
  return exact ? exact.split("=")[1] : null;
}

function normalizeGrantRead(grantValue) {
  if (!grantValue) return null;

  const total = grantValue.total ?? grantValue[0];
  const released = grantValue.released ?? grantValue[1];
  const start = grantValue.start ?? grantValue[2];
  const cliff = grantValue.cliff ?? grantValue[3];
  const duration = grantValue.duration ?? grantValue[4];
  const exists = grantValue.exists ?? grantValue[5];
  const revoked = grantValue.revoked ?? grantValue[6];
  const revokedAt = grantValue.revokedAt ?? grantValue[7];

  if (
    total === undefined ||
    released === undefined ||
    start === undefined ||
    cliff === undefined ||
    duration === undefined ||
    exists === undefined ||
    revoked === undefined ||
    revokedAt === undefined
  ) {
    throw new Error(
      `Unable to normalize grants(address) result shape: ${JSON.stringify(
        jsonSafe(grantValue),
        null,
        2
      )}`
    );
  }

  return {
    total: total.toString(),
    released: released.toString(),
    start: Number(start),
    cliff: Number(cliff),
    duration: Number(duration),
    exists: Boolean(exists),
    revoked: Boolean(revoked),
    revokedAt: Number(revokedAt),
  };
}

const signerRaw = argValue("signer");
const vestingRaw = argValue("vesting");
const beneficiaryRaw = argValue("beneficiary");
const expectedSafeRaw = argValue("expected-safe-admin");

if (!signerRaw || !vestingRaw || !beneficiaryRaw || !expectedSafeRaw) {
  console.error(
    "Usage: node scripts/audit/build-grant-admin-preflight.mjs --signer=0x... --vesting=0x... --beneficiary=0x... --expected-safe-admin=0x..."
  );
  process.exit(1);
}

const signer = getAddress(signerRaw);
const vesting = getAddress(vestingRaw);
const beneficiary = getAddress(beneficiaryRaw);
const expectedSafeAdmin = getAddress(expectedSafeRaw);

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

async function safeRead(address, abi, functionName, args = []) {
  try {
    const value = await client.readContract({
      address,
      abi,
      functionName,
      args,
    });
    return { supported: true, ok: true, value: jsonSafe(value) };
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

const vestingAbi = [
  {
    type: "function",
    name: "grants",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { name: "total", type: "uint256" },
      { name: "released", type: "uint256" },
      { name: "start", type: "uint64" },
      { name: "cliff", type: "uint64" },
      { name: "duration", type: "uint64" },
      { name: "exists", type: "bool" },
      { name: "revoked", type: "bool" },
      { name: "revokedAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
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

const latestBlock = await client.getBlockNumber();
const chainId = await client.getChainId();

const adminRead = await safeRead(vesting, vestingAbi, "admin");
const ownerRead = await safeRead(vesting, vestingAbi, "owner");
const defaultAdminRoleRead = await safeRead(
  vesting,
  vestingAbi,
  "DEFAULT_ADMIN_ROLE"
);

let hasRoleSigner = {
  supported: false,
  ok: false,
  error: { name: "Skipped", message: "DEFAULT_ADMIN_ROLE unavailable" },
};

let hasRoleExpectedSafe = {
  supported: false,
  ok: false,
  error: { name: "Skipped", message: "DEFAULT_ADMIN_ROLE unavailable" },
};

if (defaultAdminRoleRead.supported && defaultAdminRoleRead.ok) {
  hasRoleSigner = await safeRead(vesting, vestingAbi, "hasRole", [
    defaultAdminRoleRead.value,
    signer,
  ]);
  hasRoleExpectedSafe = await safeRead(vesting, vestingAbi, "hasRole", [
    defaultAdminRoleRead.value,
    expectedSafeAdmin,
  ]);
}

const isAdminSigner = await safeRead(vesting, vestingAbi, "isAdmin", [signer]);
const isAdminExpectedSafe = await safeRead(
  vesting,
  vestingAbi,
  "isAdmin",
  [expectedSafeAdmin]
);

const grantsRead = await safeRead(vesting, vestingAbi, "grants", [beneficiary]);

const beneficiaryGrant =
  grantsRead.supported && grantsRead.ok
    ? normalizeGrantRead(grantsRead.value)
    : null;

const authorization = {
  signer_matches_admin:
    adminRead.supported && adminRead.ok
      ? getAddress(adminRead.value) === signer
      : false,
  signer_matches_owner:
    ownerRead.supported && ownerRead.ok
      ? getAddress(ownerRead.value) === signer
      : false,
  signer_has_default_admin_role:
    hasRoleSigner.supported && hasRoleSigner.ok
      ? Boolean(hasRoleSigner.value)
      : false,
  signer_is_admin:
    isAdminSigner.supported && isAdminSigner.ok
      ? Boolean(isAdminSigner.value)
      : false,

  expected_safe_matches_admin:
    adminRead.supported && adminRead.ok
      ? getAddress(adminRead.value) === expectedSafeAdmin
      : false,
  expected_safe_matches_owner:
    ownerRead.supported && ownerRead.ok
      ? getAddress(ownerRead.value) === expectedSafeAdmin
      : false,
  expected_safe_has_default_admin_role:
    hasRoleExpectedSafe.supported && hasRoleExpectedSafe.ok
      ? Boolean(hasRoleExpectedSafe.value)
      : false,
  expected_safe_is_admin:
    isAdminExpectedSafe.supported && isAdminExpectedSafe.ok
      ? Boolean(isAdminExpectedSafe.value)
      : false,
};

const signerAuthorized = Object.values({
  signer_matches_admin: authorization.signer_matches_admin,
  signer_matches_owner: authorization.signer_matches_owner,
  signer_has_default_admin_role: authorization.signer_has_default_admin_role,
  signer_is_admin: authorization.signer_is_admin,
}).some(Boolean);

const expectedSafeAuthorized = Object.values({
  expected_safe_matches_admin: authorization.expected_safe_matches_admin,
  expected_safe_matches_owner: authorization.expected_safe_matches_owner,
  expected_safe_has_default_admin_role:
    authorization.expected_safe_has_default_admin_role,
  expected_safe_is_admin: authorization.expected_safe_is_admin,
}).some(Boolean);

const beneficiaryCompatible =
  beneficiaryGrant !== null ? beneficiaryGrant.exists === false : false;

const failureReasons = [];
if (!signerAuthorized) failureReasons.push("SIGNER_NOT_AUTHORIZED");
if (!beneficiaryCompatible) failureReasons.push("BENEFICIARY_ALREADY_HAS_GRANT");

const result = {
  phase: "8.1.B",
  checked_at: new Date().toISOString(),
  chain_id: chainId.toString(),
  block_number: latestBlock.toString(),
  inputs: {
    signer,
    vesting,
    beneficiary,
    expected_safe_admin: expectedSafeAdmin,
  },
  probes: {
    admin: adminRead,
    owner: ownerRead,
    DEFAULT_ADMIN_ROLE: defaultAdminRoleRead,
    hasRole_default_admin_signer: hasRoleSigner,
    hasRole_default_admin_expected_safe_admin: hasRoleExpectedSafe,
    isAdmin_signer: isAdminSigner,
    isAdmin_expected_safe_admin: isAdminExpectedSafe,
    grants_beneficiary: grantsRead,
  },
  derived: {
    authorization,
    beneficiary_grant: beneficiaryGrant,
  },
  verdict: {
    authorization: {
      ok: signerAuthorized,
      signer_authorized: signerAuthorized,
      expected_safe_authorized: expectedSafeAuthorized,
    },
    beneficiary_compatibility: {
      ok: beneficiaryCompatible,
      beneficiary_compatible_for_create_grant: beneficiaryCompatible,
    },
    overall: {
      ok: signerAuthorized && beneficiaryCompatible,
      failure_reasons: failureReasons,
    },
  },
};

const outPath = path.join(
  process.cwd(),
  "evidence/phase-8.1.B/grant-admin-preflight.json"
);

writeJson(outPath, result);
console.log(`Wrote ${outPath}`);
