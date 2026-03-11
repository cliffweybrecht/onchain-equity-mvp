import {
  createPublicClient,
  http,
  getAddress,
  decodeEventLog,
  parseAbiItem
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
      { name: 'exists', type: 'bool' }
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

const grantBefore = await client.readContract({
  address: vesting,
  abi: vestingAbi,
  functionName: 'grants',
  args: [beneficiary],
  blockNumber: claimBlock - 1n
})

const grantAfter = await client.readContract({
  address: vesting,
  abi: vestingAbi,
  functionName: 'grants',
  args: [beneficiary],
  blockNumber: claimBlock
})

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
const matchingTransferLogs = []
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
        log_index: log.logIndex
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
        log_index: log.logIndex
      }

      allPayoutTokenTransferLogs.push(normalized)

      if (
        normalized.from === vesting &&
        normalized.to === beneficiary
      ) {
        matchingTransferLogs.push(normalized)
      }
    } catch (_) {}
  }
}

const beforeReleased = BigInt(grantBefore[1])
const afterReleased = BigInt(grantAfter[1])
const releasedDelta = afterReleased - beforeReleased

const beneficiaryBalanceBefore = BigInt(balanceBefore)
const beneficiaryBalanceAfter = BigInt(balanceAfter)
const beneficiaryBalanceDelta = beneficiaryBalanceAfter - beneficiaryBalanceBefore

const amountReleasedFromEvent =
  grantReleasedLogs.length > 0 ? BigInt(grantReleasedLogs[0].amountReleased) : null

const transferAmount =
  matchingTransferLogs.length > 0 ? BigInt(matchingTransferLogs[0].value) : null

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
    total: grantBefore[0].toString(),
    released: grantBefore[1].toString(),
    start: Number(grantBefore[2]),
    cliff: Number(grantBefore[3]),
    duration: Number(grantBefore[4]),
    exists: Boolean(grantBefore[5])
  },
  grant_poststate_at_claim_block: {
    total: grantAfter[0].toString(),
    released: grantAfter[1].toString(),
    start: Number(grantAfter[2]),
    cliff: Number(grantAfter[3]),
    duration: Number(grantAfter[4]),
    exists: Boolean(grantAfter[5])
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
    vesting_to_beneficiary_transfer_events: matchingTransferLogs,
    transfer_amount: transferAmount?.toString?.() ?? null
  },
  checks: {
    grant_exists_before: Boolean(grantBefore[5]),
    grant_exists_after: Boolean(grantAfter[5]),
    released_delta_positive: releasedDelta > 0n,
    grant_released_event_detected: grantReleasedLogs.length > 0,
    payout_transfer_detected: matchingTransferLogs.length > 0,
    event_matches_released_delta:
      amountReleasedFromEvent !== null && amountReleasedFromEvent === releasedDelta,
    transfer_matches_released_delta:
      transferAmount !== null && transferAmount === releasedDelta,
    beneficiary_balance_delta_matches_released_delta:
      beneficiaryBalanceDelta === releasedDelta
  }
}

writeJson(outFile, payload)

console.log(`Wrote ${outFile}`)
console.log(`released delta = ${releasedDelta}`)
console.log(`beneficiary balance delta = ${beneficiaryBalanceDelta}`)
console.log(`matching payout transfers = ${matchingTransferLogs.length}`)
