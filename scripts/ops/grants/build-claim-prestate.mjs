import { createPublicClient, http, getAddress } from 'viem'
import { baseSepolia } from 'viem/chains'
import fs from 'fs'
import path from 'path'

function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, k) => {
      acc[k] = stable(value[k])
      return acc
    }, {})
  }
  return value
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(stable(value), null, 2) + '\n')
}

function computeVested(total, start, cliff, duration, nowTs) {
  const totalBig = BigInt(total)
  const startBig = BigInt(start)
  const cliffBig = BigInt(cliff)
  const durationBig = BigInt(duration)
  const nowBig = BigInt(nowTs)

  if (nowBig < cliffBig) return 0n
  if (durationBig === 0n) return totalBig
  if (nowBig <= startBig) return 0n

  const elapsed = nowBig - startBig
  if (elapsed >= durationBig) return totalBig

  return (totalBig * elapsed) / durationBig
}

const args = parseArgs(process.argv)

const rpcUrl = args.rpc || process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_URL
if (!rpcUrl) {
  throw new Error('Missing RPC URL. Use --rpc or set BASE_SEPOLIA_RPC_URL / RPC_URL')
}

const vesting = getAddress(args.vesting || '0xEf444C538769d7626511A4C538d03fFc7e53262B')
const beneficiary = getAddress(args.beneficiary || '0xd3eD697274ec8Bc9f638CE80fD789a49dA4aD996')
const outFile = args.out || 'contracts/evidence/phase-8.2/claim-prestate.json'

const vestingAbi = [
  {
    type: 'function',
    name: 'grants',
    stateMutability: 'view',
    inputs: [{ name: 'beneficiary', type: 'address' }],
    outputs: [
      { name: 'total', type: 'uint256' },
      { name: 'released', type: 'uint256' },
      { name: 'start', type: 'uint64' },
      { name: 'cliff', type: 'uint64' },
      { name: 'duration', type: 'uint64' },
      { name: 'exists', type: 'bool' }
    ]
  }
]

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
})

const latestBlock = await client.getBlock({ blockTag: 'latest' })
const grant = await client.readContract({
  address: vesting,
  abi: vestingAbi,
  functionName: 'grants',
  args: [beneficiary]
})

const total = BigInt(grant[0])
const released = BigInt(grant[1])
const start = Number(grant[2])
const cliff = Number(grant[3])
const duration = Number(grant[4])
const exists = Boolean(grant[5])
const currentTime = Number(latestBlock.timestamp)

if (!exists) {
  throw new Error(`No grant exists for beneficiary ${beneficiary}`)
}

const expectedVested = computeVested(total, start, cliff, duration, currentTime)
const expectedClaimable = expectedVested > released ? expectedVested - released : 0n

const payload = {
  phase: '8.2',
  generated_at: new Date().toISOString(),
  chain_id: baseSepolia.id,
  rpc_url_redacted: true,
  vesting_contract: vesting,
  beneficiary,
  latest_block: {
    number: latestBlock.number.toString(),
    hash: latestBlock.hash,
    timestamp: currentTime
  },
  grant_prestate: {
    total: total.toString(),
    released: released.toString(),
    start,
    cliff,
    duration,
    exists
  },
  computed: {
    expected_vested: expectedVested.toString(),
    expected_claimable: expectedClaimable.toString(),
    formula: 'linear vesting; 0 before cliff; total after start+duration; otherwise total * (now-start) / duration'
  }
}

writeJson(outFile, payload)

console.log(`Wrote ${outFile}`)
console.log(`expected_vested   = ${expectedVested}`)
console.log(`expected_claimable= ${expectedClaimable}`)
