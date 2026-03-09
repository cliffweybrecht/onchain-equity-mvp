#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "demo.config.json");

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function resolvePathFromRoot(relativePath) {
  return path.resolve(ROOT_DIR, relativePath);
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  const content = `${stableStringify(data)}\n`;
  await fs.writeFile(filePath, content, "utf8");
}

function fail(message, extra = {}) {
  const error = new Error(message);
  error.extra = extra;
  throw error;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeHexPrivateKey(value, envName) {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    fail(`Invalid private key format in ${envName}. Expected 0x-prefixed 32-byte hex.`);
  }
  return trimmed;
}

function normalizeAddress(value, label) {
  if (!isAddress(value)) {
    fail(`Invalid address for ${label}: ${value}`);
  }
  return getAddress(value);
}

function getChainByName(name) {
  if (name === "baseSepolia") return baseSepolia;
  fail(`Unsupported network name in demo config: ${name}`);
}

async function getGitCommit() {
  try {
    const headPath = resolvePathFromRoot(".git/HEAD");
    const head = (await fs.readFile(headPath, "utf8")).trim();

    if (head.startsWith("ref: ")) {
      const ref = head.slice(5);
      const refPath = resolvePathFromRoot(`.git/${ref}`);
      if (await fileExists(refPath)) {
        return (await fs.readFile(refPath, "utf8")).trim();
      }
    }

    return head;
  } catch {
    return null;
  }
}

async function createRunContext() {
  const configPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : DEFAULT_CONFIG_PATH;

  if (!(await fileExists(configPath))) {
    fail(`Demo config not found: ${configPath}`);
  }

  const config = await loadJson(configPath);
  const chain = getChainByName(config.network?.name);

  if (Number(config.network?.chainId) !== Number(chain.id)) {
    fail(
      `Config chainId mismatch. Expected ${chain.id} for ${config.network?.name}, got ${config.network?.chainId}.`
    );
  }

  const rpcUrl = requireEnv(config.rpcEnvVar);
  const issuerPrivateKey = normalizeHexPrivateKey(
    requireEnv(config.actors?.issuerEnvVar),
    config.actors?.issuerEnvVar
  );

  const issuerAccount = privateKeyToAccount(issuerPrivateKey);

  const beneficiary = normalizeAddress(config.actors?.beneficiary, "actors.beneficiary");

  const contractAddresses = {
    identityRegistry: normalizeAddress(
      config.contracts?.identityRegistry,
      "contracts.identityRegistry"
    ),
    equityToken: normalizeAddress(
      config.contracts?.equityToken,
      "contracts.equityToken"
    ),
    vesting: normalizeAddress(config.contracts?.vesting, "contracts.vesting"),
    policy: normalizeAddress(config.contracts?.policy, "contracts.policy")
  };

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl)
  });

  const walletClient = createWalletClient({
    account: issuerAccount,
    chain,
    transport: http(rpcUrl)
  });

  const evidenceDir = resolvePathFromRoot(config.outputs?.evidenceDir);
  const manifestPath = resolvePathFromRoot(config.outputs?.manifestPath);

  const meta = {
    demoName: config.demoName,
    startedAt: nowIso(),
    configPath,
    gitCommit: await getGitCommit()
  };

  return {
    meta,
    config,
    clients: {
      publicClient,
      walletClient
    },
    actors: {
      issuer: issuerAccount.address,
      beneficiary
    },
    contracts: contractAddresses,
    paths: {
      evidenceDir,
      manifestPath,
      resolvedConfigPath: path.join(evidenceDir, "demo-config-resolved.json"),
      runLogPath: path.join(evidenceDir, "demo-run.log"),
      summaryPath: path.join(evidenceDir, "demo-summary.json"),
      preflightPath: path.join(evidenceDir, "demo-preflight.json")
    },
    run: {
      status: "initialized",
      steps: [],
      assertions: [],
      transactions: [],
      artifacts: {}
    }
  };
}

async function appendLog(ctx, message) {
  const line = `[${nowIso()}] ${message}\n`;
  await fs.appendFile(ctx.paths.runLogPath, line, "utf8");
  process.stdout.write(line);
}

async function ensureOutputDirectories(ctx) {
  await fs.mkdir(ctx.paths.evidenceDir, { recursive: true });
  await fs.mkdir(path.dirname(ctx.paths.manifestPath), { recursive: true });
  await fs.writeFile(ctx.paths.runLogPath, "", "utf8");
}

async function runStep(ctx, name, fn) {
  const startedAt = nowIso();
  await appendLog(ctx, `START ${name}`);

  try {
    const result = await fn();

    const finishedAt = nowIso();
    ctx.run.steps.push({
      name,
      startedAt,
      finishedAt,
      status: "passed",
      result
    });

    await appendLog(ctx, `PASS ${name}`);
    return result;
  } catch (error) {
    const finishedAt = nowIso();
    ctx.run.steps.push({
      name,
      startedAt,
      finishedAt,
      status: "failed",
      error: {
        message: error.message,
        extra: error.extra ?? null
      }
    });

    await appendLog(ctx, `FAIL ${name}: ${error.message}`);
    throw error;
  }
}

