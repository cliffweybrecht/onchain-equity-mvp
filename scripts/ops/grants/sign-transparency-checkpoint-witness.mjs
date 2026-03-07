import fs from "fs";
import path from "path";
import crypto from "crypto";

function sortKeysRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }

  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysRecursively(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function canonicalize(value) {
  return JSON.stringify(sortKeysRecursively(value));
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, canonicalize(value) + "\n");
}

function signHexSha256WithPem(privateKeyPem, messageHex) {
  const signer = crypto.createSign("SHA256");
  signer.update(Buffer.from(messageHex, "utf8"));
  signer.end();
  return signer.sign(privateKeyPem).toString("base64");
}

function resolvePublicKeyRef(witness) {
  return (
    witness.public_key_pem_path ||
    witness.public_key ||
    witness.public_key_path ||
    witness.publicKey ||
    witness.publicKeyPath ||
    null
  );
}

function derivePrivateKeyRefFromPublicKey(publicKeyRef) {
  if (!publicKeyRef) return null;

  if (publicKeyRef.endsWith("-public.pem")) {
    return publicKeyRef.replace(/-public\.pem$/, "-private.pem");
  }

  if (publicKeyRef.endsWith("-public-key.pem")) {
    return publicKeyRef.replace(/-public-key\.pem$/, "-private-key.pem");
  }

  return null;
}

function normalizeAlgorithm(value) {
  if (!value) return "rsa-pss-sha256";

  const normalized = String(value).trim().toUpperCase();

  if (normalized === "RSA-SHA256") {
    return "rsa-pss-sha256";
  }

  return value.toLowerCase();
}

const repoRoot = process.cwd();
const manifestsDir = path.join(repoRoot, "manifests", "transparency");

const checkpointPath = path.join(manifestsDir, "checkpoint.json");
const witnessKeyringPath = path.join(manifestsDir, "witness-keyring.json");
const outputPath = path.join(manifestsDir, "checkpoint-witnesses.json");

const checkpoint = readJson(checkpointPath);
const witnessKeyring = readJson(witnessKeyringPath);

const checkpointCanonical = canonicalize(checkpoint);
const checkpointHash = sha256Hex(checkpointCanonical);

const requiredWitnessThreshold =
  witnessKeyring.required_witness_threshold ??
  witnessKeyring.signed_witness_threshold ??
  witnessKeyring.witness_threshold ??
  (witnessKeyring.witnesses || []).length ??
  1;

const witnesses = (witnessKeyring.witnesses || []).map((witness) => {
  if (!witness.witness_id) {
    throw new Error("Each witness entry must include witness_id");
  }

  const publicKeyRef = resolvePublicKeyRef(witness);

  if (!publicKeyRef) {
    throw new Error(
      `Unable to resolve public key path for witness ${witness.witness_id}`
    );
  }

  const privateKeyRef =
    witness.private_key_pem_path ||
    witness.private_key ||
    witness.private_key_path ||
    witness.privateKey ||
    witness.privateKeyPath ||
    derivePrivateKeyRefFromPublicKey(publicKeyRef);

  if (!privateKeyRef) {
    throw new Error(
      `Unable to resolve private key path for witness ${witness.witness_id}`
    );
  }

  const publicKeyPath = path.join(repoRoot, publicKeyRef);
  const privateKeyPath = path.join(repoRoot, privateKeyRef);

  if (!fs.existsSync(publicKeyPath)) {
    throw new Error(
      `Missing public key for witness ${witness.witness_id}: ${publicKeyPath}`
    );
  }

  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(
      `Missing private key for witness ${witness.witness_id}: ${privateKeyPath}`
    );
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
  const signatureBase64 = signHexSha256WithPem(privateKeyPem, checkpointHash);

  return {
    algorithm: normalizeAlgorithm(
      witness.key_algorithm || witness.algorithm || witness.signature_algorithm
    ),
    checkpoint_hash: checkpointHash,
    checkpoint_path: "manifests/transparency/checkpoint.json",
    public_key_path: publicKeyRef,
    signature_base64: signatureBase64,
    witness_id: witness.witness_id
  };
});

const artifact = {
  artifact_type: "transparency_checkpoint_witnesses",
  canonicalization: {
    json_mode: "canonical_json",
    key_ordering: "recursive_lexicographic",
    numeric_normalization: "verbatim_json_number_encoding",
    whitespace: "minimal"
  },
  checkpoint_hash: checkpointHash,
  checkpoint_path: "manifests/transparency/checkpoint.json",
  schema_version: "grant-audit-transparency-checkpoint-witnesses-v1",
  signed_witness_threshold: requiredWitnessThreshold,
  witness_count: witnesses.length,
  witnesses
};

artifact.artifact_hash = sha256Hex(canonicalize(artifact));

writeJson(outputPath, artifact);

console.log(
  JSON.stringify(
    {
      checkpoint_hash: checkpointHash,
      output_path: "manifests/transparency/checkpoint-witnesses.json",
      witness_count: witnesses.length,
      artifact_hash: artifact.artifact_hash
    },
    null,
    2
  )
);
