// scripts/evidence/verify-evidence.js
import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import { createPublicClient, http, keccak256, toBytes } from "viem";
import { baseSepolia } from "viem/chains";

function sha256Hex(bufOrStr) {
  const buf = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(bufOrStr);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function parseManifest(p) {
  const lines = fs.readFileSync(p, "utf8").split("\n");
  const entries = [];
  for (const line of lines) {
    if (!line) continue;
    const m = line.match(/^([a-f0-9]{64})\s\s(.+)$/);
    if (m) entries.push({ sha256: m[1], target: m[2] });
  }
  return entries;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : null;
  };

  const manifestPath = getArg("--manifest");
  if (!manifestPath) {
    console.error("Usage: node scripts/evidence/verify-evidence.js --manifest <manifest.sha256.txt> [--rpc <url>]");
    process.exit(1);
  }

  const rpcUrl =
    getArg("--rpc") || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  const entries = parseManifest(manifestPath);

  // 1) Verify file sha256 checks
  for (const e of entries) {
    if (e.target.endsWith("::canonical")) continue;
    if (!fs.existsSync(e.target)) throw new Error(`Missing file: ${e.target}`);
    const got = sha256Hex(fs.readFileSync(e.target));
    if (got !== e.sha256) {
      throw new Error(`SHA256 mismatch for ${e.target}\nexpected ${e.sha256}\n     got ${got}`);
    }
  }

  // 2) Load bundle (find it by name in manifest)
  const bundleEntry = entries.find((x) =>
    x.target.includes("evidence/part-5.3/governance-evidence-bundle-")
  );
  if (!bundleEntry) throw new Error("Could not find bundle entry in manifest");

  const bundle = JSON.parse(fs.readFileSync(bundleEntry.target, "utf8"));

  // 3) Verify on-chain runtime bytecode keccak256
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  const contracts = bundle?.contracts || {};
  for (const [name, info] of Object.entries(contracts)) {
    const addr = info.address;
    const expected = info.runtimeBytecodeKeccak256;
    const code = (await client.getBytecode({ address: addr })) ?? "0x";
    const got = keccak256(toBytes(code));
    if (got !== expected) {
      throw new Error(`Bytecode hash mismatch for ${name} @ ${addr}\nexpected ${expected}\n     got ${got}`);
    }
  }

  console.log("✅ Evidence verified:");
  console.log(" - file sha256 checks: OK");
  console.log(" - on-chain runtime bytecode checks: OK");
  console.log(" - rpcUrl:", rpcUrl);
  console.log(" - chainId:", await client.getChainId());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
