import fs from "fs";
import path from "path";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { canonStringify, sha256Hex } from "../lib/canon.mjs";
import { vestedLinearWithCliff, clamp0 } from "../lib/vesting-math.mjs";

/*
  Minimal ABI — deterministic, no artifacts, matches current converged VestingContract.
*/
const VESTING_MIN_ABI = [
  {
    type: "function",
    name: "grants",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { type: "uint256", name: "total" },
      { type: "uint256", name: "released" },
      { type: "uint64",  name: "start" },
      { type: "uint64",  name: "cliff" },
      { type: "uint64",  name: "duration" },
      { type: "bool",    name: "exists" },
      { type: "bool",    name: "revoked" },
      { type: "uint64",  name: "revokedAt" }
    ]
  },
  {
    type: "function",
    name: "vestedAmount",
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

function pickGrantShape(raw) {
  if (Array.isArray(raw)) {
    if (raw.length < 8) {
      throw new Error(`Unexpected grants() shape: ${JSON.stringify(raw)}`);
    }

    const total = toBigInt(raw[0]);
    const released = toBigInt(raw[1]);
    const start = toBigInt(raw[2]);
    const cliff = toBigInt(raw[3]);
    const duration = toBigInt(raw[4]);
    const exists = Boolean(raw[5]);
    const revoked = Boolean(raw[6]);
    const revokedAt = toBigInt(raw[7]);
    const end = start + duration;

    return {
      total,
      released,
      start,
      cliff,
      duration,
      end,
      exists,
      revoked,
      revokedAt
    };
  }

  if (raw && typeof raw === "object") {
    const total = toBigInt(raw.total);
    const released = toBigInt(raw.released);
    const start = toBigInt(raw.start);
    const cliff = toBigInt(raw.cliff);
    const duration = toBigInt(raw.duration);
    const exists = Boolean(raw.exists);
    const revoked = Boolean(raw.revoked);
    const revokedAt = toBigInt(raw.revokedAt);
    const end = start + duration;

    return {
      total,
      released,
      start,
      cliff,
      duration,
      end,
      exists,
      revoked,
      revokedAt
    };
  }

  throw new Error(`Unable to normalize grants() result shape: ${JSON.stringify(raw)}`);
}

function effectiveTimeForGrant(grant, queryTime) {
  const t = toBigInt(queryTime);
  if (grant.revoked && t > grant.revokedAt) {
    return grant.revokedAt;
  }
  return t;
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

  let vestedOnchain = 0n;
  if (g.exists) {
    vestedOnchain = await client.readContract({
      address: vesting,
      abi: VESTING_MIN_ABI,
      functionName: "vestedAmount",
      args: [beneficiary],
      blockNumber: pinnedBlock
    });
    vestedOnchain = toBigInt(vestedOnchain);
  }

  const effectiveTime = effectiveTimeForGrant(g, pinnedTimestamp);

  const vestedScript = g.exists
    ? vestedLinearWithCliff({
        total: g.total,
        start: g.start,
        cliff: g.cliff,
        end: g.end,
        t: effectiveTime
      })
    : 0n;

  const releasableScript = g.exists
    ? clamp0(vestedScript - g.released)
    : 0n;

  const inv = [];
  const ok = (name, cond, detail = null) =>
    inv.push({ name, pass: !!cond, detail });

  ok("grant.exists is true", g.exists === true, { exists: g.exists });

  if (g.exists) {
    ok("grant.total > 0", g.total > 0n, { total: g.total.toString() });
    ok("start <= cliff", g.start <= g.cliff, {
      start: g.start.toString(),
      cliff: g.cliff.toString()
    });
    ok("cliff <= end", g.cliff <= g.end, {
      cliff: g.cliff.toString(),
      end: g.end.toString()
    });
    ok("released <= total", g.released <= g.total, {
      released: g.released.toString(),
      total: g.total.toString()
    });

    ok(
      "vestedScript in [0,total]",
      vestedScript >= 0n && vestedScript <= g.total,
      {
        vestedScript: vestedScript.toString(),
        total: g.total.toString()
      }
    );

    ok(
      "vestedOnchain == vestedScript",
      vestedOnchain === vestedScript,
      {
        onchain: vestedOnchain.toString(),
        script: vestedScript.toString()
      }
    );

    ok(
      "releasableScript = max(0, vestedScript - released)",
      releasableScript === clamp0(vestedScript - g.released),
      {
        releasableScript: releasableScript.toString(),
        vestedScript: vestedScript.toString(),
        released: g.released.toString()
      }
    );

    if (g.revoked) {
      ok(
        "revokedAt > 0 when revoked",
        g.revokedAt > 0n,
        { revokedAt: g.revokedAt.toString() }
      );

      ok(
        "effectiveTime == min(pinnedTimestamp, revokedAt) when revoked",
        effectiveTime === (pinnedTimestamp > g.revokedAt ? g.revokedAt : pinnedTimestamp),
        {
          pinnedTimestamp: pinnedTimestamp.toString(),
          revokedAt: g.revokedAt.toString(),
          effectiveTime: effectiveTime.toString()
        }
      );
    } else {
      ok(
        "revokedAt == 0 when not revoked",
        g.revokedAt === 0n,
        { revokedAt: g.revokedAt.toString() }
      );

      ok(
        "effectiveTime == pinnedTimestamp when not revoked",
        effectiveTime === pinnedTimestamp,
        {
          pinnedTimestamp: pinnedTimestamp.toString(),
          effectiveTime: effectiveTime.toString()
        }
      );
    }
  }

  const evidence = {
    schema: "vesting-proof-v2",
    phase: "8.4.B",
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
      total: g.total.toString(),
      released: g.released.toString(),
      start: g.start.toString(),
      cliff: g.cliff.toString(),
      duration: g.duration.toString(),
      end: g.end.toString(),
      exists: g.exists,
      revoked: g.revoked,
      revokedAt: g.revokedAt.toString()
    },
    computed: {
      effectiveTime: effectiveTime.toString(),
      vestedScript: vestedScript.toString(),
      vestedOnchain: vestedOnchain.toString(),
      releasableScript: releasableScript.toString()
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
