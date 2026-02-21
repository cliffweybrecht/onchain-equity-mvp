import fs from "fs";
import path from "path";
import { canonStringify } from "../lib/canon.mjs";
import { runVestingInvariants } from "./verify-vesting-invariants.mjs";

function mustFile(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function normalizeForGolden(e) {
  return {
    schema: e.schema,
    phase: e.phase,
    pinned: e.pinned,
    inputs: e.inputs,
    grant: e.grant,
    computed: e.computed,
    invariants: e.invariants.map(x => ({ name: x.name, pass: x.pass }))
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const configPath =
    process.argv[2] ||
    "evidence/part-6.2/vesting-proof.config.json";

  const cfg = JSON.parse(mustFile(configPath));

  if (!cfg.golden?.enabled) {
    console.log("ℹ️ golden disabled in config");
    process.exit(0);
  }

  const expectedPath = cfg.golden?.expectedPath;
  if (!expectedPath) {
    throw new Error("golden.enabled but golden.expectedPath missing");
  }

  const { evidence, summary } =
    await runVestingInvariants({ configPath });

  if (!summary.pass) {
    console.error("❌ invariants failing; golden check aborted");
    process.exit(1);
  }

  const actual = canonStringify(normalizeForGolden(evidence));

  fs.mkdirSync(path.dirname(expectedPath), { recursive: true });

  if (!fs.existsSync(expectedPath)) {
    fs.writeFileSync(expectedPath, actual);
    console.log("✅ golden baseline created:", expectedPath);
    process.exit(0);
  }

  const expected = mustFile(expectedPath);

  if (actual !== expected) {
    const gotPath = path.join(
      path.dirname(expectedPath),
      "GOT.expected.vesting-proof.json"
    );
    fs.writeFileSync(gotPath, actual);
    console.error("❌ golden mismatch");
    console.error("wrote:", gotPath);
    console.error("expected:", expectedPath);
    process.exit(1);
  }

  console.log("✅ golden match (release logic regression guard OK)");
}
