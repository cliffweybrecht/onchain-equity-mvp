#!/usr/bin/env node
import fs from "fs";
import crypto from "crypto";
import path from "path";

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest();
}

function hex(buf) {
  return "0x" + buf.toString("hex");
}

function normalizeAddress(addr) {
  return String(addr).toLowerCase();
}

function normalizeInt(x) {
  // Accept string/number/bigint; normalize to base10 integer string
  return BigInt(x).toString(10);
}

function encodeLeaf(entry) {
  const parts = [
    entry.grantId,
    normalizeAddress(entry.beneficiary),
    normalizeAddress(entry.vestingContract),
    normalizeInt(entry.totalAmount),
    normalizeInt(entry.start),
    normalizeInt(entry.cliff),
    normalizeInt(entry.duration),
    entry.status
  ];

  const leafString = parts.join("|");

  return {
    grantId: entry.grantId,
    leafString,
    leafHash: sha256(Buffer.from(leafString, "utf8"))
  };
}

function buildMerkleTree(leaves) {
  let layer = leaves.map(x => x.leafHash);
  const layers = [layer];

  while (layer.length > 1) {
    const next = [];

    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || layer[i]; // duplicate last if odd
      next.push(sha256(Buffer.concat([left, right])));
    }

    layer = next;
    layers.push(layer);
  }

  return {
    root: layer[0],
    layers
  };
}

function buildProof(index, layers) {
  const proof = [];
  let idx = index;

  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level];
    const isRight = idx % 2 === 1;

    const pairIndex = isRight ? idx - 1 : idx + 1;
    const sibling = layer[pairIndex] || layer[idx]; // self if odd-dup rule

    proof.push({
      position: isRight ? "left" : "right",
      hash: hex(sibling)
    });

    idx = Math.floor(idx / 2);
  }

  return proof;
}

function parseArg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

// NOTE: This hashes raw file bytes. It’s fine as a registry reference if registry.json
// is generated deterministically (stable formatting). If you later want “semantic hash”
// (stable stringify), we can upgrade in Phase 7.4.
function hashFile(file) {
  const data = fs.readFileSync(file);
  return hex(sha256(data));
}

function run() {
  const registryPath = "manifests/grants/registry.json";
  const outputPath = "manifests/grants/merkle-root.json";

  const grantIdArg = parseArg("--grantId");
  const proofOutArg = parseArg("--proofOut");

  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const entries = registry.grants || registry.entries;

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Registry missing grants/entries array (or empty)");
  }

  // Encode leaves, then sort deterministically by grantId
  const leaves = entries.map(encodeLeaf);
  leaves.sort((a, b) => String(a.grantId).localeCompare(String(b.grantId)));

  const tree = buildMerkleTree(leaves);

  const leafHashes = leaves.map(x => ({
    grantId: x.grantId,
    leafHash: hex(x.leafHash)
  }));

  const manifest = {
    schemaVersion: "grant-merkle-root-v1",
    network: registry.network || "Base Sepolia",
    generatedAt: new Date().toISOString(),
    registry: {
      path: registryPath,
      sha256: hashFile(registryPath)
    },
    leafEncoding: {
      type: "utf8-pipe-delimited",
      delimiter: "|",
      normalization: {
        addresses: "lowercase",
        numbers: "base10-integers"
      }
    },
    leafFields: [
      "grantId",
      "beneficiary",
      "vestingContract",
      "totalAmount",
      "start",
      "cliff",
      "duration",
      "status"
    ],
    leafOrder: {
      sortBy: "grantId",
      direction: "asc"
    },
    leafHashes,
    merkleRoot: hex(tree.root),
    notes:
      "Leaf hash = sha256(utf8(grantId|beneficiary|vestingContract|totalAmount|start|cliff|duration|status)). Merkle node = sha256(left||right). Odd nodes duplicate last."
  };

  // Write manifest artifact
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n");

  // Evidence run folder
  const runId = Date.now().toString();
  const evidenceDir = `evidence/phase-7.3/grants-merkle-root/${runId}`;
  fs.mkdirSync(evidenceDir, { recursive: true });

  // Copy manifest into evidence
  fs.writeFileSync(
    `${evidenceDir}/merkle-root.json`,
    JSON.stringify(manifest, null, 2) + "\n"
  );

  // If --grantId provided, write a proof JSON
  if (grantIdArg) {
    const idx = leaves.findIndex(x => x.grantId === grantIdArg);
    if (idx === -1) {
      throw new Error(`grantId not found: ${grantIdArg}`);
    }

    const proof = buildProof(idx, tree.layers);

    const proofObj = {
      schemaVersion: "grant-merkle-proof-v1",
      network: manifest.network,
      generatedAt: new Date().toISOString(),
      registry: manifest.registry,
      merkleRoot: manifest.merkleRoot,
      grantId: grantIdArg,
      leafFields: manifest.leafFields,
      leafEncoding: manifest.leafEncoding,
      leafString: leaves[idx].leafString,
      leafHash: hex(leaves[idx].leafHash),
      index: idx,
      proof
    };

    const targetPath = proofOutArg || `${evidenceDir}/proof.${grantIdArg}.json`;

    fs.writeFileSync(targetPath, JSON.stringify(proofObj, null, 2) + "\n");

    // If custom output used, also persist to evidence for discipline
    if (proofOutArg) {
      fs.writeFileSync(
        `${evidenceDir}/proof.${grantIdArg}.json`,
        JSON.stringify(proofObj, null, 2) + "\n"
      );
    }

    console.log("Proof written:", targetPath);
  }

  console.log("Merkle root built:", manifest.merkleRoot);
  console.log("Evidence:", evidenceDir);
}

run();
