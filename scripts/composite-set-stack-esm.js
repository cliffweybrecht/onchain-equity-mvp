import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const pk = process.env.PRIVATE_KEY;

if (!pk) throw new Error("Missing PRIVATE_KEY");

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const COMPOSITE = process.env.COMPOSITE || "0x2f84c9918ec2602efa68000eae8b1fbe550311dc";

// Desired order (set these env vars if you want different addresses)
const DESIRED = [
  (process.env.P0 || "0x38c905c289b3eF1a244d95c8b1925a37c34839C8").toLowerCase(),
  (process.env.P1 || "0x2626c09eF40176300A0bcf1ddb56Cf4A3d530485").toLowerCase(),
];

const abi = parseAbi([
  "function getPolicies() view returns (address[])",
  "function addPolicy(address policy)",
  "function removePolicy(uint256 index)",
  "function movePolicy(uint256 fromIndex,uint256 toIndex)",
]);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

async function readStack(label) {
  const s = await publicClient.readContract({ address: COMPOSITE, abi, functionName: "getPolicies" });
  console.log(`\n${label}:`, s);
  return s.map((x) => x.toLowerCase());
}

async function tx(fn, args) {
  const hash = await walletClient.writeContract({
    address: COMPOSITE,
    abi,
    functionName: fn,
    args,
  });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${fn} failed: ${hash}`);
  return hash;
}

async function main() {
  console.log("\n== Composite set stack (address-safe) ==");
  console.log("rpcUrl:", rpcUrl);
  console.log("caller:", account.address);
  console.log("composite:", COMPOSITE);
  console.log("desired:", DESIRED);

  let stack = await readStack("start");

  // 1) Remove duplicates (keep first occurrence, remove later ones from the end)
  const seen = new Set();
  for (let i = stack.length - 1; i >= 0; i--) {
    const p = stack[i];
    if (seen.has(p)) {
      console.log(`Removing duplicate at index ${i}: ${p}`);
      await tx("removePolicy", [BigInt(i)]);
    } else {
      seen.add(p);
    }
  }
  stack = await readStack("after de-dupe");

  // 2) Ensure each desired policy exists (add if missing)
  for (const want of DESIRED) {
    if (!stack.includes(want)) {
      console.log(`Adding missing policy: ${want}`);
      await tx("addPolicy", [want]);
      stack = await readStack("after add");
    }
  }

  // 3) Reorder to match desired order
  // For each desired position i, move the policy currently at index j -> i
  for (let i = 0; i < DESIRED.length; i++) {
    stack = await readStack(`before position ${i}`);
    const want = DESIRED[i];
    const j = stack.indexOf(want);
    if (j === -1) throw new Error(`Desired policy not found after adds: ${want}`);
    if (j !== i) {
      console.log(`Moving policy ${want} from index ${j} -> ${i}`);
      await tx("movePolicy", [BigInt(j), BigInt(i)]);
    } else {
      console.log(`Policy ${want} already at index ${i}`);
    }
  }

  // 4) Optional: trim extra policies beyond desired length (from end)
  stack = await readStack("pre-trim");
  for (let i = stack.length - 1; i >= DESIRED.length; i--) {
    console.log(`Trimming extra policy at index ${i}: ${stack[i]}`);
    await tx("removePolicy", [BigInt(i)]);
  }

  await readStack("final");
  console.log("\n✅ Composite stack set to desired order.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



