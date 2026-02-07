import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { network } from "hardhat";

/* -------------------- Artifact helpers -------------------- */

function findArtifactJson(contractName) {
  const root = path.resolve(process.cwd(), "artifacts");
  const target = `${contractName}.json`;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      } else if (e.isFile() && e.name === target) {
        if (p.includes(`${path.sep}contracts${path.sep}`)) return p;
      }
    }
    return null;
  }

  const hit = walk(root);
  if (!hit) throw new Error(`Artifact not found for ${contractName}`);
  return hit;
}

function loadAbi(contractName) {
  const p = findArtifactJson(contractName);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!Array.isArray(j.abi)) throw new Error(`Bad ABI for ${contractName}`);
  return j.abi;
}

function hasFn(abi, name) {
  return abi.some((x) => x?.type === "function" && x?.name === name);
}

async function mustWrite(contract, fn, args, opts) {
  if (!hasFn(contract.abi, fn)) throw new Error(`Missing write fn ${fn}`);
  return contract.write[fn](args ?? [], opts ?? {});
}

async function mustRead(contract, fn, args) {
  if (!hasFn(contract.abi, fn)) throw new Error(`Missing read fn ${fn}`);
  return contract.read[fn](args ?? []);
}

/* -------------------- Test -------------------- */

test("Part 5.1 — Governance Self-Test (local EDR, initialize wiring)", async () => {
  const conn = await network.connect();
  const { viem } = conn;

  const publicClient = await viem.getPublicClient();
  const [deployer, guardian, authority, alice] = await viem.getWalletClients();

  const tokenAbi = loadAbi("EquityTokenV3");
  const issuanceAbi = loadAbi("IssuanceModule");
  const registryAbi = loadAbi("MockRegistry");
  const policyAbi = loadAbi("MockPolicy");

  // Deploy mocks
  const registry = await viem.deployContract("MockRegistry");
  registry.abi = registryAbi;

  const policy = await viem.deployContract("MockPolicy");
  policy.abi = policyAbi;

  // Deploy token (upgradeable-style, must initialize)
  const token = await viem.deployContract("EquityTokenV3");
  token.abi = tokenAbi;

  // Deploy issuance module with constructor(address authority)
  const issuance = await viem.deployContract("IssuanceModule", [authority.account.address]);
  issuance.abi = issuanceAbi;

  // Discover IssuanceModule admin (DEFAULT_ADMIN_ROLE holder)
  const IM_DEFAULT_ADMIN_ROLE = await issuance.read.DEFAULT_ADMIN_ROLE();
  const IM_ISSUER_ROLE = await issuance.read.ISSUER_ROLE();

  const wallets2 = [deployer, guardian, authority, alice];
  let issuanceAdminWc = null;

  for (const wc of wallets2) {
    const ok = await issuance.read.hasRole([IM_DEFAULT_ADMIN_ROLE, wc.account.address]);
    if (ok) { issuanceAdminWc = wc; break; }
  }

  assert.ok(issuanceAdminWc, "No local signer has IssuanceModule DEFAULT_ADMIN_ROLE");
  console.log("Discovered IssuanceModule admin:", issuanceAdminWc.account.address);

  // Grant ISSUER_ROLE to the caller we will use for issue()
  // We'll use deployer as the issuer/minter to keep things stable.
  await issuance.write.grantRole([IM_ISSUER_ROLE, deployer.account.address], { account: issuanceAdminWc.account });


  // Initialize token with the exact signature you printed:
  // initialize(string name_, string symbol_, address authority, address registry_, address policy_, address guardian, address issuanceModule)
  await mustWrite(
    token,
    "initialize",
    [
      "EquityTokenV3",
      "EQV3",
      authority.account.address,
      registry.address,
      policy.address,
      guardian.account.address,
      issuance.address,
    ],
    { account: deployer.account }
  );

  // Sanity: deployer should now be DEFAULT_ADMIN_ROLE holder (common pattern)
  const DEFAULT_ADMIN_ROLE = await mustRead(token, "DEFAULT_ADMIN_ROLE", []);

  // Discover which local signer is the actual admin after initialize()
  const wallets = [deployer, guardian, authority, alice];
  let adminWc = null;

  for (const wc of wallets) {
    const ok = await mustRead(token, "hasRole", [DEFAULT_ADMIN_ROLE, wc.account.address]);
    if (ok) {
      adminWc = wc;
      break;
    }
  }

  assert.ok(adminWc, "No local signer has DEFAULT_ADMIN_ROLE after initialize()");
  console.log("Discovered DEFAULT_ADMIN_ROLE admin:", adminWc.account.address);

  // -------------------------
  // Invariant 1: Guardian can freeze but cannot unfreeze
  // -------------------------
  await mustWrite(token, "freeze", [], { account: guardian.account });

  await assert.rejects(
    () => mustWrite(token, "unfreeze", [], { account: guardian.account }),
    /revert|unauth|access|role|permission|forbidden|NotGuardianOrAuthority/i
  );

  // -------------------------
  // Invariant 2: Authority can unfreeze
  // -------------------------
  await mustWrite(token, "unfreeze", [], { account: authority.account });

  // -------------------------
  // Invariant 3: Only IssuanceModule can mint
  // -------------------------
  // If token exposes mint, EOA should fail (module-gated)
  if (hasFn(token.abi, "mint")) {
    await assert.rejects(
      () => mustWrite(token, "mint", [alice.account.address, 1n], { account: deployer.account }),
      /revert|only|issuance|module|minter|role|access/i
    );
  }

  // Mint via issuance module: discover mint-like function name
  const issuanceFns = issuanceAbi.filter((x) => x.type === "function").map((x) => x.name);
  const mintCandidates = ["mint", "issue", "mintTo", "issueTo", "mintShares"];
  const mintFn = mintCandidates.find((n) => issuanceFns.includes(n));
  if (!mintFn) throw new Error(`IssuanceModule has no known mint fn. Found: ${issuanceFns.join(", ")}`);

  // Build args matching the selected mint function signature
  const mintAbi = issuanceAbi.find((x) => x.type === "function" && x.name === mintFn);
  const inputs = mintAbi?.inputs ?? [];
  console.log("Issuance mint fn:", mintFn, "inputs:", inputs.map(i => `${i.type} ${i.name}`).join(", "));

  const mintArgs = inputs.map((inp, idx) => {
    const t = inp.type;
    const n = (inp.name || "").toLowerCase();

    if (t === "address") {
      if (n.includes("token")) return token.address;
      return alice.account.address;
    }

    if (t.startsWith("uint") || t.startsWith("int")) {
      // Prefer amount-like fields to be 1n; otherwise 0n
      if (n.includes("amount") || n.includes("qty") || n.includes("shares") || n.includes("value")) return 1n;
      return 0n;
    }

    if (t === "bool") return true;
    if (t === "string") return "";
    if (t === "bytes") return "0x";
    if (t === "bytes32") return "0x" + "00".repeat(32);
    if (t.startsWith("bytes")) return "0x";
    if (t.endsWith("[]")) return [];

    // Fallback for structs/unknowns (rare here)
    throw new Error(`Unsupported mint arg type at index ${idx}: ${t} ${inp.name}`);
  });

  await issuance.write[mintFn](mintArgs, { account: deployer.account });


  // -------------------------
  // Invariant 4: IdentityRegistry + Policy gating enforced
  // -------------------------
  const regFns = registryAbi.filter((x) => x.type === "function").map((x) => x.name);
  const polFns = policyAbi.filter((x) => x.type === "function").map((x) => x.name);

  const regSetVerified = ["setVerified", "setIsVerified", "setKyc", "setIdentity", "verify"].find((n) => regFns.includes(n));
  if (!regSetVerified) throw new Error(`MockRegistry missing verify setter. Found: ${regFns.join(", ")}`);

  const polAllow = ["setAllowTransfer", "setAllowed", "setAllow", "allowTransfers", "setTransferAllowed"].find((n) => polFns.includes(n));
  if (!polAllow) throw new Error(`MockPolicy missing allow setter. Found: ${polFns.join(", ")}`);

  // allow + verify (both sender and recipient must be verified)
  await registry.write[regSetVerified]([alice.account.address, true], { account: deployer.account });
  await registry.write[regSetVerified]([deployer.account.address, true], { account: deployer.account });
  await policy.write[polAllow]([true], { account: deployer.account });

  // transfer ok
  await mustWrite(token, "transfer", [deployer.account.address, 1n], { account: alice.account });


  // revoke verify -> transfer blocked
  await registry.write[regSetVerified]([alice.account.address, false], { account: deployer.account });

  await assert.rejects(
    () => mustWrite(token, "transfer", [deployer.account.address, 1n], { account: alice.account }),
    /revert|verify|kyc|identity|policy|blocked|unauth|access/i
  );

  const bn = await publicClient.getBlockNumber();
  assert.ok(bn >= 0n);
});
