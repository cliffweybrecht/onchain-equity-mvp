import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

function canonicalize(v){
  if (v===null || typeof v!=="object") return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const o={}; for (const k of Object.keys(v).sort()) o[k]=canonicalize(v[k]);
  return o;
}
function writeCanonical(fp,obj){
  fs.mkdirSync(path.dirname(fp),{recursive:true});
  fs.writeFileSync(fp, JSON.stringify(canonicalize(obj),null,2)+"\\n");
}
function loadAbi(){
  const p="artifacts/contracts/VestingContract.sol/VestingContract.json";
  const j=JSON.parse(fs.readFileSync(p,"utf8"));
  return { abi:j.abi, artifactPath:p };
}

async function main(){
  const rpcUrl=process.env.RPC_URL;
  if(!rpcUrl) throw new Error("Set RPC_URL");
  if(!process.env.VESTING) throw new Error("Set VESTING");
  if(!process.env.BENEFICIARY) throw new Error("Set BENEFICIARY");
  const vesting=getAddress(process.env.VESTING);
  const beneficiary=getAddress(process.env.BENEFICIARY);

  const { abi, artifactPath } = loadAbi();
  const client=createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  const grant=await client.readContract({ address: vesting, abi, functionName:"grants", args:[beneficiary] });
  const total=grant[0];
  const start=grant[2];
  const duration=grant[4];
  if(total===0n) throw new Error("Grant total is 0");

  const firstVestTs = start + (duration / total);
  console.log("firstVestTs:", firstVestTs.toString());

  while(true){
    const blk=await client.getBlock();
    const nowTs=blk.timestamp;
    if(nowTs + 120n < firstVestTs){
      const remaining = firstVestTs - nowTs;
      console.log(`nowTs=${nowTs} remaining=${remaining}s -> sleeping 300s`);
      await new Promise(r=>setTimeout(r,300000));
      continue;
    }
    const blockNumber=blk.number;
    const vested=await client.readContract({ address: vesting, abi, functionName:"vestedAmount", args:[beneficiary], blockNumber });
    process.stdout.write(`block=${blockNumber} ts=${nowTs} vested=${vested}\\r`);
    if(vested>0n){
      console.log(`\\n✅ vestedAmount > 0 at block ${blockNumber} value ${vested}`);
      const evidence={
        schema:"phase-6.1.I.precondition.v1",
        network:{ name:"baseSepolia", chainId:84532 },
        rpc: rpcUrl,
        vestingContract: vesting,
        beneficiary: beneficiary,
        observedAt:{ blockNumber:blockNumber.toString(), blockTimestamp:nowTs.toString(), vestedAmount:vested.toString() },
        grant:{ total:total.toString(), start:start.toString(), duration:duration.toString(), firstVestTs:firstVestTs.toString() },
        abiArtifact: artifactPath,
      };
      const out=`evidence/phase-6.1.I/precondition.vested>0.block-${blockNumber}.json`;
      writeCanonical(out,evidence);
      console.log("✅ wrote", out);
      console.log(`\\nNEXT:\\n  export PREBLOCK=${blockNumber}`);
      return;
    }
    await new Promise(r=>setTimeout(r,8000));
  }
}

main().catch(e=>{ console.error("❌", e); process.exit(1); });
