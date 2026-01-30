import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function loadArtifact(relPath) {
  return JSON.parse(fs.readFileSync(path.resolve(relPath), "utf8"));
}

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  let pk = mustGetEnv("PRIVATE_KEY");
  if (!pk.startsWith("0x")) pk = `0x${pk}`;
  const account = privateKeyToAccount(pk);

  // Existing deployed contracts
  const tokenAddr = "0x2791d08fc94c787e5772daba3507a68e74ba4b10";
  const registryAddr = "0x9d6831ccb9d6f971cb648b538448d175650cfea4";

  const vestingJson = loadArtifact(
    "artifacts/contracts/VestingContract.sol/VestingContract.json"
  );

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
    account,
  });

  console.log("deployer:", account.address);
  console.log("token:", tokenAddr);
  console.log("registry:", registryAddr);

  const hash = await walletClient.deployContract({
    abi: vestingJson.abi,
    bytecode: vestingJson.bytecode,
    args: [account.address, tokenAddr, registryAddr],
  });

  console.log("deploy tx:", hash);

  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ mined in block:", rcpt.blockNumber.toString());
  console.log("✅ vesting deployed at:", rcpt.contractAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
