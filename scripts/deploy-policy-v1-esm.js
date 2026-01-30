import hre from "hardhat";

async function main() {
  const { ethers } = hre;

  const REGISTRY = "0x9d6831ccb9d6f971cb648b538448d175650cfea4";
  const ADMIN = "0x6C775411e11cAb752Af03C5BBb440618788E13Be";

  const Policy = await ethers.getContractFactory("ComplianceGatedPolicyV1");
  const policy = await Policy.deploy(REGISTRY, ADMIN, false);

  await policy.waitForDeployment();

  console.log("✅ ComplianceGatedPolicyV1 deployed:", await policy.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
