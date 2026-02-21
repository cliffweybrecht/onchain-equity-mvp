import { encodeFunctionData, getAddress } from "viem";
import fs from "node:fs";

const ABI = [
  {
    type: "function",
    name: "setAdmin",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAdmin", type: "address" }],
    outputs: [],
  },
];

function stableStringify(obj) {
  const seen = new WeakSet();
  const sorter = (value) => {
    if (value && typeof value === "object") {
      if (seen.has(value)) throw new Error("circular");
      seen.add(value);
      if (Array.isArray(value)) return value.map(sorter);
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = sorter(value[k]);
      return out;
    }
    return value;
  };
  return JSON.stringify(sorter(obj), null, 2) + "\n";
}

async function main() {
  const vesting = process.env.VESTING;
  const newAdmin = process.env.NEW_ADMIN || process.env.EXPECTED_SAFE;

  if (!vesting) throw new Error("Set VESTING");
  if (!newAdmin) throw new Error("Set NEW_ADMIN (or EXPECTED_SAFE)");

  const vestingN = getAddress(vesting);
  const newAdminN = getAddress(newAdmin);

  const calldata = encodeFunctionData({
    abi: ABI,
    functionName: "setAdmin",
    args: [newAdminN],
  });

  const evidence = {
    schema: "phase-6.1.E-setAdmin-calldata-v1",
    contract: { vesting: vestingN },
    function: {
      name: "setAdmin",
      signature: "setAdmin(address)",
      args: { newAdmin: newAdminN },
    },
    calldata,
  };

  fs.mkdirSync("evidence/phase-6.1.E", { recursive: true });
  fs.writeFileSync("evidence/phase-6.1.E/setAdmin.calldata.txt", calldata + "\n");
  fs.writeFileSync("evidence/phase-6.1.E/setAdmin.calldata.json", stableStringify(evidence));
  fs.writeFileSync("evidence/phase-6.1.E/setAdmin-abi.json", stableStringify(ABI));

  console.log("✅ Wrote: evidence/phase-6.1.E/setAdmin.calldata.txt");
  console.log("✅ Wrote: evidence/phase-6.1.E/setAdmin.calldata.json");
  console.log("✅ Wrote: evidence/phase-6.1.E/setAdmin-abi.json");
  console.log("");
  console.log("Target vesting:", vestingN);
  console.log("New admin:", newAdminN);
  console.log("Calldata:", calldata);
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
