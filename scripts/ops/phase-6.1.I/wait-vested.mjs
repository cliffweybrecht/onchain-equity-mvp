import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
  return out;
}
function writeCanonical(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(canonicalize(obj), null, 2) + "\\n");
}

function loadAbi() {
  const p = "artifacts/contracts/VestingContract.sol/VestingContract.json";
  if (!fs.existsSync(p)) throw new Error(`Missing ABI artifact at ${p}`);
  const json = JSON.parse(fs.readFileSync(p, "utf8"));
  return { abi: json.abi, artifactPath: p };
}

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const vesting = process.env.VESTING;
  const beneficiary = process.env.BENEFICIARY;

  if (!rpcUrl) throw new Error("Set RPC_URL");
  if (!vesting) throw new Error("Set VESTING");
  if (!beneficiary) throw new Error("Set BENEFICIARY");

  const VESTING = getAddress(vesting);
  const BENEFICIARY = getAddress(beneficiary);

  const { abi, artifactPath } = loadAbi();
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  console.log("rpc:", rpcUrl);
  console.log("vesting:", VESTING);
  console.log("beneficiary:", BENEFICIARY);
  console.log("waiting for vestedAmount(beneficiary) > 0 ...");

  for (;;) {
    const blockNumber = await client.getBlockNumber();
    const vested = await client.readContract({
      address: VESTING,
      abi,
      functionName: "vestedAmount",
      args: [BENEFICIARY],
      blockNumber,
    });

    process.stdout.write(`block=${blockNumber} vested=${vested}\\r`);

    if (vested > 0n) {
      console.log(`\\n✅ vestedAmount > 0 at block ${blockNumber} value ${vested}`);

      const evidence = {
        schema: "phase-6.1.I.precondition.v1",
        network: { name: "baseSepolia", chainId: 84532 },
        rpc: rpcUrl,
        vestingContract: VESTING,
        beneficiary: BENEFICIARY,
        observedAt: { blockNumber: blockNumber.toString(), vestedAmount: vested.toString() },
        abiArtifact,
      };

      const out = `evidence/phase-6.1.I/precondition.vested>0.block-${blockNumber}.json`;
      writeCanonical(out, evidence);
      console.log("✅ wrote", out);
      console.log(`\\nNEXT:\\n  export PREBLOCK=${blockNumber}`);
      return;
    }

    await new Promise((r) => setTimeout(r, 8000));
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
