#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
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

function isHexAddress(s) {
  return typeof s === "string" && /^0x[a-f0-9]{40}$/.test(s);
}

/* -------------------------
   Repo Search Fallback
--------------------------*/

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
    // ignore
  }

  const scanRoots = [roots[0], ...evidencePhase7Roots].filter((p) => fs.existsSync(p));

  for (const r of scanRoots) {
    const files = listJsonFilesRecursive(r, { maxFiles: 6000, maxBytes: 1_200_000 });

    for (const f of files) {
      const txt = safeReadText(f);
      if (!txt) continue;

      if (!txt.includes(grantId)) continue;

      try {
        const obj = JSON.parse(txt);

        let b = extractBeneficiary(obj);
        if (isHexAddress(b)) return { beneficiary: b, sourceFile: f };

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

  let entries = null;
  if (Array.isArray(data)) entries = data;
  else if (Array.isArray(data?.grants)) entries = data.grants;
  else if (Array.isArray(data?.items)) entries = data.items;
  else if (data && typeof data === "object") {
    entries = Object.entries(data).map(([k, v]) =>
      v && typeof v === "object" ? { ...v, grantId: v.grantId ?? k } : { grantId: k, value: v }
    );
  }

  if (!entries) throw new Error("Unsupported manifests/grants/index.json shape.");

  const grants = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const grantId = extractGrantId(entry, i);

    let beneficiary = extractBeneficiary(entry);

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

    let sourceFile = "";
    if (!isHexAddress(beneficiary)) {
      const found = findBeneficiaryBySearchingRepo(grantId);
      beneficiary = found.beneficiary;
      sourceFile = found.sourceFile;
    }

    if (!isHexAddress(beneficiary)) {
      throw new Error(`Grant ${grantId} missing/invalid beneficiary: ${beneficiary}`);
    }

    grants.push({ grantId: String(grantId), beneficiary, sourceFile: sourceFile || undefined });
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
  if (!rpcUrl) throw new Error("RPC_URL env var required");

  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl)
  });
}

/* -------------------------
   Registry State Reader
--------------------------*/

async function readGrantStateAtBlock({ client, registryAddress, grant, blockNumber }) {
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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* -------------------------
   Replay Verification
--------------------------*/

async function main() {
  const snapshotPath = process.env.SNAPSHOT_PATH;
  const registryAddress = (process.env.REGISTRY_ADDRESS ?? "").toLowerCase();

  if (!snapshotPath) throw new Error("SNAPSHOT_PATH env var required");
  if (!isHexAddress(registryAddress)) throw new Error("REGISTRY_ADDRESS env var required");

  const snap = readJson(snapshotPath);
  const pinnedBlock = BigInt(snap.blockNumber);

  const client = await getClient();
  const grantsList = loadGrantList();

  // Rebuild snapshot content deterministically.
  // Important: keep createdAt from saved snapshot to avoid mismatch.
  const rebuilt = {
    version: "grant-state-snapshot-v1",
    createdAt: snap.createdAt,
    network: snap.network,
    chainId: snap.chainId,
    blockNumber: snap.blockNumber,
    registry: snap.registry,
    inputs: snap.inputs,
    grants: []
  };

  for (const grant of grantsList) {
    const state = await readGrantStateAtBlock({
      client,
      registryAddress,
      grant,
      blockNumber: pinnedBlock
    });

    rebuilt.grants.push({
      grantId: grant.grantId,
      beneficiary: grant.beneficiary,
      sourceFile: grant.sourceFile,
      state
    });
  }

  // Canonicalize + hash exactly like builder:
  const canonical = canonicalize(rebuilt);
  const json = JSON.stringify(canonical, null, 2) + "\n";
  const hash = sha256Hex(json);
  canonical.sha256 = hash;

  const rebuiltFinal = canonicalize(canonical);

  // Normalize saved snapshot too (don’t “trust” its sha; compare full object)
  const snapFinal = canonicalize(snap);

  const ok = deepEqual(snapFinal, rebuiltFinal);

  if (!ok) {
    console.error("❌ REPLAY MISMATCH: rebuilt snapshot != saved snapshot");
    console.error(`Saved sha256:   ${snap.sha256}`);
    console.error(`Rebuilt sha256: ${hash}`);
    process.exit(1);
  }

  console.log("✅ REPLAY VERIFIED: rebuilt snapshot matches saved snapshot exactly");
  console.log(`✅ sha256: ${hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
