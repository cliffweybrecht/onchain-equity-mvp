#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { encodeFunctionData, getAddress } from "viem";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

const registry = getAddress(arg("--registry") || process.env.IDENTITY_REGISTRY_ADDRESS || "");
const user = getAddress(arg("--user") || process.env.TARGET_ADDRESS || "");
const statusRaw = arg("--status") || process.env.NEW_STATUS || "1";
const safe = getAddress(arg("--safe") || process.env.EXPECTED_SAFE_ADMIN || "");
const out = path.resolve(
  arg("--out") ||
    "contracts/evidence/phase-8.1.C/beneficiary-identity-registration-calldata.json"
);

if (!registry) die("Missing --registry or IDENTITY_REGISTRY_ADDRESS");
if (!user) die("Missing --user or TARGET_ADDRESS");
if (!safe) die("Missing --safe or EXPECTED_SAFE_ADMIN");
if (!/^[0-2]$/.test(statusRaw)) die("status must be 0, 1, or 2");

const status = Number(statusRaw);

const abi = [
  {
    type: "function",
    name: "setStatus",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "newStatus", type: "uint8" }
    ],
    outputs: []
  }
];

const data = encodeFunctionData({
  abi,
  functionName: "setStatus",
  args: [user, status]
});

const payload = {
  phase: "8.1.C",
  generated_at: new Date().toISOString(),
  purpose: "Safe/admin-contract execution payload for beneficiary identity verification",
  safe_admin: safe,
  to: registry,
  value: "0",
  function: "setStatus(address,uint8)",
  args: {
    user,
    newStatus: status
  },
  data
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify(payload, null, 2));
