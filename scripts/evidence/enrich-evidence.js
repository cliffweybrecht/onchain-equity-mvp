// scripts/evidence/enrich-evidence.js
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalize } from "./canonical-json.js";

import { createPublicClient, http, keccak256, toBytes } from "viem";
import { baseSepolia } from "viem/chains";

function sha256Hex(bufOrStr) {
  const buf = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(bufOrStr);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function nowStamp() {
  // UTC timestamp like 2026-02-07T19-30-49Z (colon -> dash for filenames)
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

function mustReadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeFileEnsuringDir(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function resolveContractsFromEvidenceOrDeployments(evidence, deploymentsPath) {
  const out = {};

  if (evidence?.contracts && typeof evidence.contracts === "object") {
    for (const [name, v] of Object.entries(evidence.contracts)) {
      if (typeof v === "string") out[name] = v;
      else if (v?.address) out[name] = v.address;
    }
  }

  if (Object.keys(out).length > 0) return out;

  if (deploymentsPath && fs.existsSync(deploymentsPath)) {
    const dep = mustReadJson(deploymentsPath);

    if (dep.contracts && typeof dep.contracts === "object") {
      for (const [name, v] of Object.entries(dep.contracts)) {
        if (typeof v === "string") out[name] = v;
        else if (v?.address) out[name] = v.address;
      }
    } else {
      for (const [name, v] of Object.entries(dep)) {
        if (typeof v === "string" && v.startsWith("0x")) out[name] = v;
        else if (v?.address) out[name] = v.address;
      }
    }
  }

  return out;
}

function buildExplicitInvariants(evidence) {
  const assertions = [];
  const inv = evidence?.invariants || evidence?.checks || null;

  if (inv && typeof inv === "object") {
    for (const [k, v] of Object.entries(inv)) {
      assertions.push({ id: `INV:${k}`, expected: v });
    }
  }

  assertions.push(
    { id: "INV:contracts.solidityUnmodified", expected: true },
    { id: "INV:oneCommandVerificationAvailable", expected: true }
  );

  return { assertions };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : null;
  };

  const input = getArg("--in");
  if (!input) {
    console.error("Usage: node scripts/evidence/enrich-evidence.js --in <evidence.json> [--rpc <url>] [--deployments <path>]");
    process.exit(1);
  }

  const rpcUrl =
    getArg("--rpc") || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const deploymentsPath = getArg("--deployments") || "deployments/base-sepolia.json";

  const evidence = mustReadJson(input);

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const chainId = await client.getChainId();
  const blockNumber = await client.getBlockNumber();

  const contracts = resolveContractsFromEvidenceOrDeployments(evidence, deploymentsPath);
  const contractHashes = {};

  for (const [name, address] of Object.entries(contracts)) {
    const code = (await client.getBytecode({ address })) ?? "0x";
    contractHashes[name] = {
      address,
      runtimeBytecodeKeccak256: keccak256(toBytes(code)),
      byteLength: (code.length - 2) / 2,
    };
  }

  const canonical = canonicalize(evidence);
  const raw = fs.readFileSync(input, "utf8");

  const bundle = {
    schema: "governance-evidence-bundle@1.0.0",
    part: "5.3",
    source: {
      path: input,
      rawSha256: sha256Hex(raw),
      canonicalSha256: sha256Hex(canonical),
    },
    environment: {
      chainId,
      rpcUrl,
      blockNumber: blockNumber.toString(),
      node: process.version,
      platform: process.platform,
    },
    contracts: contractHashes,
    invariants: buildExplicitInvariants(evidence),
    evidence,
  };

  const ts = nowStamp();
  const outJson = `evidence/part-5.3/governance-evidence-bundle-${ts}.json`;
  writeFileEnsuringDir(outJson, JSON.stringify(bundle, null, 2) + "\n");

  const manifest = [
    sha256Hex(fs.readFileSync(outJson)) + "  " + outJson,
    sha256Hex(raw) + "  " + input,
    sha256Hex(canonical) + "  " + input + "::canonical",
  ].join("\n") + "\n";

  const outManifest = `evidence/part-5.3/manifest-${ts}.sha256.txt`;
  writeFileEnsuringDir(outManifest, manifest);

  console.log("== Part 5.3 Evidence Bundle Generated ==");
  console.log("bundle:", outJson);
  console.log("manifest:", outManifest);
  console.log("chainId:", chainId);
  console.log("blockNumber:", blockNumber.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
