#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function die(msg) {
  console.error("\n[build-audit-packet] ERROR: " + msg + "\n");
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) {
      out[k] = true;
    } else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

function stableStringify(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x);

  if (Array.isArray(x)) {
    return "[" + x.map(stableStringify).join(",") + "]";
  }

  const keys = Object.keys(x).sort();
  const parts = [];

  for (const k of keys) {
    parts.push(JSON.stringify(k) + ":" + stableStringify(x[k]));
  }

  return "{" + parts.join(",") + "}";
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(abs) {
  return sha256(fs.readFileSync(abs));
}

function ensureExists(abs, label) {
  if (!fs.existsSync(abs)) {
    die("Missing " + label + ": " + abs);
  }
}

function walkFiles(absDir) {
  const out = [];
  const stack = [absDir];

  while (stack.length) {
    const d = stack.pop();

    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);

      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile()) out.push(abs);
    }
  }

  return out.sort();
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function writeJson(absPath, obj) {
  fs.writeFileSync(absPath, stableStringify(obj) + "\n");
}

function copyFile(srcAbs, dstAbs) {
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
  fs.copyFileSync(srcAbs, dstAbs);
}

const args = parseArgs(process.argv);

const required = [
  "out",
  "ledger",
  "registry",
  "merkle",
  "state",
  "chainId",
  "network",
  "repo",
  "branch",
  "commit"
];

for (const k of required) {
  if (!args[k]) die("Missing --" + k);
}

const chainId = Number(args.chainId);

if (!Number.isFinite(chainId) || chainId <= 0) {
  die("Invalid --chainId: " + args.chainId);
}

const rootAbs = process.cwd();

const outBaseAbs = path.resolve(rootAbs, args.out);

const ts = String(Date.now());

const packetRootAbs = path.join(outBaseAbs, ts);
const packetDirAbs = path.join(packetRootAbs, "packet");
const inputsAbs = path.join(packetDirAbs, "inputs");

fs.mkdirSync(inputsAbs, { recursive: true });

const inLedgerAbs = path.resolve(rootAbs, args.ledger);
const inRegistryAbs = path.resolve(rootAbs, args.registry);
const inMerkleAbs = path.resolve(rootAbs, args.merkle);
const inStateAbs = path.resolve(rootAbs, args.state);

ensureExists(inLedgerAbs, "ledger index");
ensureExists(inRegistryAbs, "registry snapshot");
ensureExists(inMerkleAbs, "merkle root");
ensureExists(inStateAbs, "state snapshot");

copyFile(inLedgerAbs, path.join(inputsAbs, "grants-index.json"));
copyFile(inRegistryAbs, path.join(inputsAbs, "grants-registry-snapshot.json"));
copyFile(inMerkleAbs, path.join(inputsAbs, "grants-merkle-root.json"));
copyFile(inStateAbs, path.join(inputsAbs, "grants-state-snapshot.json"));

fs.writeFileSync(
  path.join(packetDirAbs, "README.md"),
  [
    "# Grant Audit Packet (Phase 7.6)",
    "",
    "Self-contained audit packet.",
    "",
    "Files:",
    "- packet.json",
    "- sha256-manifest.json",
    "- inputs/",
    ""
  ].join("\n")
);

const packetJsonAbs = path.join(packetDirAbs, "packet.json");

const packet = {
  schema: "grant-audit-packet-v1",
  packet_version: "1.0.0",
  created_at: new Date().toISOString(),
  git: {
    repo: args.repo,
    branch: args.branch,
    commit: args.commit
  },
  network: {
    name: args.network,
    chain_id: chainId,
    rpc_hint: args.rpcHint || ""
  },
  contracts: {},
  inputs: {
    grants_ledger_index: "packet/inputs/grants-index.json",
    grants_registry_snapshot: "packet/inputs/grants-registry-snapshot.json",
    merkle_root: "packet/inputs/grants-merkle-root.json",
    state_snapshot: "packet/inputs/grants-state-snapshot.json"
  },
  artifacts: {
    verifications: [],
    notes: [
      "Self-contained audit packet",
      "Integrity verified by sha256 manifest"
    ]
  },
  integrity: {
    sha256_manifest: "packet/sha256-manifest.json",
    sha256_manifest_hash: ""
  }
};

writeJson(packetJsonAbs, packet);

const manifestAbs = path.join(packetDirAbs, "sha256-manifest.json");

function computeManifest() {
  const files = walkFiles(packetDirAbs).filter(
    (abs) => !abs.endsWith("sha256-manifest.json")
  );

  return {
    schema: "sha256-manifest-v1",
    created_at: new Date().toISOString(),
    root: "packet/",
    files: files.map((abs) => ({
      path: "packet/" + toPosix(path.relative(packetDirAbs, abs)),
      sha256: sha256File(abs)
    }))
  };
}

const manifest1 = computeManifest();
writeJson(manifestAbs, manifest1);

const manifestHash = sha256File(manifestAbs);

const packet2 = JSON.parse(fs.readFileSync(packetJsonAbs, "utf8"));
packet2.integrity.sha256_manifest_hash = manifestHash;

writeJson(packetJsonAbs, packet2);

const manifest2 = computeManifest();
manifest2.created_at = manifest1.created_at;

writeJson(manifestAbs, manifest2);

const relPacketRoot = path.relative(rootAbs, packetRootAbs);
const relPacketJson = path.relative(rootAbs, packetJsonAbs);
const relManifest = path.relative(rootAbs, manifestAbs);

console.log("");
console.log("[build-audit-packet] OK");
console.log("[build-audit-packet] Wrote: " + relPacketRoot);
console.log("[build-audit-packet] Packet: " + relPacketJson);
console.log("[build-audit-packet] Manifest: " + relManifest);
console.log("");
