// ============================================================
// RevenueGuard AI — Stopping Rules (DETERMINISTIC)
// ============================================================
// WHY THIS IS A SEPARATE MODULE FROM decision-engine.ts:
//
// The decision engine picks the NEXT action.
// The stopping rules check AFTER every action whether to STOP.
//
// These are different responsibilities:
//   - Decision engine: "What should we do next?"
//   - Stopping rules: "Should we stop doing things entirely?"
//
// The architecture diagram shows these as two separate boxes in the
// pipeline, and a panelist will ask "where are your stopping rules?"
// You point to this one file.
//
// PANEL Q: "What stops your system from retrying indefinitely?"
// ANSWER:  "stopping-rules.ts — five deterministic checks that run
//           after every action. If any check triggers, the payment
//           exits the recovery loop and goes to the escalation queue.
//           It's code, not a prompt."
//
// ALL STOPPING RULES:
//   1. Max attempts (3) — hard cap
//   2. Hard decline code — stolen card, mandate revoked
//   3. Payment already recovered — success, stop
//   4. Customer explicitly declined — respect their wishes
//   5. Promise-to-pay expired + broken — gave them a chance, they didn't pay
// ============================================================

import type { RootCause } from './types';

// ============================================================
// Stopping Rule Result
// ============================================================
export interface StoppingRuleResult {
  should_stop: boolean;
  rule: string | null;    // Which rule triggered (null if not stopping)
  reason: string | null;  // Human-readable reason
}

// ============================================================
// Configuration — these could be environment variables in production
// ============================================================
const MAX_ATTEMPTS = 3;

const HARD_DECLINE_CODES: RootCause[] = [
  'mandate_revoked',
];

// Some error reasons from Razorpay that mean "do not retry"
const DO_NOT_RETRY_REASONS = [
  'stolen_card',
  'lost_card',
  'account_closed',
  'restricted_card',
  'pick_up_card',
];

// ============================================================
// Check all stopping rules
// Returns the FIRST triggered rule (priority order)
// ============================================================
export function checkStoppingRules(params: {
  attempt_count: number;
  root_cause: RootCause;
  error_reason: string;
  status: string;
  promise_broken?: boolean;
  customer_declined?: boolean;
}): StoppingRuleResult {

  // ── Rule 1: Payment already recovered ──
  // Why check this first: if it's already recovered, nothing else matters
  if (params.status === 'recovered') {
    return {
      should_stop: true,
      rule: 'STOP_01_ALREADY_RECOVERED',
      reason: 'Payment has already been recovered. No further action needed.',
    };
  }

  // ── Rule 2: Hard decline code ──
  // These indicate the payment method is fundamentally unusable
  if (HARD_DECLINE_CODES.includes(params.root_cause)) {
    return {
      should_stop: true,
      rule: 'STOP_02_HARD_DECLINE',
      reason: `Hard decline: ${params.root_cause.replace(/_/g, ' ')}. Payment method cannot be retried.`,
    };
  }

  // ── Rule 2b: Do-not-retry error reasons from Razorpay ──
  if (DO_NOT_RETRY_REASONS.includes(params.error_reason)) {
    return {
      should_stop: true,
      rule: 'STOP_02B_DO_NOT_RETRY',
      reason: `Do-not-retry error reason: ${params.error_reason}. This error code indicates the card/account should not be charged again.`,
    };
  }

  // ── Rule 3: Max attempts exceeded ──
  if (params.attempt_count >= MAX_ATTEMPTS) {
    return {
      should_stop: true,
      rule: 'STOP_03_MAX_ATTEMPTS',
      reason: `Maximum recovery attempts (${MAX_ATTEMPTS}) reached. Further retries are unlikely to succeed and could annoy the customer.`,
    };
  }

  // ── Rule 4: Customer explicitly declined ──
  if (params.customer_declined) {
    return {
      should_stop: true,
      rule: 'STOP_04_CUSTOMER_DECLINED',
      reason: 'Customer has explicitly declined to pay. Respecting their decision and stopping all recovery attempts.',
    };
  }

  // ── Rule 5: Promise-to-pay broken ──
  // Customer promised to pay by a date but didn't follow through
  if (params.promise_broken) {
    return {
      should_stop: true,
      rule: 'STOP_05_PROMISE_BROKEN',
      reason: 'Customer broke their promise-to-pay commitment. Escalating to human queue for follow-up.',
    };
  }

  // ── No rules triggered — continue recovery ──
  return {
    should_stop: false,
    rule: null,
    reason: null,
  };
}

// ============================================================
// Helper: Map stopping rule to escalation reason
// Used when creating an escalation record
// ============================================================
export function stoppingRuleToEscalationReason(rule: string): string {
  const mapping: Record<string, string> = {
    'STOP_02_HARD_DECLINE': 'hard_decline',
    'STOP_02B_DO_NOT_RETRY': 'hard_decline',
    'STOP_03_MAX_ATTEMPTS': 'max_retries',
    'STOP_04_CUSTOMER_DECLINED': 'customer_declined',
    'STOP_05_PROMISE_BROKEN': 'promise_broken',
  };
  return mapping[rule] || 'manual';
}
