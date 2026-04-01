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
  if (typeof value === 'bigint') return value.toString()
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

function normalizeGrant(grant) {
  if (!grant) throw new Error('Missing grant result')

  const total = BigInt(grant.total ?? grant[0])
  const released = BigInt(grant.released ?? grant[1])
  const start = BigInt(grant.start ?? grant[2])
  const cliff = BigInt(grant.cliff ?? grant[3])
  const duration = BigInt(grant.duration ?? grant[4])
  const exists = Boolean(grant.exists ?? grant[5])
  const revoked = Boolean(grant.revoked ?? grant[6])
  const revokedAt = BigInt(grant.revokedAt ?? grant[7])
  const end = start + duration

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
  }
}

function effectiveTimeForGrant(grant, queryTime) {
  const t = BigInt(queryTime)
  if (grant.revoked && t > grant.revokedAt) {
    return grant.revokedAt
  }
  return t
}

function computeVested(total, start, cliff, end, effectiveTime) {
  const totalBig = BigInt(total)
  const startBig = BigInt(start)
  const cliffBig = BigInt(cliff)
  const endBig = BigInt(end)
  const t = BigInt(effectiveTime)

  if (t < cliffBig) return 0n
  if (t <= startBig) return 0n
  if (t >= endBig) return totalBig

  const duration = endBig - startBig
  if (duration === 0n) return totalBig

  const elapsed = t - startBig
  return (totalBig * elapsed) / duration
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
      { name: 'exists', type: 'bool' },
      { name: 'revoked', type: 'bool' },
      { name: 'revokedAt', type: 'uint64' }
    ]
  }
]

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
})

const latestBlock = await client.getBlock({ blockTag: 'latest' })
const rawGrant = await client.readContract({
  address: vesting,
  abi: vestingAbi,
  functionName: 'grants',
  args: [beneficiary]
})

const grant = normalizeGrant(rawGrant)
const currentTime = BigInt(latestBlock.timestamp)

if (!grant.exists) {
  throw new Error(`No grant exists for beneficiary ${beneficiary}`)
}

const effectiveTime = effectiveTimeForGrant(grant, currentTime)
const expectedVested = computeVested(
  grant.total,
  grant.start,
  grant.cliff,
  grant.end,
  effectiveTime
)
const expectedClaimable =
  expectedVested > grant.released ? expectedVested - grant.released : 0n

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
    timestamp: currentTime.toString()
  },
  grant_prestate: {
    total: grant.total.toString(),
    released: grant.released.toString(),
    start: grant.start.toString(),
    cliff: grant.cliff.toString(),
    duration: grant.duration.toString(),
    end: grant.end.toString(),
    exists: grant.exists,
    revoked: grant.revoked,
    revokedAt: grant.revokedAt.toString()
  },
  computed: {
    effective_time: effectiveTime.toString(),
    expected_vested: expectedVested.toString(),
    expected_claimable: expectedClaimable.toString(),
    formula: 'linear vesting with cliff; effective_time = revoked ? min(block_timestamp, revokedAt) : block_timestamp; 0 before cliff; total at/after end; otherwise total * (effective_time-start) / (end-start)'
  }
}

writeJson(outFile, payload)

console.log(`Wrote ${outFile}`)
console.log(`effective_time    = ${effectiveTime}`)
console.log(`expected_vested   = ${expectedVested}`)
console.log(`expected_claimable= ${expectedClaimable}`)
