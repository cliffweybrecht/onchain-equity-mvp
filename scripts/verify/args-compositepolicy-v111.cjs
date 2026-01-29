const admin = "0x6C775411e11cAb752Af03C5BBb440618788E13Be";

const policyStackId = "BASESEP-84532-STACK-2026-01-28-v1.1";

const childPolicies = [
  "0x38c905c289b3ef1a244d95c8b1925a37c34839c8", // ComplianceGatedPolicyV1
  "0x97c9a7b6155ca7a794ee23f48c33427a4adb3cf8", // MinAmountPolicyV1 (min=3)
];

module.exports = [admin, policyStackId, childPolicies];
