import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hre, { network } from "hardhat";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const conn = await network.connect();
  console.log("connect() keys:", Object.keys(conn)); // <-- debug

  const { viem } = conn;
  if (!viem) {
    throw new Error("viem is missing from network connection. Check hardhat.config.ts imports for @nomicfoundation/hardhat-viem.");
  }

  const publicClient = await viem.getPublicClient();
  const walletClient = await viem.getWalletClient();

  const [deployer] = await walletClient.getAddresses();
  const chainId = await publicClient.getChainId();

  console.log("\n== Deploying to ==");
  console.log("  chainId:", chainId);
  console.log("  deployer:", deployer);

// 1) Deploy IdentityRegistry
let identityRegistry;
try {
identityRegistry = await viem.deployContract("IdentityRegistry", [deployer]);
  console.log("\n✅ IdentityRegistry:", identityRegistry.address);
} catch (e) {
  console.error("\n❌ IdentityRegistry deploy failed");
  console.error(e);
  throw e;
}

// 2) Deploy EquityToken
let equityToken;
try {
equityToken = await viem.deployContract("EquityToken", [
  "Onchain Equity",
  "OEQ",
  identityRegistry.address,
  deployer, // ✅ admin
  ]);
  console.log("✅ EquityToken:", equityToken.address);
} catch (e) {
  console.error("\n❌ EquityToken deploy failed");
  console.error(e);
  throw e;
}

// 3) Deploy VestingContract
let vesting;
try {
vesting = await viem.deployContract("VestingContract", [
  deployer,
  equityToken.address,
  identityRegistry.address,
]);
  console.log("✅ VestingContract:", vesting.address);
} catch (e) {
  console.error("\n❌ VestingContract deploy failed");
  console.error(e);
  throw e;
}


  const out = {
    network: "baseSepolia",
    chainId,
    deployer,
    IdentityRegistry: identityRegistry.address,
    EquityToken: equityToken.address,
    VestingContract: vesting.address,
    deployedAt: new Date().toISOString(),
  };

  const outPath = path.join(__dirname, "..", "deployments", "base-sepolia.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\n📝 Saved:", outPath);

  console.log("\nDone ✅");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
