// ============================================================
// RevenueGuard AI — Decision Engine (DETERMINISTIC)
// ============================================================
// This is the core of the system — and it is 100% deterministic.
// No AI, no LLM, no probabilistic outputs. Just rules.
//
// WHY DETERMINISTIC:
//   Financial actions must be bounded, explainable, and auditable.
//   When a panelist asks "what stops your AI from retrying a stolen
//   card 50 times?" the answer is: "this file. Line by line, rule
//   by rule. The AI classifies; this engine decides."
//
// HOW IT WORKS:
//   Input: { root_cause, amount_band, attempt_count, confidence }
//   Output: { action_type, rule_matched, decision_reason }
//
//   The function is a pure function — same input always produces
//   the same output. No side effects, no external calls.
//
// RULE NAMING CONVENTION:
//   RULE_{number}_{root_cause}_{variant}
//   e.g., RULE_02_INSUF_SMALL_RETRY
//   This makes rules identifiable in the audit log.
// ============================================================

import { type RootCause, type ActionType, type AmountBand, getAmountBand } from './types';

// ============================================================
// Decision Output Type
// ============================================================
export interface DecisionResult {
  action_type: ActionType;
  rule_matched: string;
  rule_inputs: {
    root_cause: RootCause;
    amount_band: AmountBand;
    attempt_count: number;
    confidence: number;
  };
  decision_reason: string;
}

// ============================================================
// Input to the decision engine
// ============================================================
export interface DecisionInput {
  root_cause: RootCause;
  confidence: number;
  retriable: boolean;
  amount: number; // paise
  attempt_count: number;
  is_recurring: boolean;
}

// ============================================================
// Hard decline codes — NEVER retry these
// These represent situations where retrying would be wrong:
// - Stolen card: retrying could be fraud
// - Mandate revoked: customer explicitly cancelled
// ============================================================
const HARD_DECLINE_CAUSES: RootCause[] = [
  'mandate_revoked',
];

// ============================================================
// Maximum retry attempts — the global stopping cap
// ============================================================
const MAX_ATTEMPTS = 3;

