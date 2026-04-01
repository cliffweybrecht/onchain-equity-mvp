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
  mint_transfer_detected: Boolean(post.checks.mint_transfer_detected),
  mint_transfer_matches_released_delta: Boolean(post.checks.mint_transfer_matches_released_delta),
  beneficiary_balance_delta_matches_released_delta: Boolean(
    post.checks.beneficiary_balance_delta_matches_released_delta
  )
}

const softChecks = {
  prestate_revoked: Boolean(pre.grant_prestate.revoked),
  poststate_revoked: Boolean(post.grant_poststate_at_claim_block.revoked)
}

const hardPass = Object.values(hardChecks).every(Boolean)
const overallStatus = hardPass ? 'PASS' : 'FAIL'

const payload = {
  phase: '8.2',
  generated_at: new Date().toISOString(),
  objective: 'Demonstrate deterministic mint-on-claim vesting release: claimable grant state -> successful release transaction -> released delta -> Transfer(0x0 -> beneficiary, amount) -> beneficiary token balance delta',
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
    effective_time: pre.computed.effective_time,
    expected_vested: pre.computed.expected_vested,
    expected_claimable: pre.computed.expected_claimable,
    revoked: pre.grant_prestate.revoked,
    revokedAt: pre.grant_prestate.revokedAt
  },
  poststate_snapshot: {
    revoked: post.grant_poststate_at_claim_block.revoked,
    revokedAt: post.grant_poststate_at_claim_block.revokedAt
  },
  tx_bound_reconciliation: {
    payout_token: post.payout_token,
    released_before_at_claim_block: post.release_accounting.released_before,
    released_after_at_claim_block: post.release_accounting.released_after,
    released_delta_for_tx: post.release_accounting.released_delta,
    grant_released_event_amount: post.grant_released_event_verification.amount_released_from_event,
    mint_transfer_amount: post.transfer_verification.mint_transfer_amount,
    beneficiary_balance_delta: post.payout_balance_verification.beneficiary_balance_delta
  },
  hard_checks: hardChecks,
  soft_checks: softChecks,
  notes: [
    'This summary is issuance-model aligned to Phase 8.3.B mint-on-claim convergence.',
    'Primary release proof is established by agreement between released delta, GrantReleased event amount, Transfer(0x0 -> beneficiary, amount), and beneficiary token balance delta.',
    'Prestate expected claimable is derived from revocation-aware effective time semantics: effective_time = revoked ? min(block_timestamp, revokedAt) : block_timestamp.',
    'If the grant is not revoked, revokedAt must remain 0 and effective_time equals the pinned block timestamp.',
    'This summary is suitable as the control-path claim evidence base for subsequent Phase 8.4.C revocation verification.'
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
