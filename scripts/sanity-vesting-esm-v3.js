import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadArtifact(relPath) {
  const p = path.resolve(relPath);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function robustRead(readFn, { label = "read", tries = 30, delayMs = 1200 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await readFn();
    } catch (e) {
      lastErr = e;
      await sleep(delayMs);
    }
  }
  throw new Error(`[robustRead] Failed after ${tries} tries (${label}): ${lastErr?.message ?? lastErr}`);
}

async function main() {
