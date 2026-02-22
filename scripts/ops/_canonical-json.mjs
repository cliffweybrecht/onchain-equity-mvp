import crypto from "crypto";

function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

export function canonicalize(value) {
  // ✅ make BigInt JSON-safe deterministically
  if (typeof value === "bigint") return value.toString();

  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value), null, 2) + "\n";
}

export function sha256Hex(bufOrStr) {
  const buf = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr));
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}
