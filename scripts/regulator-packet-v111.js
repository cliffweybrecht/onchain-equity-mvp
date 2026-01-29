import "dotenv/config";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

const NETWORK = { name: "Base Sepolia", chainId: 84532 };

const IDENTITY_REGISTRY = "0x9d6831ccb9d6f971cb648b538448d175650cfea4";
const ADMIN = "0x6C775411e11cAb752Af03C5BBb440618788E13Be";

const EQUITY_TOKEN_V2 = "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17";
const COMPOSITE_POLICY_V111 = "0xbb9bfa7f0a398262fdb46606ae086944a5407309";

const POLICY_STACK_ID_EXPECTED = "BASESEP-84532-STACK-2026-01-28-v1.1";

const CHILD_POLICIES_EXPECTED = [
  { name: "ComplianceGatedPolicyV1", address: "0x38c905c289b3ef1a244d95c8b1925a37c34839c8" },
  { name: "MinAmountPolicyV1 (min=3)", address: "0x97c9a7b6155ca7a794ee23f48c33427a4adb3cf8" },
];

const VERIFIED_BENEFICIARY = "0x8B24E58442c0ECc9Ac11A22beb89C8eE53ED4544";

const PROOF_TXS = {
  proofTransfer_admin_to_beneficiary_amount_3:
    "0x8e1bbc62cd3bfb6d6fbdb7ff715d66d5ded8b219a5b35a1412072ce12832476c",
};
const tokenAbi = parseAbi([
  "function transferPolicy() view returns (address)",
  "function policy() view returns (address)",
]);

const compositeAbi = parseAbi([
  "function policyStackId() view returns (string)",
  "function policyCount() view returns (uint256)",
  "function policies(uint256) view returns (address)",
]);

async function tryRead(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e?.shortMessage || String(e) };
  }
}
async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

  const tp1 = await tryRead(() =>
    client.readContract({ address: EQUITY_TOKEN_V2, abi: tokenAbi, functionName: "transferPolicy" })
  );

  const tp2 = tp1.ok
    ? tp1
    : await tryRead(() =>
        client.readContract({ address: EQUITY_TOKEN_V2, abi: tokenAbi, functionName: "policy" })
      );

  const tokenTransferPolicy = tp2.ok ? tp2.value : null;
  const onchainStackId = await tryRead(() =>
    client.readContract({ address: COMPOSITE_POLICY_V111, abi: compositeAbi, functionName: "policyStackId" })
  );

  const cnt = await tryRead(() =>
    client.readContract({ address: COMPOSITE_POLICY_V111, abi: compositeAbi, functionName: "policyCount" })
  );

  let onchainPolicies = null;
  let onchainPoliciesError = null;

  if (cnt.ok) {
    const n = Number(cnt.value);
    const arr = [];
    for (let i = 0; i < n; i++) {
      const p = await tryRead(() =>
        client.readContract({
          address: COMPOSITE_POLICY_V111,
          abi: compositeAbi,
          functionName: "policies",
          args: [BigInt(i)],
        })
      );

      if (p.ok) arr.push(p.value);
      else onchainPoliciesError = p.error;
    }
    onchainPolicies = arr;
  } else {
    onchainPoliciesError = cnt.error;
  }
  const packet = {
    generatedAt: new Date().toISOString(),
    network: NETWORK,
    rpcUrl: RPC,

    contracts: {
      identityRegistry: IDENTITY_REGISTRY,
      admin: ADMIN,
      equityTokenV2: EQUITY_TOKEN_V2,
      compositePolicyV111: COMPOSITE_POLICY_V111,
    },

    tokenState: {
      transferPolicy_readFromChain: tokenTransferPolicy,
      transferPolicy_readError: tp2.ok ? null : tp2.error,
      transferPolicy_expected: COMPOSITE_POLICY_V111,
      transferPolicy_matches_expected: tokenTransferPolicy
        ? tokenTransferPolicy.toLowerCase() === COMPOSITE_POLICY_V111.toLowerCase()
        : false,
    },

    policyStack: {
      policyStackId_expected: POLICY_STACK_ID_EXPECTED,
      policyStackId_readFromChain: onchainStackId.ok ? onchainStackId.value : null,
      policyStackId_readError: onchainStackId.ok ? null : onchainStackId.error,

      childPolicies_expected: CHILD_POLICIES_EXPECTED,
      childPolicies_readFromChain: onchainPolicies,
      childPolicies_readError: onchainPoliciesError,
    },

    verifiedBeneficiary: VERIFIED_BENEFICIARY,

    proofs: {
      resultsFrom_prove_policy_gating_v1: {
        canTransfer_admin_to_dead_amount_2: false,
        canTransfer_admin_to_beneficiary_amount_2: false,
        canTransfer_admin_to_beneficiary_amount_3: true,
      },
      txHashes: PROOF_TXS,
    },

    explorers: {
      basescan: {
        token: `https://sepolia.basescan.org/address/${EQUITY_TOKEN_V2}`,
        compositePolicy: `https://sepolia.basescan.org/address/${COMPOSITE_POLICY_V111}`,
        proofTx: `https://sepolia.basescan.org/tx/${PROOF_TXS.proofTransfer_admin_to_beneficiary_amount_3}`,
      },
      blockscout: {
        compositePolicyCode:
          "https://base-sepolia.blockscout.com/address/0xbb9bfa7f0a398262fdb46606ae086944a5407309#code",
      },
      sourcify: {
        repoUI: "https://sourcify.dev/server/repo-ui/84532/0xbb9bfa7f0a398262fdb46606ae086944a5407309",
      },
    },
  };

  console.log(JSON.stringify(packet, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
