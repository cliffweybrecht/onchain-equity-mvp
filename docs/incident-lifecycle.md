# Incident Lifecycle (Regulator-Grade) — Part 3.9

This document defines the standard lifecycle for security/compliance incidents and the evidence required for audit/regulatory review.

## Phase 0 — Baseline (Pre-Incident)
Goal: establish known-good state.
Evidence:
- governance snapshot JSON (admins + frozen=false)
- stack health report (PASS/FAIL with reasons)

## Phase 1 — Detection
Triggers (examples):
- unexpected transfer failures
- abnormal mint attempts
- governance drift (admin mismatch)
- policy trace indicates unexpected blocking policy

Evidence:
- time of detection (UTC)
- initiating alert/source
- initial logs and tx hashes (if any)

## Phase 2 — Containment (Emergency Controls)
Actions:
- execute emergency freeze via SAFE
- validate freeze is active (policy + token layer)

Evidence (required):
- SAFE tx hash for freeze
- on-chain confirmation that frozen == true
- proof transfers are blocked + revert decode
References:
- scripts/ops/freeze.js
- scripts/ops/decode-emergency-freeze-reverts.js

## Phase 3 — Verification & Root Cause
Actions:
- run composite trace to identify blocking policy
- validate IdentityRegistry status + policy stack behavior

Evidence:
- composite trace output
- policy-by-policy attribution of blocking policy
References:
- scripts/ops/composite-trace.js

## Phase 4 — Recovery
Actions:
- execute emergency unfreeze via SAFE
- confirm frozen == false
- confirm normal (expected) policy gating persists

Evidence:
- SAFE tx hash for unfreeze
- on-chain confirmation frozen == false
- post-recovery transfer test evidence

## Phase 5 — Attestation / Regulator Packet
Deliverable bundle:
- incident summary (what/when/impact)
- containment tx hashes + blocks
- verification artifacts (trace outputs)
- recovery artifacts
- post-incident governance snapshot JSON
- change-control approvals

## Phase 6 — Post-Incident Hardening (this Part 3.9)
Actions:
- rotate admin surfaces to SAFE where possible
- record residual risks and compensating controls
- deploy automated PASS/FAIL health checks (optional)

Evidence:
- governance-snapshot-POSTROTATE JSON
- stack-health JSON report
- updated docs in repo (governance invariants + lifecycle)
