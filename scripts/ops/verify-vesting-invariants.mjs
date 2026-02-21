import fs from "fs";
import path from "path";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { canonStringify, sha256Hex } from "../lib/canon.mjs";
import { vestedLinearWithCliff, clamp0 } from "../lib/vesting-math.mjs";

/*
  Minimal ABI — no artifacts, no hre, fully deterministic.
*/
const VESTING_MIN_ABI = [
  {
    type: "function",
    name: "grants",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { type: "uint256" }, // total
      { type: "uint256" }, // released
      { type: "uint256" }, // start
      { type: "uint256" }, // duplicate start (ignored)
      { type: "uint256" }  // duration
    ]
  },
  {
    type: "function",
    name: "releasable",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }]
  }
];

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function mustFile(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function toBigInt(x) {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(x);
  if (typeof x === "string") return BigInt(x);
  return BigInt(x);
}

/*
  Your actual contract returns:
  [ total, released, start, startDuplicate, duration ]
*/
function pickGrantShape(raw) {
  if (!Array.isArray(raw) || raw.length < 5) {
    throw new Error(`Unexpected grants() shape: ${JSON.stringify(raw)}`);
  }

  const total = raw[0];
  const released = raw[1];
  const start = raw[2];
  const duration = raw[4];

  const end = toBigInt(start) + toBigInt(duration);

  return {
    total,
    released,
    start,
    cliff: start,
    end
  };
}

export async function runVestingInvariants({ configPath }) {
  const cfg = JSON.parse(mustFile(configPath));

  const rpcUrl = mustEnv(cfg.rpcUrlEnv);
  const pinnedBlock = BigInt(mustEnv(cfg.pinned.blockNumber));

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl)
  });

  const block = await client.getBlock({ blockNumber: pinnedBlock });
  const pinnedTimestamp = BigInt(block.timestamp);

  const vesting = cfg.contracts.vesting;
  const beneficiary = cfg.actors.beneficiary;

  const rawGrant = await client.readContract({
    address: vesting,
    abi: VESTING_MIN_ABI,
    functionName: "grants",
    args: [beneficiary],
    blockNumber: pinnedBlock
  });

  const g = pickGrantShape(rawGrant);

  const total = toBigInt(g.total);
  const released = toBigInt(g.released);
  const start = toBigInt(g.start);
  const cliff = toBigInt(g.cliff);
  const end = toBigInt(g.end);

  let releasableOnchain = null;
  try {
    releasableOnchain = await client.readContract({
      address: vesting,
      abi: VESTING_MIN_ABI,
      functionName: "releasable",
      args: [beneficiary],
      blockNumber: pinnedBlock
    });
    releasableOnchain = toBigInt(releasableOnchain);
  } catch {}

  const vested = vestedLinearWithCliff({
    total,
    start,
    cliff,
    end,
    t: pinnedTimestamp
  });

  const releasableScript = clamp0(vested - released);

  const inv = [];
  const ok = (name, cond, detail = null) =>
    inv.push({ name, pass: !!cond, detail });

  ok("grant.total > 0", total > 0n, { total: total.toString() });
  ok("start <= cliff", start <= cliff);
  ok("cliff <= end", cliff <= end);
  ok("released <= total", released <= total);

  ok(
    "vested in [0,total]",
    vested >= 0n && vested <= total,
    { vested: vested.toString() }
  );

  ok(
    "releasableScript = max(0, vested - released)",
    releasableScript === clamp0(vested - released)
  );

  if (releasableOnchain !== null) {
    ok(
      "releasableOnchain == releasableScript",
      releasableOnchain === releasableScript,
      {
        onchain: releasableOnchain.toString(),
        script: releasableScript.toString()
      }
    );
  }

  const evidence = {
    schema: "vesting-proof-v1",
    phase: "6.2",
    pinned: {
      blockNumber: pinnedBlock.toString(),
      blockTimestamp: pinnedTimestamp.toString()
    },
    inputs: {
      chain: cfg.chain,
      vesting,
      beneficiary
    },
    grant: {
      total: total.toString(),
      released: released.toString(),
      start: start.toString(),
      cliff: cliff.toString(),
      end: end.toString()
    },
    computed: {
      vested: vested.toString(),
      releasableScript: releasableScript.toString(),
      releasableOnchain:
        releasableOnchain?.toString?.() ?? null
    },
    invariants: inv
  };

  const canon = canonStringify(evidence);
  const digest = sha256Hex(canon);

  const summary = {
    pass: inv.every(x => x.pass),
    failed: inv.filter(x => !x.pass).map(x => x.name),
    digest
  };

  return { evidence, canon, digest, summary };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const configPath =
    process.argv[2] ||
    "evidence/part-6.2/vesting-proof.config.json";

  const { evidence, canon, digest, summary } =
    await runVestingInvariants({ configPath });

  const outDir = path.resolve("evidence/part-6.2/runs");
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(
    outDir,
    `vesting-proof.pinned-${evidence.pinned.blockNumber}.json`
  );

  fs.writeFileSync(outPath, canon);

  console.log("✅ vesting invariants evaluated");
  console.log("out:", outPath);
  console.log("digest:", digest);
  console.log("pass:", summary.pass);

  if (!summary.pass) {
    console.error("failed:", summary.failed);
    process.exit(1);
  }
}
