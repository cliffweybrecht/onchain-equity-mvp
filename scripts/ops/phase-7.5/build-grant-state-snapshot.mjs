#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

// Stable canonical JSON: sorts object keys recursively, preserves array order
function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
  return out;
}

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function writeFileAtomic(filePath, contents) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

/* -------------------------
   Beneficiary Extraction
--------------------------*/

function extractBeneficiary(obj) {
  if (!obj || typeof obj !== "object") return "";

  const candidates = [
    obj.beneficiary,
    obj.beneficiaryAddress,
    obj.beneficiary_address,
    obj.recipient,
    obj.recipientAddress,
    obj.recipient_address,
    obj.wallet,
    obj.walletAddress,
    obj.address
  ];

  // common nesting patterns
  if (obj.grant && typeof obj.grant === "object") {
    candidates.push(
      obj.grant.beneficiary,
      obj.grant.beneficiaryAddress,
      obj.grant.recipient,
      obj.grant.recipientAddress,
      obj.grant.wallet
    );
  }
  if (obj.data && typeof obj.data === "object") {
    candidates.push(
      obj.data.beneficiary,
      obj.data.beneficiaryAddress,
      obj.data.recipient,
      obj.data.recipientAddress,
      obj.data.wallet
    );
  }

  const hit = candidates.find((x) => typeof x === "string" && x.length > 0) ?? "";
  return hit.toLowerCase();
}

function extractGrantId(obj, fallback) {
  if (!obj || typeof obj !== "object") return String(fallback);
  return String(obj.grantId ?? obj.id ?? obj.grant_id ?? obj.key ?? fallback);
}

function extractManifestPath(obj) {
  if (!obj || typeof obj !== "object") return "";
  const hit =
    obj.manifestPath ??
    obj.manifest ??
    obj.path ??
    obj.file ??
    obj.uri ??
    obj.ref ??
    obj.source ??
    obj.pointer ??
    obj.manifest_file ??
    "";
  return typeof hit === "string" ? hit : "";
}

/* -------------------------
   Repo Search Fallback
--------------------------*/

function isHexAddress(s) {
  return typeof s === "string" && /^0x[a-f0-9]{40}$/.test(s);
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function listJsonFilesRecursive(rootDir, { maxFiles = 6000, maxBytes = 1_200_000 } = {}) {
  const out = [];
  const stack = [rootDir];

  while (stack.length && out.length < maxFiles) {
    const d = stack.pop();
    if (!d) break;

    let ents = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of ents) {
      const p = path.join(d, ent.name);

      // skip node_modules / .git aggressively
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        stack.push(p);
        continue;
      }

      if (!ent.isFile()) continue;
      if (!ent.name.endsWith(".json")) continue;

      try {
        const st = fs.statSync(p);
        if (st.size > maxBytes) continue;
      } catch {
        continue;
      }

      out.push(p);
      if (out.length >= maxFiles) break;
    }
  }

  return out;
}

