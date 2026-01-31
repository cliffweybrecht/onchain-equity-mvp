import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const DEPLOY_FILE = path.resolve("deployments/base-sepolia.json");
const OUT_FILE = path.resolve("regulator-packet-v1.3.json");

function safeGit(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function req(name, v) {
  if (!v) throw new Error(`Missing required field: ${name}`);
  return v;
}

function isAddr(a) {
  return typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a);
}

async function mustHaveCode(client, label, addr) {
  if (!isAddr(addr)) throw new Error(`${label} invalid address: ${addr}`);
  const code = await client.getBytecode({ address: addr });
  if (!code || code === "0x") throw new Error(`${label} has NO code on-chain: ${addr}`);
}

async function tryRead(client, address, candidates) {
  for (const c of candidates) {
    try {
      const abi = parseAbi([c.sig]);
      const res = await client.readContract({
        address,
        abi,
        functionName: c.fn,
        args: c.args || [],
      });
      return { ok: true, used: c.sig, value: res };
    } catch (_) {}
  }
  return { ok: false };
}

function writeJsonAtomic(filePath, obj) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  if (!fs.existsSync(DEPLOY_FILE)) throw new Error(`Missing ${DEPLOY_FILE}`);
  const deployments = JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));

  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  // ===== match your deployments/base-sepolia.json schema =====
  const network = deployments.network || "baseSepolia";
  const chainId = req("chainId", deployments.chainId);

  const contracts = req("contracts", deployments.contracts);
  const identityRegistry = req("contracts.IdentityRegistry", contracts.IdentityRegistry);
  const tokenV2 = req("contracts.EquityTokenV2", contracts.EquityTokenV2);
  const vesting = req("contracts.VestingContract", contracts.VestingContract);

  const active = req("active", deployments.active);
  const policyStackId = req("active.policyStackId", active.policyStackId);
  const compositeRoot = req("active.compositeRoot", active.compositeRoot);

  const stacks = req("policyStacks", deployments.policyStacks);
  const stack = req(`policyStacks[${policyStackId}]`, stacks[policyStackId]);

  const childPoliciesRaw = req("childPolicies", stack.childPolicies);
  if (!Array.isArray(childPoliciesRaw) || childPoliciesRaw.length < 3) {
    throw new Error("policyStacks[...].childPolicies must be an array with at least 3 entries");
  }

  const childPolicies = childPoliciesRaw.map((p, idx) => ({
    order: idx + 1,
    name: req(`childPolicies[${idx}].name`, p.name),
    address: req(`childPolicies[${idx}].address`, p.address),
  }));

  // ===== hard checks: all addresses have bytecode on-chain =====
  await mustHaveCode(client, "IdentityRegistry", identityRegistry);
  await mustHaveCode(client, "EquityTokenV2", tokenV2);
  await mustHaveCode(client, "VestingContract", vesting);
  await mustHaveCode(client, "CompositeRoot", compositeRoot);
  for (const p of childPolicies) {
    await mustHaveCode(client, `ChildPolicy(${p.name})`, p.address);
  }

  const latestBlock = await client.getBlockNumber();

  // ===== best-effort reads (optional) =====
  const tokenRegistryRead = await tryRead(client, tokenV2, [
    { sig: "function identityRegistry() view returns (address)", fn: "identityRegistry" },
    { sig: "function registry() view returns (address)", fn: "registry" },
  ]);

  const tokenStackIdRead = await tryRead(client, tokenV2, [
    { sig: "function policyStackId() view returns (string)", fn: "policyStackId" },
  ]);

  const compositeChildrenRead = await tryRead(client, compositeRoot, [
    { sig: "function getPolicies() view returns (address[])", fn: "getPolicies" },
  ]);

  // try to read frozen() specifically on the first policy (expected EmergencyFreezePolicyV2)
  const freezeRead = await tryRead(client, childPolicies[0].address, [
    { sig: "function frozen() view returns (bool)", fn: "frozen" },
  ]);

  // ===== repo metadata =====
  const commit = safeGit("git rev-parse HEAD");
  const branch = safeGit("git rev-parse --abbrev-ref HEAD");

  const packet = {
    packetVersion: "v1.3",
    generatedAt: nowIso(),

    environment: {
      network,
      chainId,
      rpcUrl,
      latestBlock: latestBlock.toString(),
    },

    repo: {
      branch,
      commit,
    },

    roles: {
      deployer: deployments.deployer || null,
      admin: deployments.admin || null,
    },

    contracts: {
      IdentityRegistry: identityRegistry,
      EquityTokenV2: tokenV2,
      VestingContract: vesting,
    },

    activePolicyStack: {
      policyStackId,
      compositeRoot,
      childPolicies, // ordered
      onchainReadbacks: {
        tokenIdentityRegistry: tokenRegistryRead.ok ? String(tokenRegistryRead.value) : null,
        tokenPolicyStackId: tokenStackIdRead.ok ? String(tokenStackIdRead.value) : null,
        compositeChildren: compositeChildrenRead.ok ? compositeChildrenRead.value.map(String) : null,
        emergencyFrozen: freezeRead.ok ? Boolean(freezeRead.value) : null,
      },
      readbackNotes: [
        "Readbacks are best-effort; null indicates ABI mismatch or function not present.",
        "Bytecode existence checks are authoritative and are enforced (hard fail).",
      ],
    },

    proofs: {
      verifiedBeneficiary: stack.proof?.verifiedBeneficiary || null,
      txHashes: stack.proof || {},
    },

    snapshotMetadata: {
      deployedAt: deployments.deployedAt || null,
      lastUpdatedAt: deployments.lastUpdatedAt || null,
    },

    notes: [
      "This regulator packet is generated from deployments/base-sepolia.json and verified against live Base Sepolia bytecode.",
      "No on-chain state is modified by this script.",
      "Intended use: compliance/regulatory artifact + production pilot readiness packaging.",
    ],
  };

  writeJsonAtomic(OUT_FILE, packet);
  console.log(`✅ Wrote ${OUT_FILE}`);
}

main().catch((e) => {
  console.error("❌ regulator-packet-v113 failed:", e.message || e);
  process.exit(1);
});
