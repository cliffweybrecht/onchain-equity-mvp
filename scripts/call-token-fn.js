import "dotenv/config";
import fs from "fs";
import path from "path";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("Set PRIVATE_KEY");
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const TOKEN = process.env.TOKEN || "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17";
const FN = process.env.FN;
const TO = process.env.TO;
const AMOUNT = process.env.AMOUNT;

if (!FN || !TO || !AMOUNT) throw new Error("Set FN, TO, AMOUNT");

const art = JSON.parse(
  fs.readFileSync(path.resolve("artifacts/contracts/EquityTokenV2.sol/EquityTokenV2.json"), "utf8")
);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

async function main() {
  console.log("\n== Call Token Function ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("token:", TOKEN);
  console.log("fn:", FN);
  console.log("to:", TO);
  console.log("amount:", AMOUNT);

  const hash = await walletClient.writeContract({
    address: TOKEN,
    abi: art.abi,
    functionName: FN,
    args: [TO, BigInt(AMOUNT)],
  });

  console.log("tx:", hash);
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ confirmed block:", rcpt.blockNumber);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
