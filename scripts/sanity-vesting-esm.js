import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

/* ---------------- helpers ---------------- */

function must(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing env var: ${name}`);
  }
  return v;
}

function addr(name) {
  const v = must(name);
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) {
    throw new Error(`Bad address for ${name}: ${v}`);
  }
  return v;
}

/* ---------------- main ---------------- */

async function main() {
  const rpcUrl = must("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org");

  const VESTING = addr("VESTING");
  const BENEFICIARY = addr("BENEFICIARY");

  const pk = must("PRIVATE_KEY");
  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

  const AMOUNT = BigInt(must("VEST_AMOUNT", "1"));
  const START_OFFSET_SEC = Number(must("START_OFFSET_SEC", "-10"));
  const CLIFF_SEC = Number(must("CLIFF_SEC", "0"));
  const DURATION_SEC = Number(must("DURATION_SEC", "1"));

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
    account,
  });

  const now = Math.floor(Date.now() / 1000);
  const start = BigInt(now + START_OFFSET_SEC);
  const cliff = start + BigInt(CLIFF_SEC); // IMPORTANT: absolute timestamp
  const duration = BigInt(DURATION_SEC);

  console.log("== createGrant isolation ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("chainId:", baseSepolia.id);
  console.log("signer:", account.address);
  console.log("VESTING:", VESTING);
  console.log("BENEFICIARY:", BENEFICIARY);
  console.log("amount:", AMOUNT.toString());
  console.log("now:", now);
  console.log("start:", start.toString(), `(offset ${START_OFFSET_SEC}s)`);
  console.log("cliff:", cliff.toString());
  console.log("duration:", duration.toString());

  const vestingAbi = parseAbi([
    "function createGrant(address beneficiary,uint256 amount,uint64 start,uint64 cliff,uint64 duration) external",
  ]);

  /* ---------------- simulate ---------------- */

  console.log("\n--- simulateContract(createGrant) ---");

  const sim = await publicClient.simulateContract({
    address: VESTING,
    abi: vestingAbi,
    functionName: "createGrant",
    args: [BENEFICIARY, AMOUNT, start, cliff, duration],
    account: account.address,
  });

  console.log("✅ simulation ok");

  /* ---------------- send tx (PUBLIC RPC SAFE) ---------------- */

  console.log("\n--- writeContract(createGrant) ---");

  // Extract raw tx fields from simulation
  // Build calldata ourselves (your sim.request only has address + args + dataSuffix)
  const to = sim.request.address ?? sim.request.to;
  if (!to) {
  throw new Error(`simulateContract request missing address/to. keys: ${Object.keys(sim.request).join(", ")}`);
  }

  const data = encodeFunctionData({
    abi: vestingAbi,
    functionName: "createGrant",
    args: [BENEFICIARY, AMOUNT, start, cliff, duration],
  });

  // Some viem flows use `dataSuffix` to append extra calldata (rare for normal calls).
  // If present, append it.
  const suffix = sim.request.dataSuffix;
  const fullData =
   suffix && typeof suffix === "string" && suffix.startsWith("0x") && suffix.length > 2
     ? (data + suffix.slice(2))
     : data;


  // Prepare a real EIP-1559 transaction
  const txRequest = await publicClient.prepareTransactionRequest({
    account,
    to,
    data: fullData,
    value: 0n,
    type: "eip1559",
  });

  // Sign locally (NO wallet RPC methods)
  const signedTx = await walletClient.signTransaction(txRequest);

  // Broadcast via public RPC
  const hash = await publicClient.sendRawTransaction({
    serializedTransaction: signedTx,
  });

  console.log("tx hash:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ mined status:", receipt.status);
}

/* ---------------- run ---------------- */

main().catch((err) => {
  console.error("\n❌ script failed:");
  console.dir(err, { depth: 8 });
  process.exitCode = 1;
});
