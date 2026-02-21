import { execSync } from "child_process";

const configPath = process.argv[2] || "evidence/part-6.2/vesting-proof.config.json";

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(`node scripts/ops/verify-vesting-invariants.mjs ${configPath}`);
  run(`node scripts/ops/verify-vesting-golden.mjs ${configPath}`);
  console.log("\n✅ ONE-COMMAND VESTING PROOF COMPLETE");
}
