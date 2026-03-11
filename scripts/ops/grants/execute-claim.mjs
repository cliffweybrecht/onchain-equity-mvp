import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseAbi,
  defineChain
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
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
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
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

async function tryGetBlockTimestamp(publicClient, receipt) {
  const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000'

  if (receipt?.blockHash && receipt.blockHash !== zeroHash) {
    try {
      const block = await publicClient.getBlock({ blockHash: receipt.blockHash })
      return {
        timestamp: Number(block.timestamp),
        source: 'blockHash'
      }
    } catch (_) {}
  }

  if (receipt?.blockNumber != null) {
    try {
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber })
      return {
        timestamp: Number(block.timestamp),
        source: 'blockNumber'
      }
    } catch (_) {}
  }

  return {
    timestamp: null,
    source: 'unavailable_from_rpc'
  }
}

const args = parseArgs(process.argv)

const rpcUrl = args.rpc || process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_URL
if (!rpcUrl) {
  throw new Error('Missing RPC URL. Use --rpc or set BASE_SEPOLIA_RPC_URL / RPC_URL')
}

const privateKey = args.privateKey || process.env.BENEFICIARY_PRIVATE_KEY || process.env.PRIVATE_KEY
if (!privateKey) {
  throw new Error('Missing beneficiary private key. Use --privateKey or set BENEFICIARY_PRIVATE_KEY / PRIVATE_KEY')
}

const vesting = getAddress(args.vesting || '0xEf444C538769d7626511A4C538d03fFc7e53262B')
const beneficiary = getAddress(args.beneficiary || '0xd3eD697274ec8Bc9f638CE80fD789a49dA4aD996')
const outFile = args.out || 'contracts/evidence/phase-8.2/claim-execution-receipt.json'

const chain = defineChain({
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [rpcUrl]
    }
  }
})

const normalizedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`
const account = privateKeyToAccount(normalizedPrivateKey)

if (getAddress(account.address) !== beneficiary) {
  throw new Error(`Private key address ${account.address} does not match beneficiary ${beneficiary}`)
}

const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl)
})

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl)
})

const candidates = [
  {
    label: 'claim()',
    abi: parseAbi(['function claim()']),
    functionName: 'claim',
    args: []
  },
  {
    label: 'release()',
    abi: parseAbi(['function release()']),
    functionName: 'release',
    args: []
  },
  {
    label: 'claim(address)',
    abi: parseAbi(['function claim(address beneficiary)']),
    functionName: 'claim',
    args: [beneficiary]
  },
  {
    label: 'release(address)',
    abi: parseAbi(['function release(address beneficiary)']),
    functionName: 'release',
    args: [beneficiary]
  }
]

let selected = null
let simulation = null
let lastError = null

for (const candidate of candidates) {
  try {
    simulation = await publicClient.simulateContract({
      address: vesting,
      abi: candidate.abi,
      functionName: candidate.functionName,
      args: candidate.args,
      account
    })
    selected = candidate
    break
  } catch (err) {
    lastError = err
  }
}

if (!selected || !simulation) {
  throw new Error(
    `Unable to find a working claim/release method. Last error: ${lastError?.shortMessage || lastError?.message || 'unknown error'}`
  )
}

const txHash = await walletClient.writeContract(simulation.request)
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

if (!receipt || receipt.status !== 'success') {
  throw new Error(`Claim transaction did not succeed for tx ${txHash}`)
}

const tsInfo = await tryGetBlockTimestamp(publicClient, receipt)

const payload = {
  phase: '8.2',
  generated_at: new Date().toISOString(),
  vesting_contract: vesting,
  beneficiary,
  caller: account.address,
  selected_method: {
    label: selected.label,
    function_name: selected.functionName,
    args: selected.args
  },
  transaction: {
    hash: receipt.transactionHash ?? txHash,
    block_number: receipt.blockNumber?.toString?.() ?? null,
    block_hash: receipt.blockHash ?? null,
    transaction_index: receipt.transactionIndex ?? null,
    gas_used: receipt.gasUsed?.toString?.() ?? null,
    effective_gas_price: receipt.effectiveGasPrice?.toString?.() ?? null,
    status: receipt.status,
    timestamp: tsInfo.timestamp,
    timestamp_source: tsInfo.source
  },
  logs_count: receipt.logs?.length ?? 0,
  notes: tsInfo.timestamp === null
    ? [
        'Transaction receipt was obtained successfully.',
        'Block timestamp could not be recovered from the configured RPC endpoint.',
        'This does not invalidate claim execution proof; tx hash, block number, status, and logs remain authoritative.'
      ]
    : []
}

writeJson(outFile, payload)

console.log(`Wrote ${outFile}`)
console.log(`tx hash = ${receipt.transactionHash ?? txHash}`)
console.log(`block   = ${receipt.blockNumber?.toString?.() ?? 'unknown'}`)
console.log(`timestamp = ${tsInfo.timestamp ?? 'unavailable'}`)
