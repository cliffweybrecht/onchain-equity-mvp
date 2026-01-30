const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function isBlockNotFound(err) {
  const msg = String(err?.shortMessage || err?.message || "");
  const details = String(err?.details || "");
  return msg.includes("block not found") || details.includes("block not found");
}

async function retry(fn, tries = 8, delayMs = 1200) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function main() {
  const deploymentsPath = path.join(
    __dirname,
    "..",
    "deployments",
    "base-sepolia.json"
  );
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const { viem } = await hre.network.connect();
  const publicClient = await viem.getPublicClient();
  const walletClient = await viem.getWalletClient();

  const chainId = await publicClient.getChainId();
  const [caller] = await walletClient.getAddresses();

  console.log("\n== Sanity Mint Test (JS / robust) ==");
  console.log("chainId:", chainId);
  console.log("caller:", caller);
  console.log("registry:", deployments.IdentityRegistry);
  console.log("token:", deployments.EquityToken);

  if (Number(chainId) !== 84532) {
    throw new Error(`Wrong chainId: ${chainId}`);
  }

  const registry = await viem.getContractAt(
    "IdentityRegistry",
    deployments.IdentityRegistry
  );
  const token = await viem.getContractAt(
    "EquityToken",
    deployments.EquityToken
  );

  // --- identity check ---
  const status = await registry.read.getStatus([caller]);
  const isVerified = await registry.read.isVerified([caller]);
  console.log("\nRegistry status:", status.toString());
  console.log("isVerified:", isVerified);
  if (!isVerified) {
    throw new Error("Caller not verified. Run verify-me.js first.");
  }

  // --- admin check ---
  const tokenAdmin = await token.read.admin();
  console.log("\nToken admin:", tokenAdmin);
  if (tokenAdmin.toLowerCase() !== caller.toLowerCase()) {
    throw new Error("Caller is not token admin.");
  }

  // --- before ---
  const balBefore = await token.read.balanceOf([caller]);
  const supplyBefore = await token.read.totalSupply();
  console.log("\nBalance before (latest):", balBefore.toString());
  console.log("Total supply before (latest):", supplyBefore.toString());

  // --- mint ---
  console.log("\nMinting 1 unit to:", caller);
  const txHash = await token.write.mint([caller, 1n]);
  console.log("mint tx:", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 2,
  });

  console.log("mined in block:", receipt.blockNumber.toString());
  console.log("receipt status:", receipt.status);
  console.log("logs count:", receipt.logs.length);
  console.log(
    "log addresses:",
    receipt.logs.map((l) => l.address)
  );

  // --- optional block-pinned read (best-effort) ---
  try {
    const balAtBlock = await token.read.balanceOf([caller], {
      blockNumber: receipt.blockNumber,
    });
    const supplyAtBlock = await token.read.totalSupply([], {
      blockNumber: receipt.blockNumber,
    });
    console.log("\nBalance after (at mined block):", balAtBlock.toString());
    console.log(
      "Total supply after (at mined block):",
      supplyAtBlock.toString()
    );
  } catch (e) {
    if (isBlockNotFound(e)) {
      console.log(
        "\n(at-mined-block read unavailable — continuing with latest)"
      );
    } else {
      throw e;
    }
  }

  // --- always read latest (authoritative) ---
  const balAfter = await retry(() => token.read.balanceOf([caller]));
  const supplyAfter = await retry(() => token.read.totalSupply());

  console.log("\nBalance after (latest):", balAfter.toString());
  console.log("Total supply after (latest):", supplyAfter.toString());

  console.log("\nDone ✅");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
