const assert = require("assert/strict");
const hre = require("hardhat");

function bytes32Reason(text) {
  return hre.ethers.keccak256(hre.ethers.toUtf8Bytes(text));
}

async function expectRevert(fn) {
  let reverted = false;
  try {
    await fn();
  } catch (e) {
    reverted = true;
  }
  assert.equal(reverted, true);
}

describe("Part 5.1 — Production Governance Contracts (ethers runner)", function () {
  it("Guardian can freeze; guardian cannot unfreeze; authority can unfreeze", async function () {
    const [deployer, authority, guardian, userA, userB] = await hre.ethers.getSigners();

    const Registry = await hre.ethers.getContractFactory("MockRegistry", deployer);
    const Policy = await hre.ethers.getContractFactory("MockPolicy", deployer);
    const Issuance = await hre.ethers.getContractFactory("IssuanceModule", deployer);
    const Token = await hre.ethers.getContractFactory("EquityTokenV3", deployer);

    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const policy = await Policy.deploy();
    await policy.waitForDeployment();

    const issuance = await Issuance.deploy(await authority.getAddress());
    await issuance.waitForDeployment();

    const token = await Token.deploy();
    await token.waitForDeployment();

    await token.initialize(
      "EquityTokenV3",
      "EQ3",
      await authority.getAddress(),
      await registry.getAddress(),
      await policy.getAddress(),
      await guardian.getAddress(),
      await issuance.getAddress()
    );

    await registry.setVerified(await userA.getAddress(), true);
    await registry.setVerified(await userB.getAddress(), true);

    const userAAddr = await userA.getAddress();
    const userBAddr = await userB.getAddress();

    await issuance.connect(authority).setIssuer(await deployer.getAddress(), true);

    const reason = bytes32Reason("TEST_ISSUE");
    await issuance.connect(deployer).issue(await token.getAddress(), userAAddr, 10, reason);

    await token.connect(userA).transfer(userBAddr, 1);

    await token.connect(guardian).freeze();

    await expectRevert(() => token.connect(userA).transfer(userBAddr, 1));
    await expectRevert(() => token.connect(guardian).unfreeze());

    await token.connect(authority).unfreeze();

    await token.connect(userA).transfer(userBAddr, 1);

    const frozen = await token.frozen();
    assert.equal(frozen, false);
  });

  it("Only IssuanceModule can mintFromModule", async function () {
    const [deployer, authority, guardian, userA] = await hre.ethers.getSigners();

    const Registry = await hre.ethers.getContractFactory("MockRegistry", deployer);
    const Policy = await hre.ethers.getContractFactory("MockPolicy", deployer);
    const Issuance = await hre.ethers.getContractFactory("IssuanceModule", deployer);
    const Token = await hre.ethers.getContractFactory("EquityTokenV3", deployer);

    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const policy = await Policy.deploy();
    await policy.waitForDeployment();

    const issuance = await Issuance.deploy(await authority.getAddress());
    await issuance.waitForDeployment();

    const token = await Token.deploy();
    await token.waitForDeployment();

    await token.initialize(
      "EquityTokenV3",
      "EQ3",
      await authority.getAddress(),
      await registry.getAddress(),
      await policy.getAddress(),
      await guardian.getAddress(),
      await issuance.getAddress()
    );

    const userAAddr = await userA.getAddress();

    await expectRevert(() => token.connect(deployer).mintFromModule(userAAddr, 1));

    await issuance.connect(authority).setIssuer(await deployer.getAddress(), true);
    const reason = bytes32Reason("ISSUE");
    await issuance.connect(deployer).issue(await token.getAddress(), userAAddr, 5, reason);

    const bal = await token.balanceOf(userAAddr);
    assert.equal(bal, 5n);
  });

  it("Compliance gating: verified + policy required", async function () {
    const [deployer, authority, guardian, userA, userB] = await hre.ethers.getSigners();

    const Registry = await hre.ethers.getContractFactory("MockRegistry", deployer);
    const Policy = await hre.ethers.getContractFactory("MockPolicy", deployer);
    const Issuance = await hre.ethers.getContractFactory("IssuanceModule", deployer);
    const Token = await hre.ethers.getContractFactory("EquityTokenV3", deployer);

    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const policy = await Policy.deploy();
    await policy.waitForDeployment();

    const issuance = await Issuance.deploy(await authority.getAddress());
    await issuance.waitForDeployment();

    const token = await Token.deploy();
    await token.waitForDeployment();

    await token.initialize(
      "EquityTokenV3",
      "EQ3",
      await authority.getAddress(),
      await registry.getAddress(),
      await policy.getAddress(),
      await guardian.getAddress(),
      await issuance.getAddress()
    );

    await registry.setVerified(await userA.getAddress(), true);
    await registry.setVerified(await userB.getAddress(), false);

    const userAAddr = await userA.getAddress();
    const userBAddr = await userB.getAddress();

    await issuance.connect(authority).setIssuer(await deployer.getAddress(), true);
    const reason = bytes32Reason("ISSUE");
    await issuance.connect(deployer).issue(await token.getAddress(), userAAddr, 10, reason);

    await expectRevert(() => token.connect(userA).transfer(userBAddr, 1));

    await registry.setVerified(userBAddr, true);
    await policy.setAllow(false);

    await expectRevert(() => token.connect(userA).transfer(userBAddr, 1));

    await policy.setAllow(true);
    await token.connect(userA).transfer(userBAddr, 1);

    const bal = await token.balanceOf(userBAddr);
    assert.equal(bal, 1n);
  });
});
