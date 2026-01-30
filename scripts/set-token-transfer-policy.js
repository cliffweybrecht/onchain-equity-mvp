import "dotenv/config";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("Set PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const TOKEN = process.env.TOKEN || "0x92bce3e624c4f40ee87dacdf3b4e27e178ec5b17";
const NEW_POLICY = process.env.NEW_POLICY;
if (!NEW_POLICY) throw new Error("Set NEW_POLICY to the new CompositePolicy root address");

function loadArtifact(rel) {
  return JSON.parse(fs.readFileSync(path.resolve(rel), "utf8"));
}

function loadTokenArtifact() {
  const candidates = [
    "artifacts/contracts/EquityTokenV2.sol/EquityTokenV2.json",
    "artifacts/contracts/EquityToken.sol/EquityToken.json",
  ];
  for (const c of candidates) {
    try {
      const art = loadArtifact(c);
      return { art, path: c };
    } catch {}
  }
  throw new Error("Token artifact not found. Search artifacts for EquityTokenV2.json and add its path here.");
}

const { art: tokenArt, path: tokenPath } = loadTokenArtifact();

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

const setterCandidates = [
  "setTransferPolicy",
  "setPolicy",
  "setTransferPolicyAddress",
  "setTransferPolicyContract",
  "setCompliancePolicy",
];

async function main() {
  console.log("\n== Set EquityToken Transfer Policy ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("token:", TOKEN);
  console.log("new policy:", NEW_POLICY);
  console.log("token artifact:", tokenPath);

  const fnNames = new Set(
    tokenArt.abi.filter((x) => x.type === "function").map((x) => x.name)
  );

  const setter = setterCandidates.find((n) => fnNames.has(n));
  if (!setter) {
    console.log("\n❌ No known policy setter found in token ABI.");
    console.log("Here are available function names:\n");
    console.log([...fnNames].sort().join("\n"));
    throw new Error("No policy setter found. Paste the function list above and I will target the correct setter.");
  }

  // sanity check it accepts 1 arg (address)
  const setterAbi = tokenArt.abi.find((x) => x.type === "function" && x.name === setter);
  console.log("\n✅ Using setter:", setter);
  console.log(
    "setter inputs:",
    setterAbi?.inputs?.map((i) => `${i.type} ${i.name}`).join(", ") || "(none)"
  );

  const hash = await walletClient.writeContract({
    address: TOKEN,
    abi: tokenArt.abi,
    functionName: setter,
    args: [NEW_POLICY],
  });

  console.log("tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ confirmed in block:", receipt.blockNumber);
}

main().catch((e) => {
  console.error("\n❌ Failed to set policy\n");
  console.error(e);
  process.exit(1);
});