function findBeneficiaryBySearchingRepo(grantId) {
  const roots = [
    path.resolve("manifests/grants"),
    path.resolve("evidence")
  ];

  // Only scan likely Phase-7 evidence directories within evidence/
  const evidencePhase7Roots = [];
  try {
    const entries = fs.readdirSync(roots[1], { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith("phase-7")) {
        evidencePhase7Roots.push(path.resolve("evidence", e.name));
      }
    }
  } catch {
    // ignore if evidence missing
  }

  const scanRoots = [roots[0], ...evidencePhase7Roots].filter((p) => fs.existsSync(p));

  for (const r of scanRoots) {
    const files = listJsonFilesRecursive(r, { maxFiles: 6000, maxBytes: 1_200_000 });

    for (const f of files) {
      const txt = safeReadText(f);
      if (!txt) continue;

      // fast substring filter before JSON parse
      if (!txt.includes(grantId)) continue;

      try {
        const obj = JSON.parse(txt);

        // Direct beneficiary extraction
        let b = extractBeneficiary(obj);
        if (isHexAddress(b)) return { beneficiary: b, sourceFile: f };

        // Some files may be arrays of grants/manifests
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const maybeId =
              (item && typeof item === "object" && (item.grantId ?? item.id ?? item.grant_id)) ?? null;
            if (String(maybeId) === grantId || JSON.stringify(item).includes(grantId)) {
              b = extractBeneficiary(item);
              if (isHexAddress(b)) return { beneficiary: b, sourceFile: f };
            }
          }
        }

        // Or nested lists:
        for (const key of ["grants", "items", "entries", "records"]) {
          const arr = obj?.[key];
          if (Array.isArray(arr)) {
            for (const item of arr) {
              const maybeId =
                (item && typeof item === "object" && (item.grantId ?? item.id ?? item.grant_id)) ?? null;
              if (String(maybeId) === grantId || JSON.stringify(item).includes(grantId)) {
                b = extractBeneficiary(item);
                if (isHexAddress(b)) return { beneficiary: b, sourceFile: f };
              }
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  return { beneficiary: "", sourceFile: "" };
}

/* -------------------------
   Load deterministic list
--------------------------*/

function loadGrantList() {
  const indexPath = path.resolve("manifests/grants/index.json");
  const data = readJson(indexPath);

  // Normalize to a list of entries, supporting:
  // - [ ... ]
  // - { grants: [ ... ] }
  // - { items: [ ... ] }
  // - { <grantId>: { ... }, ... }  (object map)
  let entries = null;

  if (Array.isArray(data)) entries = data;
  else if (Array.isArray(data?.grants)) entries = data.grants;
  else if (Array.isArray(data?.items)) entries = data.items;
  else if (data && typeof data === "object") {
    entries = Object.entries(data).map(([k, v]) =>
      v && typeof v === "object" ? { ...v, grantId: v.grantId ?? k } : { grantId: k, value: v }
    );
  }

  if (!entries) {
    throw new Error(`Unsupported manifests/grants/index.json shape. Adapt loadGrantList().`);
  }

  const grants = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const grantId = extractGrantId(entry, i);

    // 1) Try beneficiary directly from index entry
    let beneficiary = extractBeneficiary(entry);

    // 2) If missing, try following pointer fields (if any)
    if (!isHexAddress(beneficiary)) {
      const p = extractManifestPath(entry);
      const probe = [];
      if (p) {
        const r1 = path.resolve(p);
        const r2 = path.resolve("manifests/grants", p);
        if (fs.existsSync(r1)) probe.push(r1);
        if (fs.existsSync(r2)) probe.push(r2);
      }

      for (const filePath of probe) {
        try {
          const manifest = readJson(filePath);
          const b = extractBeneficiary(manifest);
          if (isHexAddress(b)) {
            beneficiary = b;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    // 3) Repo-search fallback: find a JSON that contains the grantId and a beneficiary/recipient field
    let sourceFile = "";
    if (!isHexAddress(beneficiary)) {
      const found = findBeneficiaryBySearchingRepo(grantId);
      beneficiary = found.beneficiary;
      sourceFile = found.sourceFile;
    }

    if (!isHexAddress(beneficiary)) {
      throw new Error(`Grant ${grantId} missing/invalid beneficiary: ${beneficiary}`);
    }

    grants.push({
      grantId: String(grantId),
      beneficiary,
      sourceFile: sourceFile || undefined
    });
  }

  return grants;
}

/* -------------------------
   Blockchain Client
--------------------------*/

async function getClient() {
  const { createPublicClient, http } = await import("viem");
  const { baseSepolia } = await import("viem/chains");

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL environment variable required");

  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl)
  });
}

/* -------------------------
   Registry State Reader
--------------------------*/

// Reads IdentityRegistry.isVerified(beneficiary) at the pinned block.
// (Your deployments only show IdentityRegistry on Base Sepolia right now.)
async function readGrantState({ client, grant }) {
  const registryAddress = (process.env.REGISTRY_ADDRESS ?? "").toLowerCase();
  const blockNumber = BigInt(process.env.BLOCK_NUMBER);

  if (!/^0x[a-f0-9]{40}$/.test(registryAddress)) {
    throw new Error("REGISTRY_ADDRESS invalid/missing");
  }

  const abi = [
    {
      name: "isVerified",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "user", type: "address" }],
      outputs: [{ name: "", type: "bool" }]
    }
  ];

  const verified = await client.readContract({
    address: registryAddress,
    abi,
    functionName: "isVerified",
    args: [grant.beneficiary],
    blockNumber
  });

  return {
    beneficiary: grant.beneficiary,
    verified
  };
}

/* -------------------------
   Snapshot Builder
--------------------------*/

async function main() {
  const network = process.env.NETWORK ?? "base-sepolia";
  const blockNumberStr = process.env.BLOCK_NUMBER;
  const registryAddress = (process.env.REGISTRY_ADDRESS ?? "").toLowerCase();

  if (!blockNumberStr) throw new Error("BLOCK_NUMBER required");
  if (!/^0x[a-f0-9]{40}$/.test(registryAddress)) throw new Error("REGISTRY_ADDRESS required");

  const blockNumber = Number(blockNumberStr);

  const client = await getClient();
  const grants = loadGrantList();

  const snapshot = {
    version: "grant-state-snapshot-v1",
    createdAt: new Date().toISOString(),
    network,
    chainId: 84532,
    blockNumber,
    registry: {
      address: registryAddress
    },
    inputs: {
      manifestsGrantsIndex: "manifests/grants/index.json",
      blockNumber: blockNumberStr
    },
    grants: []
  };

  for (const grant of grants) {
    const state = await readGrantState({ client, grant });

    snapshot.grants.push({
      grantId: grant.grantId,
      beneficiary: grant.beneficiary,
      // This is extra provenance for debugging/auditability (optional)
      sourceFile: grant.sourceFile,
      state
    });
  }

  const canonical = canonicalize(snapshot);
  const json = JSON.stringify(canonical, null, 2) + "\n";
  const hash = sha256Hex(json);

  canonical.sha256 = hash;
  const finalJson = JSON.stringify(canonical, null, 2) + "\n";

  const ts = Date.now().toString();
  const outDir = path.resolve("evidence/phase-7.5/grants-state-snapshot", ts);
  mkdirp(outDir);

  writeFileAtomic(path.join(outDir, "snapshot.json"), finalJson);
  writeFileAtomic(path.join(outDir, "snapshot.sha256"), hash + "\n");
  writeFileAtomic(
    path.join(outDir, "summary.json"),
    JSON.stringify(
      {
        network,
        blockNumber: blockNumberStr,
        registryAddress,
        grants: grants.length,
        sha256: hash
      },
      null,
      2
    ) + "\n"
  );

  console.log(`✅ Wrote snapshot: ${path.join(outDir, "snapshot.json")}`);
  console.log(`✅ sha256: ${hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
