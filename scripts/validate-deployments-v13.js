import "dotenv/config";
import fs from "fs";
import path from "path";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const DEPLOY_FILE = path.resolve("deployments/base-sepolia.json");

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

async function main() {
  if (!fs.existsSync(DEPLOY_FILE)) throw new Error(`Missing ${DEPLOY_FILE}`);
  const deployments = JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));

  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  // ===== read schema exactly as deployments/base-sepolia.json is structured =====
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
  const children = req("childPolicies", stack.childPolicies);
  if (!Array.isArray(children)) throw new Error("childPolicies must be an array");

  // Expect v1.3 ordering: EmergencyFreezePolicyV2, ComplianceGatedPolicyV1, MinAmountPolicyV1(min=3)
  if (children.length < 3) throw new Error("childPolicies must have at least 3 entries");

  const expectedChildren = [
    req("EmergencyFreezePolicyV2 child address", children[0]?.address),
    req("ComplianceGatedPolicyV1 child address", children[1]?.address),
    req("MinAmountPolicyV1 child address", children[2]?.address),
  ];

  console.log("\n== Validate Deployments (v1.3) ==");
  console.log("RPC:", rpcUrl);
  console.log("Expected chainId:", chainId);
  console.log("Active policyStackId:", policyStackId);
  console.log("Composite root (active):", compositeRoot);

  // ===== chain id check =====
  const liveChainId = await client.getChainId();
  if (Number(chainId) !== Number(liveChainId)) {
    throw new Error(`ChainId mismatch. deployments=${chainId} live=${liveChainId}`);
  }
  console.log("✅ chainId matches:", liveChainId);

  // ===== bytecode existence checks =====
  await mustHaveCode(client, "IdentityRegistry", identityRegistry);
  await mustHaveCode(client, "EquityTokenV2", tokenV2);
  await mustHaveCode(client, "VestingContract", vesting);
  await mustHaveCode(client, "CompositeRoot", compositeRoot);
  for (let i = 0; i < expectedChildren.length; i++) {
    await mustHaveCode(client, `ChildPolicy[${i}]`, expectedChildren[i]);
  }
  console.log("✅ all contracts have bytecode");

  // ===== best-effort reads (informational, but can hard-fail if mismatch is detected) =====
  const tokenRegistryRead = await tryRead(client, tokenV2, [
    { sig: "function identityRegistry() view returns (address)", fn: "identityRegistry" },
    { sig: "function registry() view returns (address)", fn: "registry" },
  ]);

  if (tokenRegistryRead.ok) {
    console.log(`✅ token->registry via ${tokenRegistryRead.used}:`, tokenRegistryRead.value);
    if (String(tokenRegistryRead.value).toLowerCase() !== identityRegistry.toLowerCase()) {
      throw new Error("Token registry pointer does not match deployments.contracts.IdentityRegistry");
    }
  } else {
    console.log("⚠️ Could not read token registry pointer (ABI mismatch). Proceeding (code checks passed).");
  }

  const stackIdRead = await tryRead(client, tokenV2, [
    { sig: "function policyStackId() view returns (string)", fn: "policyStackId" },
  ]);

  if (stackIdRead.ok) {
    console.log("✅ token policyStackId():", stackIdRead.value);
    if (String(stackIdRead.value) !== String(policyStackId)) {
      throw new Error("policyStackId mismatch between token and deployments.active.policyStackId");
    }
  } else {
    console.log("⚠️ Could not read token policyStackId() (ABI mismatch).");
  }

  const compositeChildrenRead = await tryRead(client, compositeRoot, [
    { sig: "function getPolicies() view returns (address[])", fn: "getPolicies" },
  ]);

  if (compositeChildrenRead.ok && Array.isArray(compositeChildrenRead.value)) {
    const onchain = compositeChildrenRead.value.map((a) => String(a).toLowerCase());
    const exp = expectedChildren.map((a) => a.toLowerCase());
    console.log("✅ composite children (on-chain):", onchain);

    if (onchain.length < exp.length) throw new Error("Composite has fewer children than expected.");
    for (let i = 0; i < exp.length; i++) {
      if (onchain[i] !== exp[i]) {
        throw new Error(`Composite child mismatch at index ${i}. expected=${exp[i]} got=${onchain[i]}`);
      }
    }
    console.log("✅ composite child ordering matches expected AND order");
  } else {
    console.log("⚠️ Could not read composite children (ABI mismatch). Code checks passed.");
  }

  console.log("\n✅ VALIDATION PASSED: deployments/base-sepolia.json is consistent with live chain (v1.3).");
}

main().catch((e) => {
  console.error("\n❌ VALIDATION FAILED:", e.message || e);
  process.exit(1);
});