async function preflight(ctx) {
  const chainId = await ctx.clients.publicClient.getChainId();
  const latestBlock = await ctx.clients.publicClient.getBlock({ blockTag: "latest" });

  if (Number(chainId) !== Number(ctx.config.network.chainId)) {
    fail(`Connected chainId ${chainId} does not match expected ${ctx.config.network.chainId}`);
  }

  const codeChecks = {};
  for (const [name, address] of Object.entries(ctx.contracts)) {
    const code = await ctx.clients.publicClient.getCode({ address });
    const hasCode = !!code && code !== "0x";
    if (!hasCode) {
      fail(`No deployed contract code found at ${name} address ${address}`);
    }
    codeChecks[name] = {
      address,
      hasCode,
      codeHash: sha256Hex(code)
    };
  }

  return {
    connectedChainId: chainId,
    latestBlockNumber: latestBlock.number.toString(),
    latestBlockTimestamp: latestBlock.timestamp.toString(),
    issuer: ctx.actors.issuer,
    beneficiary: ctx.actors.beneficiary,
    contractChecks: codeChecks
  };
}

function buildResolvedConfigArtifact(ctx) {
  return {
    meta: ctx.meta,
    network: ctx.config.network,
    actors: {
      issuer: ctx.actors.issuer,
      beneficiary: ctx.actors.beneficiary
    },
    contracts: ctx.contracts,
    grant: ctx.config.grant,
    vestingSchedule: ctx.config.vestingSchedule,
    claim: ctx.config.claim,
    outputs: ctx.config.outputs
  };
}

function buildSummaryArtifact(ctx) {
  return {
    demoName: ctx.meta.demoName,
    status: ctx.run.status,
    startedAt: ctx.meta.startedAt,
    finishedAt: nowIso(),
    gitCommit: ctx.meta.gitCommit,
    network: ctx.config.network,
    actors: ctx.actors,
    contracts: ctx.contracts,
    steps: ctx.run.steps.map((step) => ({
      name: step.name,
      status: step.status,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt
    })),
    assertionCount: ctx.run.assertions.length,
    transactionCount: ctx.run.transactions.length,
    artifacts: ctx.run.artifacts
  };
}

async function writeArtifacts(ctx, preflightArtifact) {
  const resolvedConfigArtifact = buildResolvedConfigArtifact(ctx);
  const summaryArtifact = buildSummaryArtifact(ctx);

  await writeJson(ctx.paths.resolvedConfigPath, resolvedConfigArtifact);
  await writeJson(ctx.paths.preflightPath, preflightArtifact);
  await writeJson(ctx.paths.summaryPath, summaryArtifact);

  const resolvedConfigHash = sha256Hex(stableStringify(resolvedConfigArtifact));
  const preflightHash = sha256Hex(stableStringify(preflightArtifact));
  const summaryHash = sha256Hex(stableStringify(summaryArtifact));

  const manifest = {
    demoName: ctx.meta.demoName,
    version: 1,
    generatedAt: nowIso(),
    gitCommit: ctx.meta.gitCommit,
    network: ctx.config.network,
    artifactHashes: {
      resolvedConfigHash,
      preflightHash,
      summaryHash
    },
    artifactPaths: {
      resolvedConfig: path.relative(ROOT_DIR, ctx.paths.resolvedConfigPath),
      preflight: path.relative(ROOT_DIR, ctx.paths.preflightPath),
      summary: path.relative(ROOT_DIR, ctx.paths.summaryPath),
      runLog: path.relative(ROOT_DIR, ctx.paths.runLogPath)
    }
  };

  await writeJson(ctx.paths.manifestPath, manifest);

  ctx.run.artifacts = {
    resolvedConfig: path.relative(ROOT_DIR, ctx.paths.resolvedConfigPath),
    preflight: path.relative(ROOT_DIR, ctx.paths.preflightPath),
    summary: path.relative(ROOT_DIR, ctx.paths.summaryPath),
    runLog: path.relative(ROOT_DIR, ctx.paths.runLogPath),
    manifest: path.relative(ROOT_DIR, ctx.paths.manifestPath)
  };
}

async function main() {
  const ctx = await createRunContext();
  await ensureOutputDirectories(ctx);

  try {
    await appendLog(ctx, `Demo bootstrap started for ${ctx.meta.demoName}`);
    await appendLog(ctx, `Using config ${ctx.meta.configPath}`);

    const preflightArtifact = await runStep(ctx, "preflight", async () => preflight(ctx));

    ctx.run.status = "passed";
    await writeArtifacts(ctx, preflightArtifact);

    await appendLog(ctx, "Demo bootstrap completed successfully");
    process.stdout.write(
      `${stableStringify({
        ok: true,
        summary: path.relative(ROOT_DIR, ctx.paths.summaryPath),
        manifest: path.relative(ROOT_DIR, ctx.paths.manifestPath)
      })}\n`
    );
  } catch (error) {
    ctx.run.status = "failed";

    try {
      const failedSummary = buildSummaryArtifact(ctx);
      await writeJson(ctx.paths.summaryPath, failedSummary);
    } catch {
      // best effort only
    }

    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
