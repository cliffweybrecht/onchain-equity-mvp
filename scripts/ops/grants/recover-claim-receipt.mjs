import {
  createPublicClient,
  http,
  getAddress,
  defineChain,
  toHex
} from 'viem'
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

async function getBlockWithRetry(client, blockNumber, maxAttempts = 5) {
  let lastErr = null
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await client.getBlock({
        blockNumber,
        includeTransactions: true
      })
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr
}

const args = parseArgs(process.argv)

const rpcUrl = args.rpc || process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_URL
if (!rpcUrl) {
  throw new Error('Missing RPC URL. Use --rpc or set BASE_SEPOLIA_RPC_URL / RPC_URL')
}

const vesting = getAddress(args.vesting || '0xEf444C538769d7626511A4C538d03fFc7e53262B')
const beneficiary = getAddress(args.beneficiary || '0xd3eD697274ec8Bc9f638CE80fD789a49dA4aD996')
const outFile = args.out || 'contracts/evidence/phase-8.2/claim-execution-receipt.json'
const lookback = Number(args.lookback || 400)

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

const client = createPublicClient({
  chain,
  transport: http(rpcUrl)
})

const latest = await client.getBlockNumber()

const beneficiaryArg = beneficiary.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const releaseAddressData = `0x19165587${beneficiaryArg}` // release(address)
const claimAddressData = `0x1e83409a${beneficiaryArg}`   // claim(address) if present
const claimNoArgSelector = '0x4e71d92d'                  // claim()
const releaseNoArgSelector = '0x86d1a69f'                // release()

let found = null

for (let i = 0; i <= lookback; i++) {
  const blockNumber = latest - BigInt(i)
  const block = await getBlockWithRetry(client, blockNumber)

  for (const tx of block.transactions) {
    if (!tx.from || !tx.to || !tx.input) continue

    const from = getAddress(tx.from)
    const to = getAddress(tx.to)

    if (from !== beneficiary) continue
    if (to !== vesting) continue

    const input = tx.input.toLowerCase()

    const matches =
      input === releaseAddressData.toLowerCase() ||
      input === claimAddressData.toLowerCase() ||
      input === claimNoArgSelector.toLowerCase() ||
      input === releaseNoArgSelector.toLowerCase()

    if (!matches) continue

    const receipt = await client.getTransactionReceipt({ hash: tx.hash })

    if (receipt.status !== 'success') continue

    found = {
      tx,
      receipt,
      block
    }
    break
  }

  if (found) break
}

if (!found) {
  throw new Error(`No successful beneficiary->vesting claim transaction found in last ${lookback} blocks`)
}

const selector = found.tx.input.slice(0, 10).toLowerCase()
let method = {
  label: 'unknown',
  function_name: 'unknown',
  args: []
}

if (selector === '0x19165587') {
  method = {
    label: 'release(address)',
    function_name: 'release',
    args: [beneficiary]
  }
} else if (selector === '0x1e83409a') {
  method = {
    label: 'claim(address)',
    function_name: 'claim',
    args: [beneficiary]
  }
} else if (selector === '0x4e71d92d') {
  method = {
    label: 'claim()',
    function_name: 'claim',
    args: []
  }
} else if (selector === '0x86d1a69f') {
  method = {
    label: 'release()',
    function_name: 'release',
    args: []
  }
}

const payload = {
  phase: '8.2',
  generated_at: new Date().toISOString(),
  recovery_mode: true,
  recovery_notes: [
    'Recovered the successful claim transaction from onchain history after local receipt artifact generation failed.',
    'Recovered by scanning recent beneficiary -> vesting transactions and selecting the successful claim/release call.'
  ],
  vesting_contract: vesting,
  beneficiary,
  caller: beneficiary,
  selected_method: method,
  transaction: {
    hash: found.receipt.transactionHash,
    block_number: found.receipt.blockNumber.toString(),
    block_hash: found.receipt.blockHash,
    transaction_index: found.receipt.transactionIndex,
    gas_used: found.receipt.gasUsed.toString(),
    effective_gas_price: found.receipt.effectiveGasPrice?.toString?.() ?? null,
    status: found.receipt.status,
    timestamp: Number(found.block.timestamp)
  },
  logs_count: found.receipt.logs.length
}

writeJson(outFile, payload)

console.log(`Wrote ${outFile}`)
console.log(`tx hash = ${found.receipt.transactionHash}`)
console.log(`block   = ${found.receipt.blockNumber.toString()}`)
console.log(`method  = ${method.label}`)
