import { createPublicClient, http, isAddress, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "node:fs";
import path from "node:path";

const ERC20_META_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const rpcUrl = mustEnv("RPC_URL");
  const token = mustEnv("TOKEN");

  if (!isAddress(token)) throw new Error(`TOKEN is not a valid address: ${token}`);

  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  // Pin block (number + hash)
  const pinnedNumber = await client.getBlockNumber();
  const pinnedBlock = await client.getBlock({ blockNumber: pinnedNumber });
  if (!pinnedBlock?.hash) throw new Error("Could not fetch pinned block hash.");

  // Read metadata at pinned block
  const [decimals, name, symbol] = await Promise.all([
    client.readContract({ address: token, abi: ERC20_META_ABI, functionName: "decimals", blockNumber: pinnedNumber }),
    client.readContract({ address: token, abi: ERC20_META_ABI, functionName: "name", blockNumber: pinnedNumber }),
    client.readContract({ address: token, abi: ERC20_META_ABI, functionName: "symbol", blockNumber: pinnedNumber }),
  ]);

  // Integrity check: 1e18 base units
  const GRANT_BASE_UNITS = 10n ** 18n;
  const human = formatUnits(GRANT_BASE_UNITS, decimals);

  const result = {
    phase: "6.1.F",
    chain: { name: baseSepolia.name, chainId: baseSepolia.id },
    rpcUrl,
    pinnedBlock: {
      number: pinnedNumber.toString(),
      hash: pinnedBlock.hash,
      timestamp: pinnedBlock.timestamp.toString(),
    },
    token,
    reads: {
      decimals: Number(decimals),
      name,
      symbol,
    },
    grantIntegrity: {
      baseUnits: GRANT_BASE_UNITS.toString(),
      decimals: Number(decimals),
      humanReadable: human,
      interpretation:
        Number(decimals) === 18
          ? "OK: decimals=18 so 1e18 base units == 1.0 token"
          : "WARNING: decimals != 18; 1e18 base units != 1 token. Recalculate grantBaseUnits = tokens * 10^decimals",
    },
    executedAt: new Date().toISOString(),
    notes: [
      "Reads performed at pinned blockNumber and blockHash for deterministic audit evidence.",
      "Read-only; no state changes.",
    ],
  };

  const outDir = path.join("evidence", "phase-6.1.F");
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outJson = path.join(outDir, `token-metadata-pinned-${stamp}.json`);
  const outLatest = path.join(outDir, "token-metadata-pinned.latest.json");

  fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
  fs.writeFileSync(outLatest, JSON.stringify(result, null, 2));

  console.log("✅ Pinned block:", `${pinnedNumber} ${pinnedBlock.hash}`);
  console.log("✅ Token:", token);
  console.log("✅ decimals:", Number(decimals));
  console.log("✅ name:", name);
  console.log("✅ symbol:", symbol);
  console.log("✅ Grant integrity:", result.grantIntegrity.interpretation);
  console.log("🧾 Evidence written:");
  console.log(" -", outJson);
  console.log(" -", outLatest);
}

main().catch((err) => {
  console.error("❌ Phase 6.1.F token metadata read failed:");
  console.error(err);
  process.exit(1);
});
