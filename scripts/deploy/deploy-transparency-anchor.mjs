import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect("baseSepolia");

  const contract = await ethers.deployContract("TransparencyLogAnchor");
  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log("TransparencyLogAnchor deployed to:");
  console.log(address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
