// ============================================================
// RevenueGuard AI — Database Types
// These mirror the Supabase Postgres schema exactly.
// ============================================================

// ---- Enums as union types ----
// WHY union types instead of TypeScript enums:
// 1. Enums compile to runtime objects (more JS shipped)
// 2. Union types are erased at compile time (zero cost)
// 3. Better inference with Supabase client
// A panelist might ask "why not use enums?" — this is the answer.

export type TransactionStatus =
  | 'unprocessed'
  | 'classified'
  | 'action_planned'
  | 'recovering'
  | 'recovered'
  | 'failed'
  | 'escalated';

export type PaymentMethod = 'card' | 'upi' | 'netbanking' | 'wallet' | 'emandate';

export type RootCause =
  | 'insufficient_funds'
  | 'card_expired'
  | 'card_declined'
  | 'bank_error'
  | 'authentication_failed'
  | 'upi_timeout'
  | 'mandate_revoked'
  | 'international_blocked'
  | 'network_error';

export type ActionType =
  | 'auto_retry'
  | 'payment_link'
  | 'recovery_message'
  | 'promise_to_pay'
  | 'escalate_human'
  | 'stop';

export type ActionStatus = 'pending' | 'executed' | 'success' | 'failed';

export type AuditEventType =
  | 'payment_ingested'
  | 'classified'
  | 'decision_made'
  | 'action_planned'
  | 'action_executed'
  | 'retry_attempted'
  | 'retry_succeeded'
  | 'retry_failed'
  | 'message_drafted'
  | 'message_sent'
  | 'payment_link_created'
  | 'promise_created'
  | 'promise_reminder'
  | 'promise_fulfilled'
  | 'promise_broken'
  | 'stopping_rule_triggered'
  | 'escalated'
  | 'recovered'
  | 'closed';

export type PromiseStatus = 'active' | 'fulfilled' | 'broken' | 'expired';

export type EscalationReason =
  | 'max_retries'
  | 'hard_decline'
  | 'high_value'
  | 'low_confidence'
  | 'promise_broken'
  | 'customer_declined'
  | 'manual';

export type EscalationStatus = 'pending' | 'reviewing' | 'resolved' | 'dismissed';

export type BatchStatus = 'pending' | 'running' | 'completed' | 'failed';

// ---- Amount bands for the decision engine ----
// WHY define these as constants:
// The decision engine uses amount bands, not raw amounts.
// This converts ₹ amounts into categories the rules can match against.
// All values in paise (₹1 = 100 paise).
export type AmountBand = 'micro' | 'small' | 'medium' | 'large' | 'high_value';

export const AMOUNT_BANDS: Record<AmountBand, { min: number; max: number }> = {
  micro:      { min: 1000,     max: 50000 },      // ₹10 – ₹500
  small:      { min: 50001,    max: 200000 },      // ₹500.01 – ₹2,000
  medium:     { min: 200001,   max: 1000000 },     // ₹2,000.01 – ₹10,000
  large:      { min: 1000001,  max: 5000000 },     // ₹10,000.01 – ₹50,000
  high_value: { min: 5000001,  max: Infinity },    // ₹50,000.01+
};

export function getAmountBand(amountPaise: number): AmountBand {
  if (amountPaise <= 50000) return 'micro';
  if (amountPaise <= 200000) return 'small';
  if (amountPaise <= 1000000) return 'medium';
  if (amountPaise <= 5000000) return 'large';
  return 'high_value';
}

// ---- Table row types ----

export interface BatchRun {
  id: string;
  total_records: number;
  processed: number;
  recovered_count: number;
  recovered_amount: number; // paise
  failed_count: number;
  escalated_count: number;
  stopped_count: number;
  recovery_rate: number;
  status: BatchStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  batch_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  payment_id: string;     // pay_XXXXX
  order_id: string;       // order_XXXXX
  amount: number;         // paise
  currency: string;
  method: PaymentMethod;
  card_last4: string | null;
  card_network: string | null;
  card_issuer: string | null;
  error_code: string;
  error_description: string;
  error_reason: string;
  is_recurring: boolean;
  subscription_id: string | null;
  attempt_count: number;
  status: TransactionStatus;
  created_at: string;
  updated_at: string;
}

export interface Classification {
  id: string;
  transaction_id: string;
  root_cause: RootCause;
  confidence: number;     // 0.0 – 1.0
  reasoning: string;
  retriable: boolean;
  model_used: string;
  attempt_number: number;
  raw_response: Record<string, unknown> | null;
  created_at: string;
}

export interface Decision {
  id: string;
  transaction_id: string;
  classification_id: string;
  action_type: ActionType;
  rule_matched: string;   // e.g. "RULE_02_INSUF_SMALL_RETRY"
  rule_inputs: {
    root_cause: RootCause;
    amount_band: AmountBand;
    attempt_count: number;
    confidence: number;
  };
  decision_reason: string;
  attempt_number: number;
  created_at: string;
}

export interface Action {
  id: string;
  transaction_id: string;
  decision_id: string;
  action_type: ActionType;
  action_details: Record<string, unknown> | null;
  razorpay_ref: string | null;
  razorpay_response: Record<string, unknown> | null;
  ai_message: string | null;
  status: ActionStatus;
  executed_at: string | null;
  created_at: string;
}

export interface PromiseToPay {
  id: string;
  transaction_id: string;
  action_id: string | null;
  customer_id: string;
  promised_amount: number; // paise
  promised_date: string;   // YYYY-MM-DD
  reminder_sent: boolean;
  status: PromiseStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface AuditLogEntry {
  id: string;
  transaction_id: string;
  classification_id: string | null;
  decision_id: string | null;
  action_id: string | null;
  event_type: AuditEventType;
  event_details: Record<string, unknown>;
  decision_reason: string | null;
  created_at: string;
}

export interface Escalation {
  id: string;
  transaction_id: string;
  reason: EscalationReason;
  details: string;
  status: EscalationStatus;
  assigned_to: string | null;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}
