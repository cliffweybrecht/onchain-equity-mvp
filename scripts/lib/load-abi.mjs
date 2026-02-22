import fs from "fs";
import path from "path";

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function walk(dir, out = []) {
  if (!exists(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function loadAbiOrThrow({ contractHint }) {
  const deploymentsDir = path.resolve("deployments");
  for (const f of walk(deploymentsDir)) {
    if (!f.endsWith(".json")) continue;
    if (!f.toLowerCase().includes(contractHint.toLowerCase())) continue;
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (j.abi) return { abi: j.abi, source: f };
  }

  const artifactsDir = path.resolve("artifacts");
  for (const f of walk(artifactsDir)) {
    if (!f.endsWith(".json")) continue;
    if (!f.toLowerCase().includes(`${contractHint.toLowerCase()}.json`)) continue;
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (j.abi) return { abi: j.abi, source: f };
  }

  throw new Error(
    `Could not find ABI for "${contractHint}" in deployments/ or artifacts/. ` +
    `Build artifacts or add a deployments JSON with "abi".`
  );
}
