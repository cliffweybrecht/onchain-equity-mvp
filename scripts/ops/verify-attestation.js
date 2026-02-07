#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";
import process from "process";
import { recoverMessageAddress, getAddress } from "viem";

function usage(code = 0) {
  console.log(`Usage:
  node scripts/ops/verify-attestation.js --attestation <path> [--manifest <path>] [--expected-signer <0xaddr>]
`);
  process.exit(code);
}

function args() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === "-h" || k === "--help") usage(0);
    if (!k.startsWith("--")) throw new Error("Bad arg: " + k);
    const v = a[i + 1];
    if (!v || v.startsWith("--")) throw new Error("Missing value for " + k);
    out[k.slice(2)] = v;
    i++;
  }
  return out;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function normHex(x) { if (!x) return ""; x = String(x); return (x.startsWith("0x") ? x : "0x" + x).toLowerCase(); }
function sha256HexUtf8(s) { return "0x" + crypto.createHash("sha256").update(s, "utf8").digest("hex"); }

function canonicalize(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "string" || t === "boolean") return JSON.stringify(v);
  if (t === "number") {
    if (!Number.isFinite(v)) throw new Error("Non-finite number in manifest");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (t === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(",")}}`;
  }
  throw new Error("Unsupported type: " + t);
}

function printHuman(checks) {
  const ok = checks.every(c => c.ok);
  console.log("");
  console.log("== Verify Attestation ==");
  for (const c of checks) {
    console.log(`${c.ok ? "✅ PASS" : "❌ FAIL"}  ${c.name}`);
    if (c.detail) console.log("       " + c.detail);
    if (!c.ok && c.error) console.log("       error: " + c.error);
  }
  console.log("");
  console.log(ok ? "RESULT: ✅ PASS" : "RESULT: ❌ FAIL");
  console.log("");
  return ok;
}

async function main() {
  const a = args();
  const attPath = a.attestation;
  if (!attPath) usage(1);

  const attAbs = path.resolve(attPath);
  const att = readJson(attAbs);

  const manifestPath = a.manifest || att?.subject?.path;
  if (!manifestPath) throw new Error("No manifest path (use --manifest or attestation.subject.path)");
  const manAbs = path.resolve(manifestPath);
  const manifest = readJson(manAbs);

  const checks = [];

  // 1) canonicalize manifest
  let canonical = "";
  try {
    canonical = canonicalize(manifest);
    checks.push({ name: "canonicalize(manifest)", ok: true, detail: `len=${canonical.length}` });
  } catch (e) {
    checks.push({ name: "canonicalize(manifest)", ok: false, error: String(e?.message || e) });
  }

  // 2) manifest digest check
  let digestComputed = "";
  let digestClaimed = "";
  try {
    digestComputed = sha256HexUtf8(canonical);
    digestClaimed = normHex(att?.subject?.digest?.value);
    checks.push({
      name: "sha256(canonical manifest) matches attestation.subject.digest.value",
      ok: normHex(digestComputed) === digestClaimed,
      detail: `computed=${digestComputed} claimed=${digestClaimed}`,
    });
  } catch (e) {
    checks.push({ name: "sha256(canonical manifest) matches attestation.subject.digest.value", ok: false, error: String(e?.message || e) });
  }

  // 3) preimage + digest check (matches your committed attestation format)
  let preimage = "";
  let preDigestComputed = "";
  let preDigestClaimed = "";
  try {
    const digestNo0x = normHex(att?.subject?.digest?.value).replace(/^0x/, "");
    preimage = `onchain-equity.attestation.v1\nmanifest.sha256:${digestNo0x}`;
    preDigestComputed = sha256HexUtf8(preimage);
    preDigestClaimed = normHex(att?.signature?.preimageDigest?.value);
    checks.push({
      name: "sha256(preimage) matches attestation.signature.preimageDigest.value",
      ok: normHex(preDigestComputed) === preDigestClaimed,
      detail: `computed=${preDigestComputed} claimed=${preDigestClaimed}`,
    });
  } catch (e) {
    checks.push({ name: "sha256(preimage) matches attestation.signature.preimageDigest.value", ok: false, error: String(e?.message || e) });
  }

  // 4) recover signer check
  let recovered = "";
  let claimed = "";
  try {
    const sig = att?.signature?.value;
    claimed = getAddress(att?.signature?.signer);
    recovered = getAddress(await recoverMessageAddress({ message: preimage, signature: sig }));
    checks.push({
      name: "recover signer (EIP-191 personal_sign) matches attestation.signature.signer",
      ok: recovered === claimed,
      detail: `recovered=${recovered} claimed=${claimed}`,
    });
  } catch (e) {
    checks.push({ name: "recover signer (EIP-191 personal_sign) matches attestation.signature.signer", ok: false, error: String(e?.message || e) });
  }

  // 5) optional expected signer
  if (a["expected-signer"]) {
    try {
      const expected = getAddress(a["expected-signer"]);
      checks.push({
        name: "--expected-signer matches recovered signer",
        ok: recovered && recovered === expected,
        detail: `expected=${expected} recovered=${recovered || "(none)"}`,
      });
    } catch (e) {
      checks.push({ name: "--expected-signer matches recovered signer", ok: false, error: String(e?.message || e) });
    }
  }

  const ok = printHuman(checks);

  const summary = {
    ok,
    attestation: {
      path: path.relative(process.cwd(), attAbs),
      signerClaimed: att?.signature?.signer || null,
      recoveredSigner: recovered || null,
      preimage,
      manifestDigestClaimed: digestClaimed,
      manifestDigestComputed: digestComputed,
      preimageDigestClaimed: preDigestClaimed,
      preimageDigestComputed: preDigestComputed,
    },
    checks,
  };

  console.log("== JSON Summary ==");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e?.stack || e?.message || String(e));
  process.exit(1);
});
