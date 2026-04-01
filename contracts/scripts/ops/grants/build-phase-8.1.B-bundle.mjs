#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

const root = process.cwd();
const outPath = path.join(root, "evidence/phase-8.1.B/phase-8.1.B-bundle.json");

const files = {
  vesting_admin_surface: "evidence/phase-8.1.B/vesting-admin-surface.json",
  grant_admin_preflight: "evidence/phase-8.1.B/grant-admin-preflight.json",
};

const bundle = {
  phase: "8.1.B",
  built_at: new Date().toISOString(),
  files: {},
};

for (const [key, relativePath] of Object.entries(files)) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required artifact: ${relativePath}`);
  }
  bundle.files[key] = {
    path: relativePath,
    contents: readJson(fullPath),
  };
}

writeJson(outPath, bundle);
console.log(`Wrote ${outPath}`);
