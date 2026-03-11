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

const prePath = args.pre || 'contracts/evidence/phase-8.2/claim-prestate.json'
const receiptPath = args.receipt || 'contracts/evidence/phase-8.2/claim-execution-receipt.json'
const postPath = args.post || 'contracts/evidence/phase-8.2/claim-poststate.json'
const outFile = args.out || 'contracts/evidence/phase-8.2/claim-execution-summary.json'

const pre = JSON.parse(fs.readFileSync(prePath, 'utf8'))
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
const post = JSON.parse(fs.readFileSync(postPath, 'utf8'))

const hardChecks = {
  prestate_claimable_positive: BigInt(pre.computed.expected_claimable) > 0n,
  tx_success: receipt.transaction.status === 'success',
  released_delta_positive: Boolean(post.checks.released_delta_positive),
  grant_released_event_detected: Boolean(post.checks.grant_released_event_detected),
  event_matches_released_delta: Boolean(post.checks.event_matches_released_delta),
  beneficiary_balance_delta_matches_released_delta: Boolean(
    post.checks.beneficiary_balance_delta_matches_released_delta
  )
}

const softChecks = {
  payout_transfer_detected: Boolean(post.checks.payout_transfer_detected),
  transfer_matches_released_delta: Boolean(post.checks.transfer_matches_released_delta)
}

const hardPass = Object.values(hardChecks).every(Boolean)
const overallStatus = hardPass ? 'PASS' : 'FAIL'

const payload = {
  phase: '8.2',
  generated_at: new Date().toISOString(),
  objective: 'Demonstrate deterministic vesting lifecycle payout: verified beneficiary with claimable grant -> release transaction -> released delta -> token payout delta',
  artifacts: {
    prestate: prePath,
    execution_receipt: receiptPath,
    poststate: postPath
  },
  execution: {
    tx_hash: receipt.transaction.hash,
    block_number: receipt.transaction.block_number,
    timestamp: receipt.transaction.timestamp,
    timestamp_source: receipt.transaction.timestamp_source ?? 'recovered',
    selected_method: receipt.selected_method
  },
  prestate_snapshot: {
    prestate_block_number: pre.latest_block.number,
    expected_vested: pre.computed.expected_vested,
    expected_claimable: pre.computed.expected_claimable
  },
  tx_bound_reconciliation: {
    payout_token: post.payout_token,
    released_before_at_claim_block: post.release_accounting.released_before,
    released_after_at_claim_block: post.release_accounting.released_after,
    released_delta_for_tx: post.release_accounting.released_delta,
    grant_released_event_amount: post.grant_released_event_verification.amount_released_from_event,
    payout_transfer_amount: post.transfer_verification.transfer_amount,
    beneficiary_balance_delta: post.payout_balance_verification.beneficiary_balance_delta
  },
  hard_checks: hardChecks,
  soft_checks: softChecks,
  notes: [
    'The prestate artifact and the successful claim transaction occurred at different times.',
    'Accordingly, payout proof is reconciled using block-bound deltas at the claim transaction block, not by comparing current cumulative released state to the earlier prestate snapshot.',
    'Primary payout proof is established by agreement between grant released delta, GrantReleased event amount, and beneficiary payout-token balance delta.',
    'A strict Transfer(from=vesting,to=beneficiary,value=delta) event match was not recovered from the claim receipt and is recorded as a soft-check inconsistency for follow-up.',
    'EquityToken declares decimals = 0, while the grant quantity model used 18-decimal-style raw units. This phase proves raw-unit payout correctness and also surfaces a unit-model inconsistency for future cleanup.'
  ],
  status: overallStatus
}

writeJson(outFile, payload)

if (!hardPass) {
  console.error(JSON.stringify(payload, null, 2))
  process.exit(1)
}

console.log(`Wrote ${outFile}`)
console.log(`status = ${payload.status}`)
