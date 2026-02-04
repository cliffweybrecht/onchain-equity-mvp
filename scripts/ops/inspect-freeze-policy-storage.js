import "dotenv/config";
import {
  createPublicClient,
  http,
  getAddress,
  keccak256,
  toBytes,
  hexToBigInt,
  toHex,
} from "viem";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const FREEZE_POLICY = getAddress(process.env.FREEZE_POLICY || "0x72dAf10067387bb9022356246a1734E871931e58");
const EXPECT = (process.env.EXPECT_EMERGENCY_ADMIN || "0x6C775411e11cAb752Af03C5BBb440618788E13Be").toLowerCase();

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

function rightAlignedAddr(slotHex) {
  const hex = slotHex.startsWith("0x") ? slotHex.slice(2) : slotHex;
  return `0x${hex.slice(24)}`.toLowerCase(); // last 20 bytes
}

function leftAlignedAddr(slotHex) {
  const hex = slotHex.startsWith("0x") ? slotHex.slice(2) : slotHex;
  return `0x${hex.slice(0, 40)}`.toLowerCase(); // first 20 bytes
}

function eip1967Slot(label) {
  // bytes32(uint256(keccak256("eip1967.proxy.<label>")) - 1)
  const h = keccak256(toBytes(`eip1967.proxy.${label}`));
  const bi = hexToBigInt(h) - 1n;
  return { label, slot: bi, slotHex: toHex(bi) };
}

async function dumpSlots(from, to) {
  console.log(`\nStorage slots ${from}..${to}:`);
  for (let i = from; i <= to; i++) {
    const v = await client.getStorageAt({ address: FREEZE_POLICY, slot: BigInt(i) });
    console.log(
      `  slot ${i.toString().padStart(4, " ")}: ${v}  | right=${rightAlignedAddr(v)} left=${leftAlignedAddr(v)}`
    );
  }
}

async function scanForExpected(maxSlot) {
  console.log(`\nScanning slots 0..${maxSlot} for ${EXPECT} (right/left aligned) ...`);
  const hits = [];

  for (let i = 0n; i <= BigInt(maxSlot); i++) {
    const v = await client.getStorageAt({ address: FREEZE_POLICY, slot: i });
    const r = rightAlignedAddr(v);
    const l = leftAlignedAddr(v);
    if (r === EXPECT || l === EXPECT) hits.push({ slot: i, raw: v, match: r === EXPECT ? "right" : "left" });
  }

  if (hits.length === 0) {
    console.log("  (no hits)");
  } else {
    console.log(`  hits: ${hits.length}`);
    for (const h of hits.slice(0, 25)) {
      console.log(`  slot ${h.slot}: ${h.raw}  (${h.match}-aligned)`);
    }
    if (hits.length > 25) console.log("  ... (truncated)");
  }
}

async function readEip1967() {
  const impl = eip1967Slot("implementation");
  const adm = eip1967Slot("admin");
  const beacon = eip1967Slot("beacon");

  console.log("\nEIP-1967 slots:");
  for (const x of [impl, adm, beacon]) {
    const v = await client.getStorageAt({ address: FREEZE_POLICY, slot: x.slot });
    console.log(`  ${x.label.padEnd(14)} slot=${x.slotHex} value=${v} right=${rightAlignedAddr(v)}`);
  }
}

async function main() {
  console.log("\n== Inspect Freeze Policy Storage ==");
  console.log("chainId:", baseSepolia.id);
  console.log("rpcUrl:", RPC);
  console.log("freezePolicy:", FREEZE_POLICY);
  console.log("expect:", EXPECT);

  const code = await client.getBytecode({ address: FREEZE_POLICY });
  console.log("\nBytecode:");
  console.log("  deployed code present:", !!code);
  console.log("  code length:", code ? (code.length - 2) / 2 : 0, "bytes");

  await dumpSlots(0, 15);
  await scanForExpected(4095);
  await readEip1967();

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});
