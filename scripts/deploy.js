import hre from "hardhat";

async function main() {
  console.log("🚀 Deploying EquityToken to baseSepolia...");

  const name = "EquityToken";
  const symbol = "EQT";

  // Get a wallet client (signer) for the active network
  const [walletClient] = await hre.viem.getWalletClients();

  // Get the contract ABI/bytecode from artifacts
  const artifact = await hre.artifacts.readArtifact("EquityToken");

  // Deploy
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [name, symbol],
  });

  console.log("📨 Deployment tx hash:", hash);

  // Wait for the tx to be mined + get contract address
  const publicClient = await hre.viem.getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log("✅ EquityToken deployed at:", receipt.contractAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
