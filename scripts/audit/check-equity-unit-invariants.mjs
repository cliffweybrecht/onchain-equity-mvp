#!/usr/bin/env node
import fs from "fs";
import path from "path";

const TARGET_DIRS = [
  "scripts/demo",
  "scripts/ops/grants"
];

const IGNORE_PATHS = [
  "contracts/evidence",
  "evidence",
  "artifacts",
  ".git",
  "node_modules"
];

const suspiciousPatterns = [
  "1000000000000000000",
  "parseEther(",
  "formatEther(",
  "1e18",
  "10n ** 18n",
  "10 ** 18"
];

function shouldIgnore(p) {
  return IGNORE_PATHS.some((x) => p.includes(x));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (shouldIgnore(full)) continue;

    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }

  return out;
}

function main() {
  const findings = [];

  for (const dir of TARGET_DIRS) {
    for (const file of walk(dir)) {
      const text = fs.readFileSync(file, "utf8");

      for (const pattern of suspiciousPatterns) {
        if (text.includes(pattern)) {
          findings.push({ file, pattern });
        }
      }
    }
  }

  const result = {
    phase: "8.3",
    check: "equity-unit-invariants",
    passed: findings.length === 0,
    findings
  };

  console.log(JSON.stringify(result, null, 2));

  if (findings.length > 0) {
    process.exit(1);
  }
}

main();