// ============================================================
// THE DECISION ENGINE
// ============================================================
export function makeDecision(input: DecisionInput): DecisionResult {
  const amountBand = getAmountBand(input.amount);

  const ruleInputs = {
    root_cause: input.root_cause,
    amount_band: amountBand,
    attempt_count: input.attempt_count,
    confidence: input.confidence,
  };

  // ──────────────────────────────────────────────────────
  // RULE 00: HARD DECLINE — always first, always checked
  // ──────────────────────────────────────────────────────
  // RULE 00: HARD DECLINE — always first, always checked
  // ──────────────────────────────────────────────────────
  if (HARD_DECLINE_CAUSES.includes(input.root_cause)) {
    return {
      action_type: 'stop',
      rule_matched: 'RULE_00_HARD_DECLINE',
      rule_inputs: ruleInputs,
      decision_reason: `Hard decline: ${input.root_cause.replace(/_/g, ' ')}. Do not retry: escalating to human queue.`,
    };
  }

  // ──────────────────────────────────────────────────────
  // RULE 99: LOW CONFIDENCE FALLBACK — AI is unsure
  // If the AI's classification confidence is below 0.5,
  // we don't trust it enough for autonomous action.
  // ──────────────────────────────────────────────────────
  if (input.confidence < 0.5) {
    return {
      action_type: 'escalate_human',
      rule_matched: 'RULE_99_LOW_CONFIDENCE',
      rule_inputs: ruleInputs,
      decision_reason: `AI classification confidence is ${(input.confidence * 100).toFixed(1)}% (below 50% threshold). Escalating to human for manual review.`,
    };
  }

  // ──────────────────────────────────────────────────────
  // RULE: MAX ATTEMPTS EXCEEDED — global stopping rule
  // ──────────────────────────────────────────────────────
  if (input.attempt_count >= MAX_ATTEMPTS) {
    return {
      action_type: 'stop',
      rule_matched: 'RULE_STOP_MAX_ATTEMPTS',
      rule_inputs: ruleInputs,
      decision_reason: `Maximum retry attempts (${MAX_ATTEMPTS}) exceeded. Stopping recovery and escalating.`,
    };
  }

  // ──────────────────────────────────────────────────────
  // Now route by root cause
  // ──────────────────────────────────────────────────────

  switch (input.root_cause) {
    // ── TRANSIENT ERRORS: bank_error, network_error, upi_timeout ──
    case 'bank_error':
    case 'network_error':
    case 'upi_timeout':
      return {
        action_type: 'auto_retry',
        rule_matched: `RULE_01_TRANSIENT_RETRY`,
        rule_inputs: ruleInputs,
        decision_reason: `Transient error (${input.root_cause.replace(/_/g, ' ')}). Auto-retrying (attempt ${input.attempt_count + 1} of ${MAX_ATTEMPTS}). These errors are typically resolved by the issuing bank within minutes.`,
      };

    // ── INSUFFICIENT FUNDS ──
    case 'insufficient_funds':
      if (amountBand === 'micro' || amountBand === 'small') {
        if (input.attempt_count < 2) {
          return {
            action_type: 'auto_retry',
            rule_matched: 'RULE_02_INSUF_SMALL_RETRY',
            rule_inputs: ruleInputs,
            decision_reason: `Insufficient funds for ${amountBand} amount (₹${(input.amount / 100).toFixed(2)}). Auto-retrying with delay: customer may have funds available after payday cycle.`,
          };
        }
        return {
          action_type: 'payment_link',
          rule_matched: 'RULE_02_INSUF_SMALL_LINK',
          rule_inputs: ruleInputs,
          decision_reason: `Insufficient funds for ${amountBand} amount after ${input.attempt_count} attempts. Sending payment link for customer-initiated retry.`,
        };
      }
      if (amountBand === 'medium' || amountBand === 'large') {
        return {
          action_type: 'promise_to_pay',
          rule_matched: 'RULE_03_INSUF_MEDIUM_PTP',
          rule_inputs: ruleInputs,
          decision_reason: `Insufficient funds for ${amountBand} amount (₹${(input.amount / 100).toFixed(2)}). Creating promise-to-pay with recovery message: higher amounts benefit from structured commitment.`,
        };
      }
      // high_value
      return {
        action_type: 'escalate_human',
        rule_matched: 'RULE_03_INSUF_HIGH_ESCALATE',
        rule_inputs: ruleInputs,
        decision_reason: `Insufficient funds for high-value amount (₹${(input.amount / 100).toFixed(2)}). Escalating to human: amounts above ₹50,000 require manual review.`,
      };

    // ── EXPIRED CARD ──
    case 'card_expired':
      if (input.attempt_count >= 1) {
        return {
          action_type: 'stop',
          rule_matched: 'RULE_04_EXPIRED_CARD_STOP',
          rule_inputs: ruleInputs,
          decision_reason: `Card expired: customer has already been notified. Escalating to human queue to prevent duplicate notifications.`,
        };
      }
      return {
        action_type: 'recovery_message',
        rule_matched: 'RULE_04_EXPIRED_CARD',
        rule_inputs: ruleInputs,
        decision_reason: `Card expired: cannot retry with same card. Sending recovery message asking customer to update payment method with a fresh payment link.`,
      };

    // ── CARD DECLINED (GENERIC) ──
    case 'card_declined':
      if (input.confidence >= 0.7 && (amountBand === 'micro' || amountBand === 'small') && input.attempt_count < 2) {
        return {
          action_type: 'auto_retry',
          rule_matched: 'RULE_05_DECLINED_RETRY',
          rule_inputs: ruleInputs,
          decision_reason: `Card declined for ${amountBand} amount with high classification confidence (${(input.confidence * 100).toFixed(1)}%). Auto-retrying: generic declines are sometimes transient.`,
        };
      }
      if (amountBand === 'high_value') {
        return {
          action_type: 'escalate_human',
          rule_matched: 'RULE_05_DECLINED_ESCALATE',
          rule_inputs: ruleInputs,
          decision_reason: `Card declined for high-value amount (₹${(input.amount / 100).toFixed(2)}). Escalating to human: high-value declines need careful handling.`,
        };
      }
      return {
        action_type: 'recovery_message',
        rule_matched: 'RULE_05_DECLINED_MESSAGE',
        rule_inputs: ruleInputs,
        decision_reason: `Card declined for ${amountBand} amount. Sending recovery message with payment link: customer may need to use a different card.`,
      };

    // ── AUTHENTICATION FAILED (3DS) ──
    case 'authentication_failed':
      if (input.attempt_count < 2) {
        return {
          action_type: 'payment_link',
          rule_matched: 'RULE_06_AUTH_LINK',
          rule_inputs: ruleInputs,
          decision_reason: `3DS authentication failed. Sending fresh payment link for a new checkout attempt: customer may have accidentally cancelled or the OTP expired.`,
        };
      }
      return {
        action_type: 'recovery_message',
        rule_matched: 'RULE_06_AUTH_MESSAGE',
        rule_inputs: ruleInputs,
        decision_reason: `3DS authentication failed ${input.attempt_count} times. Sending recovery message with guidance on completing authentication.`,
      };

    // ── INTERNATIONAL CARD BLOCKED ──
    case 'international_blocked':
      return {
        action_type: 'recovery_message',
        rule_matched: 'RULE_07_INTL_BLOCKED',
        rule_inputs: ruleInputs,
        decision_reason: `International card blocked by issuing bank. Sending recovery message suggesting domestic card or alternative payment method.`,
      };

    // ── MANDATE REVOKED — should be caught by HARD_DECLINE above,
    //    but included for completeness ──
    case 'mandate_revoked':
      return {
        action_type: 'stop',
        rule_matched: 'RULE_00_HARD_DECLINE',
        rule_inputs: ruleInputs,
        decision_reason: `Mandate revoked by customer. Cannot retry: escalating to human queue.`,
      };

    // ── DEFAULT: Unknown root cause ──
    default:
      return {
        action_type: 'escalate_human',
        rule_matched: 'RULE_99_UNKNOWN',
        rule_inputs: ruleInputs,
        decision_reason: `Unknown root cause: ${input.root_cause}. Escalating to human for manual review.`,
      };
  }
}
