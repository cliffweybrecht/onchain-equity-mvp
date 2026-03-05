#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Ajv from "ajv";

const REPO_ROOT = process.cwd();
const GRANTS_DIR = path.join(REPO_ROOT, "manifests", "grants");
const LEDGER_PATH = path.join(GRANTS_DIR, "index.json");
const LEDGER_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "schemas",
  "grant-ledger-v1.schema.json"
);

function die(msg) {
  console.error(`\n[validate-ledger] ERROR: ${msg}\n`);
  process.exit(1);
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function canonicalStringify(value) {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) die("Non-finite number in JSON");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalStringify(value[k]))
        .join(",") +
      "}"
    );
  }
  die(`Unsupported JSON type: ${typeof value}`);
}

function readJsonFile(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    die(`Invalid JSON: ${absPath}`);
  }
}

function listJsonFilesRecursive(dirAbs) {
  const out = [];
  const stack = [dirAbs];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile() && ent.name.endsWith(".json")) out.push(p);
    }
  }
  return out;
}

function detectKind(manifest) {
  const candidates = [
    manifest.kind,
    manifest.type,
    manifest.action,
    manifest.op,
    manifest.operation
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase());

  if (candidates.some((v) => v.includes("revoke") || v.includes("revocation")))
    return "REVOKE";

  return "CREATE";
}

function getManifestId(manifest, absPath) {
  if (manifest && typeof manifest.id === "string" && manifest.id.length > 0)
    return manifest.id;

  const raw = fs.readFileSync(absPath, "utf8");
  return `sha256:${sha256Hex(raw)}`;
}

function getGrantId(manifest, createManifestId) {
  const gid = manifest?.grantId ?? manifest?.grant_id ?? manifest?.grant?.id;
  if (typeof gid === "string" && gid.length > 0) return gid;
  return createManifestId;
}

function relRepoPath(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function buildLedgerFromManifests(manifestFilesAbs) {
  const loaded = manifestFilesAbs
    .filter((p) => path.resolve(p) !== path.resolve(LEDGER_PATH))
    .map((absPath) => {
      const json = readJsonFile(absPath);
      const raw = fs.readFileSync(absPath, "utf8");
      const kind = detectKind(json);
      const manifestId = getManifestId(json, absPath);
      const sha = sha256Hex(raw);
      const p = relRepoPath(absPath);
      return { absPath, path: p, json, kind, manifestId, sha256: sha };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const creates = [];
  const revokes = [];
  for (const m of loaded) (m.kind === "REVOKE" ? revokes : creates).push(m);

  const byGrant = new Map();

  for (const c of creates) {
    const grantId = getGrantId(c.json, c.manifestId);
    const ref = {
      manifestId: c.manifestId,
      kind: "CREATE",
      path: c.path,
      sha256: c.sha256
    };

    const existing = byGrant.get(grantId);
    if (!existing) {
      byGrant.set(grantId, {
        grantId,
        create: ref,
        revoke: null,
        manifests: [ref]
      });
    } else {
      existing.manifests.push(ref);
      const aKey = `${existing.create.manifestId}::${existing.create.path}`;
      const bKey = `${ref.manifestId}::${ref.path}`;
      if (bKey.localeCompare(aKey) < 0) existing.create = ref;
    }
  }

  for (const r of revokes) {
    const ref = {
      manifestId: r.manifestId,
      kind: "REVOKE",
      path: r.path,
      sha256: r.sha256
    };

    let targetGrantId = null;

    const rgid = r.json?.grantId ?? r.json?.grant_id ?? r.json?.grant?.id;
    if (typeof rgid === "string" && rgid.length > 0) targetGrantId = rgid;

    if (!targetGrantId) {
      const targetCreateId =
        r.json?.createManifestId ??
        r.json?.create_manifest_id ??
        r.json?.createId ??
        r.json?.targetManifestId ??
        r.json?.target_manifest_id;

      if (typeof targetCreateId === "string" && targetCreateId.length > 0) {
        for (const [gid, entry] of byGrant.entries()) {
          if (entry.create.manifestId === targetCreateId) {
            targetGrantId = gid;
            break;
          }
        }
      }
    }

    if (!targetGrantId) {
      die(`Revoke manifest could not be associated to a create grant: ${r.path}`);
    }

    const entry = byGrant.get(targetGrantId);
    if (!entry) die(`Revoke targets unknown grantId=${targetGrantId}: ${r.path}`);

    entry.manifests.push(ref);

    if (!entry.revoke) entry.revoke = ref;
    else {
      const aKey = `${entry.revoke.manifestId}::${entry.revoke.path}`;
      const bKey = `${ref.manifestId}::${ref.path}`;
      if (bKey.localeCompare(aKey) < 0) entry.revoke = ref;
    }
  }

  const grants = Array.from(byGrant.values())
    .map((entry) => {
      const kindRank = (k) => (k === "CREATE" ? 0 : 1);

      entry.manifests.sort((a, b) => {
        const kr = kindRank(a.kind) - kindRank(b.kind);
        if (kr !== 0) return kr;
        const mid = a.manifestId.localeCompare(b.manifestId);
        if (mid !== 0) return mid;
        return a.path.localeCompare(b.path);
      });

      const status = entry.revoke ? "REVOKED" : "ACTIVE";

      return {
        grantId: entry.grantId,
        status,
        create: entry.create,
        revoke: entry.revoke,
        manifests: entry.manifests
      };
    })
    .sort((a, b) => a.grantId.localeCompare(b.grantId));

  return { ledgerVersion: "grant-ledger-v1", schemaVersion: 1, grants };
}

function main() {
  if (!fs.existsSync(LEDGER_PATH))
    die("Missing manifests/grants/index.json (run update-ledger first)");
  if (!fs.existsSync(LEDGER_SCHEMA_PATH))
    die("Missing schemas/grant-ledger-v1.schema.json");

  const rawLedger = fs.readFileSync(LEDGER_PATH, "utf8");
  const ledger = readJsonFile(LEDGER_PATH);

  // 1) Schema validation
  const schema = readJsonFile(LEDGER_SCHEMA_PATH);
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  const ok = validate(ledger);
  if (!ok) {
    console.error(validate.errors);
    die("Ledger failed schema validation");
  }

  // 2) Canonical bytes check
  const canonical = canonicalStringify(ledger) + "\n";
  if (rawLedger !== canonical) {
    die("Ledger is not canonical. Re-run update-ledger to rewrite canonical JSON.");
  }

  // 3) Deterministic correctness check (rebuild from manifests)
  const manifestFiles = listJsonFilesRecursive(GRANTS_DIR).filter(
    (p) => path.basename(p) !== "index.json"
  );
  if (manifestFiles.length === 0)
    die("No grant manifests found under manifests/grants/");

  const rebuilt = buildLedgerFromManifests(manifestFiles);
  const rebuiltCanonical = canonicalStringify(rebuilt) + "\n";

  if (rebuiltCanonical !== canonical) {
    die(
      "Ledger content does not match deterministic rebuild from manifests. Re-run update-ledger and re-check manifests."
    );
  }

  const digest = sha256Hex(canonical);
  console.log(`[validate-ledger] OK sha256=${digest}`);
  console.log(
    `[validate-ledger] grants=${ledger.grants.length} manifests_scanned=${manifestFiles.length}`
  );
}

main();
