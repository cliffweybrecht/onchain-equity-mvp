import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "node:fs";

function stableStringify(obj) {
  const seen = new WeakSet();
  const sorter = (value) => {
    if (value && typeof value === "object") {
      if (seen.has(value)) throw new Error("circular");
      seen.add(value);
      if (Array.isArray(value)) return value.map(sorter);
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = sorter(value[k]);
      return out;
    }
    return value;
  };
  return JSON.stringify(sorter(obj), null, 2) + "\n";
}

const ABI = [
  { type: "function", name: "admin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "identityRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const vesting = process.env.VESTING;
  const expectedIdReg = process.env.EXPECTED_IDREG;
  const expectedSafe = process.env.EXPECTED_SAFE;

  if (!rpcUrl) throw new Error("Set RPC_URL");
  if (!vesting) throw new Error("Set VESTING");
  if (!expectedIdReg) throw new Error("Set EXPECTED_IDREG");
  if (!expectedSafe) throw new Error("Set EXPECTED_SAFE");

  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  // 1) Anchor to a specific block for deterministic eth_call results.
  const block = await client.getBlock({ blockTag: "latest" });
  const blockNumber = block.number;

  // 2) Sanity: code exists at Vesting
  const code = await client.getCode({ address: vesting, blockNumber });
  const hasCode = code && code !== "0x";

  // 3) Read pointers at the pinned blockNumber
  const admin = await client.readContract({
    address: vesting,
    abi: ABI,
    functionName: "admin",
    blockNumber,
  });

  const identityRegistry = await client.readContract({
    address: vesting,
    abi: ABI,
    functionName: "identityRegistry",
    blockNumber,
  });

  const token = await client.readContract({
    address: vesting,
    abi: ABI,
    functionName: "token",
    blockNumber,
  });

  const adminN = getAddress(admin);
  const idRegN = getAddress(identityRegistry);
  const tokenN = getAddress(token);

  const expectedIdRegN = getAddress(expectedIdReg);
  const expectedSafeN = getAddress(expectedSafe);

  const checks = {
    vestingHasCode: Boolean(hasCode),
    identityRegistryMatchesExpected: idRegN === expectedIdRegN,
    adminMatchesExpectedSafe: adminN === expectedSafeN,
  };

  const evidence = {
    schema: "phase-6.1.E-vesting-admin-surface-v1",
    network: {
      name: "baseSepolia",
      chainId: baseSepolia.id,
      rpcUrl,
    },
    pinnedBlock: {
      number: block.number?.toString(),
      hash: block.hash,
      timestamp: block.timestamp?.toString(),
    },
    contracts: {
      vesting: getAddress(vesting),
      expectedIdentityRegistry: expectedIdRegN,
      expectedSafeAdmin: expectedSafeN,
    },
    reads: {
      admin: adminN,
      identityRegistry: idRegN,
      token: tokenN,
      vestingCodeSizeBytes: hasCode ? (code.length - 2) / 2 : 0,
    },
    checks,
  };

  fs.mkdirSync("evidence/phase-6.1.E", { recursive: true });
  fs.writeFileSync("evidence/phase-6.1.E/admin-surface.json", stableStringify(evidence));
  fs.writeFileSync("evidence/phase-6.1.E/admin-surface-abi.json", stableStringify(ABI));

  console.log("✅ Wrote: evidence/phase-6.1.E/admin-surface.json");
  console.log("✅ Wrote: evidence/phase-6.1.E/admin-surface-abi.json");
  console.log("");
  console.log("Pinned block:", evidence.pinnedBlock.number, evidence.pinnedBlock.hash);
  console.log(
    "admin():",
    evidence.reads.admin,
    checks.adminMatchesExpectedSafe ? "✅ matches expected Safe" : "❌ DOES NOT MATCH expected Safe"
  );
  console.log(
    "identityRegistry():",
    evidence.reads.identityRegistry,
    checks.identityRegistryMatchesExpected ? "✅ matches expected" : "❌ DOES NOT MATCH expected"
  );
  console.log("token():", evidence.reads.token);
  console.log("code bytes:", evidence.reads.vestingCodeSizeBytes);
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
