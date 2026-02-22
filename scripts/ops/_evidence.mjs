import fs from "fs";
import path from "path";
import { canonicalStringify, sha256Hex } from "./_canonical-json.mjs";

export function nowIsoSafe() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function writeJsonDeterministic(filepath, obj) {
  const body = canonicalStringify(obj);
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, body, "utf8");
  return { body, sha256: sha256Hex(body) };
}

export function copyLatest(latestPath, timestampedPath) {
  fs.copyFileSync(timestampedPath, latestPath);
}
