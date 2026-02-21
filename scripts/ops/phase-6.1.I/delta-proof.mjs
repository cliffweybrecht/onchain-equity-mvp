#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const OUTDIR = "evidence/phase-6.1.I";
const PRE = process.env.PRE || path.join(OUTDIR, "pinned-snapshot.block-37962534.json");
const POST = process.env.POST || path.join(OUTDIR, "pinned-snapshot.postclaim.block-37964295.json");
const OUT = process.env.OUT || path.join(OUTDIR, "delta-proof.v2.json");

function die(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function canonicalize(value) {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
  return out;
}

function writeCanonical(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(canonicalize(obj), null, 2) + "\n");
}

function readJson(p) {
  if (!fs.existsSync(p)) die(`Missing file: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readOk(snapshot, key) {
  const r = snapshot?.reads?.[key];
  if (!r || r.ok !== true) return { ok: false, value: null, error: r?.error || "missing_or_not_ok" };
  return { ok: true, value: r.value, error: null };
}

function toBigIntMaybe(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") {
    try {
      return v.startsWith("0x") ? BigInt(v) : BigInt(v);
    } catch {
      return null;
    }
  }
  return null;
}

function delta(a, b) {
  const A = toBigIntMaybe(a);
  const B = toBigIntMaybe(b);
  if (A === null || B === null) return null;
  return (B - A).toString(10);
}

function asGrantObject(grantsValue) {
  // Your pinned snapshot stores the raw tuple from grants(employee).
  // We will map indices to meaningful names.
  // Observed shape (from your delta proof):
  // [0]=total, [1]=released, [2]=start, [3]=cliff, [4]=duration, [5]=active(bool)
  if (!Array.isArray(grantsValue)) return null;
  return {
    total: grantsValue[0] ?? null,
    released: grantsValue[1] ?? null,
    start: grantsValue[2] ?? null,
    cliff: grantsValue[3] ?? null,
    duration: grantsValue[4] ?? null,
    active: grantsValue[5] ?? null,
    raw: grantsValue,
  };
}

async function main() {
  const pre = readJson(PRE);
  const post = readJson(POST);

  if (pre.schema !== "phase-6.1.I.pinned-snapshot.v1") die(`Unexpected PRE schema: ${pre.schema}`);
  if (post.schema !== "phase-6.1.I.pinned-snapshot.v1") die(`Unexpected POST schema: ${post.schema}`);

  const vestedPre = readOk(pre, "vestedAmount");
  const vestedPost = readOk(post, "vestedAmount");

  const grantsPre = readOk(pre, "grants");
  const grantsPost = readOk(post, "grants");

  const gPre = grantsPre.ok ? asGrantObject(grantsPre.value) : null;
  const gPost = grantsPost.ok ? asGrantObject(grantsPost.value) : null;

  const proof = {
    schema: "phase-6.1.I.delta-proof.v2",
    at: new Date().toISOString(),
    preSnapshot: PRE,
    postSnapshot: POST,
    preBlock: pre.block,
    postBlock: post.block,
    vestingContract: post.vestingContract,
    beneficiary: post.beneficiary,

    // High-signal deltas (what changed because of claim)
    deltas: {
      vestedAmount: {
        preOk: vestedPre.ok,
        postOk: vestedPost.ok,
        pre: vestedPre.ok ? vestedPre.value : null,
        post: vestedPost.ok ? vestedPost.value : null,
        delta: (vestedPre.ok && vestedPost.ok) ? delta(vestedPre.value, vestedPost.value) : null,
        preError: vestedPre.error,
        postError: vestedPost.error,
      },

      grant: {
        preOk: grantsPre.ok,
        postOk: grantsPost.ok,
        pre: gPre,
        post: gPost,
        // Core claim delta: released increments
        releasedDelta: (gPre && gPost) ? delta(gPre.released, gPost.released) : null,
        totalDelta: (gPre && gPost) ? delta(gPre.total, gPost.total) : null,
        preError: grantsPre.error,
        postError: grantsPost.error,
      },
    },

    // For transparency: what functions are absent on ABI (from pinned reads)
    missingReads: Object.fromEntries(
      Object.entries(pre.reads || {})
        .filter(([_, v]) => v && v.ok === false && typeof v.error === "string" && v.error.includes("Function"))
        .map(([k, v]) => [k, v.error])
    ),
  };

  writeCanonical(OUT, proof);
  console.log("✅ wrote", OUT);
}

main().catch((e) => die(String(e)));
