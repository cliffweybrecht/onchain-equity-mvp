import crypto from "crypto";

export function sortKeysDeep(x) {
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  if (x && typeof x === "object") {
    const out = {};
    for (const k of Object.keys(x).sort()) out[k] = sortKeysDeep(x[k]);
    return out;
  }
  return x;
}

export function canonStringify(x) {
  return JSON.stringify(sortKeysDeep(x), null, 2) + "\n";
}

export function sha256Hex(utf8) {
  return "0x" + crypto.createHash("sha256").update(utf8, "utf8").digest("hex");
}
