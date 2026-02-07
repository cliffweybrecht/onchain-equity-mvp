import fs from "node:fs";
import path from "node:path";

/**
 * Recursively sort object keys for deterministic JSON output
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

function timestamp() {
  if (process.env.EVIDENCE_TS) {
    return process.env.EVIDENCE_TS;
  }
  const iso = new Date().toISOString();
  return iso.replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

export function writeEvidenceJson({ dir, prefix, payload }) {
  fs.mkdirSync(dir, { recursive: true });

  const stamp = timestamp();
  const filename = `${prefix}-${stamp}.json`;
  const fullpath = path.join(dir, filename);

  const stablePayload = sortKeysDeep(payload);
  fs.writeFileSync(fullpath, JSON.stringify(stablePayload, null, 2) + "\n");

  return { fullpath, filename };
}
