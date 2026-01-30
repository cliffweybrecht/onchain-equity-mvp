import fs from "fs";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const CONTRACT = "0xf9a2e60af436f6bc940d36030b91e4e7aa6e4bd1";

function hasFn(abi, name) {
  return abi.some((x) => x.type === "function" && x.name === name);
}

async function main() {
  const artifact = JSON.parse(
    fs.readFileSync("./artifacts/contracts/EquityToken.sol/EquityToken.json", "utf8")
  );
  const abi = artifact.abi;

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  console.log("🌐 RPC:", RPC_URL);
  console.log("📄 Contract:", CONTRACT);

  const name = await client.readContract({ address: CONTRACT, abi, functionName: "name" });
  const symbol = await client.readContract({ address: CONTRACT, abi, functionName: "symbol" });

  console.log("✅ name:", name);
  console.log("✅ symbol:", symbol);

  // Optional reads if your contract exposes getters
  if (hasFn(abi, "identityRegistry")) {
    const reg = await client.readContract({ address: CONTRACT, abi, functionName: "identityRegistry" });
    console.log("✅ identityRegistry:", reg);
  } else {
    console.log("ℹ️ No identityRegistry() getter found in ABI");
  }

  if (hasFn(abi, "admin")) {
    const admin = await client.readContract({ address: CONTRACT, abi, functionName: "admin" });
    console.log("✅ admin:", admin);
  } else {
    console.log("ℹ️ No admin() getter found in ABI");
  }
}

main().catch((e) => {
  console.error("❌ Read failed:", e);
  process.exit(1);
});
