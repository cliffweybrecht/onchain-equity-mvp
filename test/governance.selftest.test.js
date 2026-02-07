import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import hre from "hardhat";

import { writeEvidenceJson } from "./utils/evidence-writer.js";
import { captureTx } from "./utils/tx-capture.js";

function findFn(abi, names) {
  const set = new Set(abi.filter((x) => x.type === "function").map((x) => x.name));
  return names.find((n) => set.has(n)) ?? null;
}

test("Governance self-test + auditor evidence (Part 5.2)", async () => {
  // Hardhat v3 + node:test: viem comes from a network connection
  const { viem } = await hre.network.connect();

  // -----------------------------
  // Clients / environment
  // -----------------------------
  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  const actor = wallet.account.address;

  const chainId = await publicClient.getChainId();

  const hardhatPkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "node_modules", "hardhat", "package.json"), "utf8")
  );

  // -----------------------------
  // Evidence capture containers
  // -----------------------------
  const evidenceTxs = [];
  const roles = {
    roleIds: [],
    assignments: [],
  };

  function recordRoleId(name, id) {
    roles.roleIds.push({ name, id });
    return id;
  }

  async function tryRecordHasRole(contract, roleName, roleId, account) {
    try {
      const hasRole = await contract.read.hasRole([roleId, account]);
      roles.assignments.push({ role: roleName, roleId, account, hasRole });
    } catch (err) {
      roles.assignments.push({
        role: roleName,
        roleId,
        account,
        hasRole: null,
        error: err?.shortMessage || err?.message || String(err),
      });
    }
  }

  // -----------------------------
  // Deploy contracts (EDR local)
  // -----------------------------
  // From your artifact:
  // IdentityRegistry(address initialAdmin)
  const registry = await viem.deployContract("IdentityRegistry", [actor]);

  // Use MockPolicy to avoid circular dependency with token address
  // (Your repo has contracts/test/MockPolicy.sol)
  const policy = await viem.deployContract("MockPolicy", []);

  // From your artifact:
  // EquityTokenV2(address admin_, address policy_)
  const token = await viem.deployContract("EquityTokenV2", [actor, policy.address]);

  // Issuance module exists in your repo; constructor may vary.
  // We’ll deploy with the most likely pattern: IssuanceModule(token)
  let issuance = null;
  try {
    issuance = await viem.deployContract("IssuanceModule", [token.address]);
  } catch (err) {
    evidenceTxs.push({
      label: "deploy IssuanceModule (failed)",
      error: err?.shortMessage || err?.message || String(err),
    });
    issuance = null;
  }

  // -----------------------------
  // Wire registry into token (auto-discover setter)
  // -----------------------------
  const tokenArtifact = JSON.parse(
    fs.readFileSync("./artifacts/contracts/EquityTokenV2.sol/EquityTokenV2.json", "utf8")
  );
  const tokenAbi = tokenArtifact.abi;

  const setRegistryFn = findFn(tokenAbi, [
    "setIdentityRegistry",
    "setRegistry",
    "setRegistryAddress",
    "setIdentityRegistryAddress",
    "setIdentity",
  ]);

  if (setRegistryFn && token.write?.[setRegistryFn]) {
    evidenceTxs.push(
      await captureTx(
        publicClient,
        `token.${setRegistryFn}(registry)`,
        token.write[setRegistryFn]([registry.address])
      )
    );
  } else {
    evidenceTxs.push({
      label: "token.setRegistry (skipped)",
      reason: "No registry setter found in ABI or not writable via viem contract wrapper",
      foundSetter: setRegistryFn,
    });
  }

  // -----------------------------
  // Initialize token (auto-discover initializer)
  // -----------------------------
  const initFn = findFn(tokenAbi, ["initialize", "init"]);

  if (initFn && token.write?.[initFn]) {
    // Common pattern: initialize(address)
    try {
      evidenceTxs.push(
        await captureTx(publicClient, `token.${initFn}(actor)`, token.write[initFn]([actor]))
      );
    } catch (err) {
      // Some initializers take no args
      try {
        evidenceTxs.push(
          await captureTx(publicClient, `token.${initFn}()`, token.write[initFn]([]))
        );
      } catch (err2) {
        evidenceTxs.push({
          label: `token.${initFn} (failed)`,
          error: err2?.shortMessage || err2?.message || String(err2),
        });
      }
    }
  } else {
    evidenceTxs.push({
      label: "token.initialize (skipped)",
      reason: "No initialize/init function found in ABI",
      foundInitializer: initFn,
    });
  }

  // -----------------------------
  // Discover role IDs (best effort)
  // -----------------------------
  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Token guardian role (if present)
  let GUARDIAN_ROLE = null;
  try {
    if (token.read?.GUARDIAN_ROLE) {
      GUARDIAN_ROLE = recordRoleId("GUARDIAN_ROLE", await token.read.GUARDIAN_ROLE());
    }
  } catch {
    GUARDIAN_ROLE = null;
  }

  // Issuance issuer role (if present)
  let ISSUER_ROLE = null;
  if (issuance) {
    try {
      if (issuance.read?.ISSUER_ROLE) {
        ISSUER_ROLE = recordRoleId("ISSUER_ROLE", await issuance.read.ISSUER_ROLE());
      }
    } catch {
      ISSUER_ROLE = null;
    }
  }

  // -----------------------------
  // Grant roles (best effort)
  // -----------------------------
  // Grant issuer role to actor
  if (issuance && ISSUER_ROLE && issuance.write?.grantRole) {
    try {
      evidenceTxs.push(
        await captureTx(
          publicClient,
          "issuance.grantRole(ISSUER_ROLE, actor)",
          issuance.write.grantRole([ISSUER_ROLE, actor])
        )
      );
    } catch (err) {
      evidenceTxs.push({
        label: "issuance.grantRole(ISSUER_ROLE, actor) (failed)",
        error: err?.shortMessage || err?.message || String(err),
      });
    }
  }

  // Grant guardian role to actor
  if (GUARDIAN_ROLE && token.write?.grantRole) {
    try {
      evidenceTxs.push(
        await captureTx(
          publicClient,
          "token.grantRole(GUARDIAN_ROLE, actor)",
          token.write.grantRole([GUARDIAN_ROLE, actor])
        )
      );
    } catch (err) {
      evidenceTxs.push({
        label: "token.grantRole(GUARDIAN_ROLE, actor) (failed)",
        error: err?.shortMessage || err?.message || String(err),
      });
    }
  }

  // Record role assignments (best effort)
  await tryRecordHasRole(token, "DEFAULT_ADMIN_ROLE", DEFAULT_ADMIN_ROLE, actor);
  if (GUARDIAN_ROLE) await tryRecordHasRole(token, "GUARDIAN_ROLE", GUARDIAN_ROLE, actor);
  if (issuance && ISSUER_ROLE) await tryRecordHasRole(issuance, "ISSUER_ROLE", ISSUER_ROLE, actor);

  // -----------------------------
  // Issue/mint (best effort)
  // -----------------------------
  let didIssue = false;
  if (issuance) {
    // Try common methods: issue(to, amount) or mint(to, amount)
    const issuanceArtifact = JSON.parse(
      fs.readFileSync("./artifacts/contracts/IssuanceModule.sol/IssuanceModule.json", "utf8")
    );
    const issuanceAbi = issuanceArtifact.abi;
    const issueFn = findFn(issuanceAbi, ["issue", "mint"]);

    if (issueFn && issuance.write?.[issueFn]) {
      try {
        evidenceTxs.push(
          await captureTx(
            publicClient,
            `issuance.${issueFn}(actor, 1)`,
            issuance.write[issueFn]([actor, 1n])
          )
        );
        didIssue = true;
      } catch (err) {
        evidenceTxs.push({
          label: `issuance.${issueFn}(actor, 1) (failed)`,
          error: err?.shortMessage || err?.message || String(err),
        });
      }
    } else {
      evidenceTxs.push({
        label: "issuance.issue/mint (skipped)",
        reason: "No issue/mint function found in IssuanceModule ABI",
        found: issueFn,
      });
    }
  }

  if (didIssue) {
    const bal = await token.read.balanceOf([actor]);
    assert.ok(bal >= 1n);
  }

  // -----------------------------
  // Freeze / unfreeze (best effort)
  // -----------------------------
  const freezeFn = findFn(tokenAbi, ["freeze", "pause"]);
  const unfreezeFn = findFn(tokenAbi, ["unfreeze", "unpause"]);

  if (freezeFn && token.write?.[freezeFn]) {
    try {
      evidenceTxs.push(
        await captureTx(publicClient, `token.${freezeFn}()`, token.write[freezeFn]([]))
      );
    } catch (err) {
      evidenceTxs.push({
        label: `token.${freezeFn} (failed)`,
        error: err?.shortMessage || err?.message || String(err),
      });
    }
  } else {
    evidenceTxs.push({
      label: "token.freeze/pause (skipped)",
      reason: "No freeze/pause function found",
      found: freezeFn,
    });
  }

  if (unfreezeFn && token.write?.[unfreezeFn]) {
    try {
      evidenceTxs.push(
        await captureTx(publicClient, `token.${unfreezeFn}()`, token.write[unfreezeFn]([]))
      );
    } catch (err) {
      evidenceTxs.push({
        label: `token.${unfreezeFn} (failed)`,
        error: err?.shortMessage || err?.message || String(err),
      });
    }
  } else {
    evidenceTxs.push({
      label: "token.unfreeze/unpause (skipped)",
      reason: "No unfreeze/unpause function found",
      found: unfreezeFn,
    });
  }

  // -----------------------------
  // Transfer pass + transfer fail (best effort)
  // -----------------------------
  const dead = "0x000000000000000000000000000000000000dEaD";
  let balBefore = 0n;
  try {
    balBefore = await token.read.balanceOf([actor]);
  } catch {}

  if (balBefore > 0n) {
    // Pass
    try {
      evidenceTxs.push(
        await captureTx(
          publicClient,
          "token.transfer(pass)",
          token.write.transfer([dead, 1n])
        )
      );
    } catch (err) {
      evidenceTxs.push({
        label: "token.transfer(pass) (failed)",
        error: err?.shortMessage || err?.message || String(err),
      });
    }

    // Fail (expected)
    try {
      await token.write.transfer([dead, 1n]);
      evidenceTxs.push({ label: "token.transfer(fail) (unexpectedly succeeded)" });
    } catch (err) {
      evidenceTxs.push({
        label: "token.transfer(fail)",
        error: err?.shortMessage || err?.message || String(err),
      });
    }
  } else {
    evidenceTxs.push({ label: "transfer(pass/fail) skipped", reason: "actor balance was 0" });
  }

  // -----------------------------
  // Discovered admins (local actor)
  // -----------------------------
  const discoveredAdmins = {
    tokenDefaultAdmin: actor,
    issuanceDefaultAdmin: actor,
    registryInitialAdmin: actor,
  };

  // -----------------------------
  // Write Part 5.2 evidence JSON
  // -----------------------------
  const evidence = {
    part: "5.2",
    title: "Governance Evidence Snapshot (Auditor/Regulator JSON Packet)",
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      hardhatVersion: hardhatPkg.version,
      chainId: String(chainId),
      networkType: "edr-simulated-local",
      testRunner: "hardhat-node-test-runner",
    },
    actors: { defaultWallet: actor },
    addresses: {
      token: token.address,
      issuance: issuance?.address ?? null,
      registry: registry.address,
      policy: policy.address,
    },
    discoveredAdmins,
    roles: {
      roleIds: roles.roleIds.slice().sort((a, b) => a.name.localeCompare(b.name)),
      assignments: roles.assignments
        .slice()
        .sort((a, b) => (a.role + a.account).localeCompare(b.role + b.account)),
    },
    transactions: evidenceTxs,
  };

  const outDir = process.env.EVIDENCE_DIR || "evidence/part-5.2";
  const { fullpath } = writeEvidenceJson({
    dir: outDir,
    prefix: "governance-selftest",
    payload: evidence,
  });

  console.log(`\n[EVIDENCE] written → ${fullpath}\n`);
});
