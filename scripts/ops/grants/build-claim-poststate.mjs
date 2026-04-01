import {
  createPublicClient,
  http,
  getAddress,
  decodeEventLog,
  parseAbiItem,
  zeroAddress
} from 'viem'
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

const args = parseArgs(process.argv)

const rpcUrl = args.rpc || process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_URL
if (!rpcUrl) {
  throw new Error('Missing RPC URL. Use --rpc or set BASE_SEPOLIA_RPC_URL / RPC_URL')
}

const vesting = getAddress(args.vesting || '0xEf444C538769d7626511A4C538d03fFc7e53262B')
const beneficiary = getAddress(args.beneficiary || '0xd3eD697274ec8Bc9f638CE80fD789a49dA4aD996')
const receiptPath = args.receipt || 'contracts/evidence/phase-8.2/claim-execution-receipt.json'
const outFile = args.out || 'contracts/evidence/phase-8.2/claim-poststate.json'

const receiptArtifact = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
const txHash = receiptArtifact.transaction.hash
const claimBlock = BigInt(receiptArtifact.transaction.block_number)

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
  },
  {
    type: 'function',
    name: 'token',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  }
]

const erc20BalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
]

const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
)

const grantReleasedEvent = parseAbiItem(
  'event GrantReleased(address indexed employee, uint256 amountReleased)'
)

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
})

const txReceipt = await client.getTransactionReceipt({ hash: txHash })

const payoutToken = getAddress(await client.readContract({
  address: vesting,
  abi: vestingAbi,
  functionName: 'token'
}))

const rawGrantBefore = await client.readContract({
  address: vesting,
  abi: vestingAbi,
  functionName: 'grants',
  args: [beneficiary],
  blockNumber: claimBlock - 1n
})

const rawGrantAfter = await client.readContract({
  address: vesting,
  abi: vestingAbi,
  functionName: 'grants',
  args: [beneficiary],
  blockNumber: claimBlock
})

const grantBefore = normalizeGrant(rawGrantBefore)
const grantAfter = normalizeGrant(rawGrantAfter)

const balanceBefore = await client.readContract({
  address: payoutToken,
  abi: erc20BalanceAbi,
  functionName: 'balanceOf',
  args: [beneficiary],
  blockNumber: claimBlock - 1n
})

const balanceAfter = await client.readContract({
  address: payoutToken,
  abi: erc20BalanceAbi,
  functionName: 'balanceOf',
  args: [beneficiary],
  blockNumber: claimBlock
})

const grantReleasedLogs = []
const mintToBeneficiaryTransferLogs = []
const allPayoutTokenTransferLogs = []

for (const log of txReceipt.logs) {
  if (getAddress(log.address) === vesting) {
    try {
      const decoded = decodeEventLog({
        abi: [grantReleasedEvent],
        data: log.data,
        topics: log.topics
      })

      grantReleasedLogs.push({
        employee: getAddress(decoded.args.employee),
        amountReleased: decoded.args.amountReleased.toString(),
        log_index: Number(log.logIndex)
      })
    } catch (_) {}
  }

  if (getAddress(log.address) === payoutToken) {
    try {
      const decoded = decodeEventLog({
        abi: [transferEvent],
        data: log.data,
        topics: log.topics
      })

      const normalized = {
        token_address: getAddress(log.address),
        from: getAddress(decoded.args.from),
        to: getAddress(decoded.args.to),
        value: decoded.args.value.toString(),
        log_index: Number(log.logIndex)
      }

      allPayoutTokenTransferLogs.push(normalized)

      if (
        normalized.from === zeroAddress &&
        normalized.to === beneficiary
      ) {
        mintToBeneficiaryTransferLogs.push(normalized)
      }
    } catch (_) {}
  }
}

const beforeReleased = grantBefore.released
const afterReleased = grantAfter.released
const releasedDelta = afterReleased - beforeReleased

const beneficiaryBalanceBefore = BigInt(balanceBefore)
const beneficiaryBalanceAfter = BigInt(balanceAfter)
const beneficiaryBalanceDelta = beneficiaryBalanceAfter - beneficiaryBalanceBefore

const amountReleasedFromEvent =
  grantReleasedLogs.length > 0 ? BigInt(grantReleasedLogs[0].amountReleased) : null

const mintTransferAmount =
  mintToBeneficiaryTransferLogs.length > 0 ? BigInt(mintToBeneficiaryTransferLogs[0].value) : null

const payload = {
  phase: '8.2',
  generated_at: new Date().toISOString(),
  vesting_contract: vesting,
  beneficiary,
  payout_token: payoutToken,
  source_transaction: {
    hash: txHash,
    block_number: txReceipt.blockNumber.toString(),
    block_hash: txReceipt.blockHash
  },
  grant_prestate_at_claim_block: {
    total: grantBefore.total.toString(),
    released: grantBefore.released.toString(),
    start: grantBefore.start.toString(),
    cliff: grantBefore.cliff.toString(),
    duration: grantBefore.duration.toString(),
    end: grantBefore.end.toString(),
    exists: grantBefore.exists,
    revoked: grantBefore.revoked,
    revokedAt: grantBefore.revokedAt.toString()
  },
  grant_poststate_at_claim_block: {
    total: grantAfter.total.toString(),
    released: grantAfter.released.toString(),
    start: grantAfter.start.toString(),
    cliff: grantAfter.cliff.toString(),
    duration: grantAfter.duration.toString(),
    end: grantAfter.end.toString(),
    exists: grantAfter.exists,
    revoked: grantAfter.revoked,
    revokedAt: grantAfter.revokedAt.toString()
  },
  release_accounting: {
    released_before: beforeReleased.toString(),
    released_after: afterReleased.toString(),
    released_delta: releasedDelta.toString()
  },
  grant_released_event_verification: {
    matching_events: grantReleasedLogs,
    amount_released_from_event: amountReleasedFromEvent?.toString?.() ?? null
  },
  payout_balance_verification: {
    beneficiary_balance_before: beneficiaryBalanceBefore.toString(),
    beneficiary_balance_after: beneficiaryBalanceAfter.toString(),
    beneficiary_balance_delta: beneficiaryBalanceDelta.toString()
  },
  transfer_verification: {
    all_payout_token_transfer_events: allPayoutTokenTransferLogs,
    mint_to_beneficiary_transfer_events: mintToBeneficiaryTransferLogs,
    mint_transfer_amount: mintTransferAmount?.toString?.() ?? null
  },
  checks: {
    grant_exists_before: grantBefore.exists,
    grant_exists_after: grantAfter.exists,
    released_delta_positive: releasedDelta > 0n,
    grant_released_event_detected: grantReleasedLogs.length > 0,
    mint_transfer_detected: mintToBeneficiaryTransferLogs.length > 0,
    event_matches_released_delta:
      amountReleasedFromEvent !== null && amountReleasedFromEvent === releasedDelta,
    mint_transfer_matches_released_delta:
      mintTransferAmount !== null && mintTransferAmount === releasedDelta,
    beneficiary_balance_delta_matches_released_delta:
      beneficiaryBalanceDelta === releasedDelta
  }
}

writeJson(outFile, payload)

console.log(`Wrote ${outFile}`)
console.log(`released delta = ${releasedDelta}`)
console.log(`beneficiary balance delta = ${beneficiaryBalanceDelta}`)
console.log(`matching mint transfers = ${mintToBeneficiaryTransferLogs.length}`)
