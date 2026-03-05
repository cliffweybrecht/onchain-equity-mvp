#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const REPO_ROOT = process.cwd();
const GRANTS_DIR = path.join(REPO_ROOT, "manifests", "grants");
const LEDGER_PATH = path.join(GRANTS_DIR, "index.json");

function die(msg) {
  console.error(`\n[update-ledger] ERROR: ${msg}\n`);
  process.exit(1);
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * Canonical JSON stringify:
 * - object keys sorted lexicographically
 * - arrays preserved order (we enforce sorting separately)
 * - no whitespace
 */
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
  // Load manifests with stable processing order: by relative path
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

  // Partition into creates and revokes, then map by grantId
  const creates = [];
  const revokes = [];
  for (const m of loaded) {
    if (m.kind === "REVOKE") revokes.push(m);
    else creates.push(m);
  }

  // Index creates by grantId
  const byGrant = new Map(); // grantId -> entry builder
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
      // Keep the earliest create as authoritative; include all creates in manifests list
      existing.manifests.push(ref);
      const aKey = `${existing.create.manifestId}::${existing.create.path}`;
      const bKey = `${ref.manifestId}::${ref.path}`;
      if (bKey.localeCompare(aKey) < 0) existing.create = ref;
    }
  }

  // Attach revokes: try to map by grantId in revoke manifest, else by createManifestId reference
  for (const r of revokes) {
    const ref = {
      manifestId: r.manifestId,
      kind: "REVOKE",
      path: r.path,
      sha256: r.sha256
    };

    // Heuristics:
    // - If revoke has grantId/grant_id/grant.id => use it
    // - else if revoke references createManifestId/createId/targetManifestId => find matching grant
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
        // find entry whose create.manifestId matches
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
    if (!entry) {
      die(`Revoke targets unknown grantId=${targetGrantId}: ${r.path}`);
    }

    entry.manifests.push(ref);

    // Choose revoke deterministically if multiple: lowest manifestId then path
    if (!entry.revoke) {
      entry.revoke = ref;
    } else {
      const aKey = `${entry.revoke.manifestId}::${entry.revoke.path}`;
      const bKey = `${ref.manifestId}::${ref.path}`;
      if (bKey.localeCompare(aKey) < 0) entry.revoke = ref;
    }
  }

  // Build final grants array with deterministic ordering
  const grants = Array.from(byGrant.values())
    .map((entry) => {
      // Sort manifests array deterministically: kind(CREATE before REVOKE), then manifestId, then path
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

  return {
    ledgerVersion: "grant-ledger-v1",
    schemaVersion: 1,
    grants
  };
}

function main() {
  if (!fs.existsSync(GRANTS_DIR)) die(`Missing dir: ${relRepoPath(GRANTS_DIR)}`);

  const files = listJsonFilesRecursive(GRANTS_DIR).filter(
    (p) => path.basename(p) !== "index.json"
  );

  if (files.length === 0) {
    die(
      "No grant manifests found under manifests/grants/. Create at least one grant manifest first."
    );
  }

  const ledger = buildLedgerFromManifests(files);

  // Canonical write
  const canonical = canonicalStringify(ledger) + "\n";
  fs.writeFileSync(LEDGER_PATH, canonical, "utf8");

  const digest = sha256Hex(canonical);
  console.log(
    `[update-ledger] wrote ${relRepoPath(LEDGER_PATH)} sha256=${digest}`
  );
  console.log(
    `[update-ledger] grants=${ledger.grants.length} manifests_scanned=${files.length}`
  );
}

main();
