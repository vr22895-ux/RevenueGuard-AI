// ============================================================
// RevenueGuard AI — Recovery Agent Orchestrator
// ============================================================
// This is the MAIN PIPELINE — the heart of the system.
// It orchestrates: classify → decide → execute → audit → stop-check
//
// THE LOOP:
//   1. Pick an unprocessed payment from the batch
//   2. Classify root cause (Gemini AI)
//   3. Run decision engine (deterministic rules)
//   4. Execute the action (retry/message/payment-link/promise/escalate)
//   5. Log everything to audit trail (write-ahead)
//   6. Check stopping rules
//   7. Update payment status
//   8. Repeat for next payment
// ============================================================

import { getSupabaseAdmin } from './supabase';
import { classifyPaymentFailure, draftRecoveryMessage } from './gemini';
import { makeDecision } from './decision-engine';
import { checkStoppingRules, stoppingRuleToEscalationReason } from './stopping-rules';
import { createPaymentLink, simulatePaymentOutcome } from './razorpay';
import {
  logPaymentIngested,
  logClassified,
  logDecisionMade,
  logActionPlanned,
  logActionExecuted,
  logPaymentLinkCreated,
  logRecovered,
  logStoppingRuleTriggered,
  logEscalated,
  logPromiseCreated,
} from './audit';
import type { RootCause, Transaction } from './types';

export interface BatchResult {
  batch_id: string;
  total_records: number;
  processed: number;
  recovered_count: number;
  recovered_amount: number;
  failed_count: number;
  escalated_count: number;
  stopped_count: number;
  recovery_rate: number;
  total_at_risk: number;
  auto_retry_count: number;
  message_count: number;
  promise_count: number;
  payment_link_count: number;
}

// Process a single payment through the full pipeline
async function processPayment(
  transaction: Transaction
): Promise<{
  recovered: boolean;
  escalated: boolean;
  action_type: string;
}> {
  const supabase = getSupabaseAdmin();

  // ── STEP 0: Log ingestion ──
  await logPaymentIngested(transaction.id, {
    payment_id: transaction.payment_id,
    amount: transaction.amount,
    method: transaction.method,
    error_reason: transaction.error_reason,
  });

  // ── STEP 1: Check stopping rules FIRST ──
  // (In case this payment already hit a stopping condition)
  const preCheck = checkStoppingRules({
    attempt_count: transaction.attempt_count,
    root_cause: transaction.error_reason as RootCause,
    error_reason: transaction.error_reason,
    status: transaction.status,
  });

  if (preCheck.should_stop) {
    await logStoppingRuleTriggered(transaction.id, {
      rule: preCheck.rule,
      reason: preCheck.reason,
    });

    // Create escalation
    await supabase.from('escalations').insert({
      transaction_id: transaction.id,
      reason: stoppingRuleToEscalationReason(preCheck.rule!),
      details: preCheck.reason!,
      status: 'pending',
    });

    await logEscalated(transaction.id, {
      reason: preCheck.reason,
      rule: preCheck.rule,
    });

    await supabase
      .from('transactions')
      .update({ status: 'escalated' })
      .eq('id', transaction.id);

    return { recovered: false, escalated: true, action_type: 'stop' };
  }

  // ── STEP 2: Classify with Gemini AI ──
  let classification;
  try {
    classification = await classifyPaymentFailure({
      error_code: transaction.error_code,
      error_description: transaction.error_description,
      error_reason: transaction.error_reason,
      amount: transaction.amount,
      method: transaction.method,
      card_network: transaction.card_network,
      card_issuer: transaction.card_issuer,
      is_recurring: transaction.is_recurring,
      attempt_count: transaction.attempt_count,
    });
  } catch (err) {
    // If AI fails, escalate to human
    console.error(`[Agent] Classification failed for ${transaction.id}:`, err);
    await supabase.from('escalations').insert({
      transaction_id: transaction.id,
      reason: 'manual',
      details: `AI classification failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      status: 'pending',
    });
    await supabase
      .from('transactions')
      .update({ status: 'escalated' })
      .eq('id', transaction.id);
    return { recovered: false, escalated: true, action_type: 'escalate_human' };
  }

  // Insert classification record
  const { data: classRecord } = await supabase
    .from('classifications')
    .insert({
      transaction_id: transaction.id,
      root_cause: classification.root_cause,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
      retriable: classification.retriable,
      model_used: 'gemini-2.0-flash',
      attempt_number: transaction.attempt_count + 1,
    })
    .select('id')
    .single();

  const classificationId = classRecord!.id;

  await supabase
    .from('transactions')
    .update({ status: 'classified' })
    .eq('id', transaction.id);

  await logClassified(transaction.id, classificationId, {
    root_cause: classification.root_cause,
    confidence: classification.confidence,
    reasoning: classification.reasoning,
    retriable: classification.retriable,
  });

  // ── STEP 3: Decision Engine (DETERMINISTIC) ──
  const decision = makeDecision({
    root_cause: classification.root_cause as RootCause,
    confidence: classification.confidence,
    retriable: classification.retriable,
    amount: transaction.amount,
    attempt_count: transaction.attempt_count,
    is_recurring: transaction.is_recurring,
  });

  // Insert decision record
  const { data: decisionRecord } = await supabase
    .from('decisions')
    .insert({
      transaction_id: transaction.id,
      classification_id: classificationId,
      action_type: decision.action_type,
      rule_matched: decision.rule_matched,
      rule_inputs: decision.rule_inputs,
      decision_reason: decision.decision_reason,
      attempt_number: transaction.attempt_count + 1,
    })
    .select('id')
    .single();

  const decisionId = decisionRecord!.id;

  await supabase
    .from('transactions')
    .update({ status: 'action_planned' })
    .eq('id', transaction.id);

  await logDecisionMade(transaction.id, classificationId, decisionId, {
    action_type: decision.action_type,
    rule_matched: decision.rule_matched,
    decision_reason: decision.decision_reason,
    rule_inputs: decision.rule_inputs,
  });

  // ── STEP 4: Execute Action ──
  // Handle stop/escalate decisions
  if (decision.action_type === 'stop' || decision.action_type === 'escalate_human') {
    await supabase.from('escalations').insert({
      transaction_id: transaction.id,
      reason: decision.action_type === 'stop' ? 'hard_decline' : 
              decision.rule_matched.includes('LOW_CONFIDENCE') ? 'low_confidence' :
              decision.rule_matched.includes('HIGH') ? 'high_value' : 'max_retries',
      details: decision.decision_reason,
      status: 'pending',
    });

    const { data: actionRecord } = await supabase
      .from('actions')
      .insert({
        transaction_id: transaction.id,
        decision_id: decisionId,
        action_type: decision.action_type,
        action_details: { rule: decision.rule_matched },
        status: 'executed',
        executed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    await logEscalated(transaction.id, {
      reason: decision.decision_reason,
      rule: decision.rule_matched,
      action_id: actionRecord!.id,
    });

    await supabase
      .from('transactions')
      .update({ status: 'escalated' })
      .eq('id', transaction.id);

    return { recovered: false, escalated: true, action_type: decision.action_type };
  }

  // ── Execute recovery actions ──
  let actionDetails: Record<string, unknown> = {};
  let aiMessage: string | null = null;
  let razorpayRef: string | null = null;
  let razorpayResponse: Record<string, unknown> | null = null;
  let actionStatus = 'executed';

  // Draft AI message if needed
  if (['recovery_message', 'payment_link', 'promise_to_pay'].includes(decision.action_type)) {
    try {
      aiMessage = await draftRecoveryMessage({
        customer_name: transaction.customer_name,
        amount: transaction.amount,
        root_cause: classification.root_cause,
        attempt_number: transaction.attempt_count + 1,
        method: transaction.method,
        is_recurring: transaction.is_recurring,
      });
    } catch (err) {
      console.error(`[Agent] Message drafting failed:`, err);
      aiMessage = `Dear ${transaction.customer_name}, your payment of ₹${(transaction.amount / 100).toFixed(2)} could not be processed. Please use the payment link below to complete your payment.`;
    }
  }

  // Create payment link if needed
  if (['payment_link', 'recovery_message'].includes(decision.action_type)) {
    try {
      const linkResult = await createPaymentLink({
        amount: transaction.amount,
        customer_name: transaction.customer_name,
        customer_email: transaction.customer_email,
        customer_phone: transaction.customer_phone || undefined,
        description: `Recovery payment for order ${transaction.order_id}`,
        reference_id: transaction.id,
      });

      if (linkResult.success) {
        razorpayRef = linkResult.payment_link_id || null;
        razorpayResponse = linkResult.raw_response || null;
        actionDetails = {
          ...actionDetails,
          payment_link_url: linkResult.short_url,
          payment_link_id: linkResult.payment_link_id,
        };
      } else {
        actionDetails = { ...actionDetails, payment_link_error: linkResult.error };
      }
    } catch (err) {
      console.error(`[Agent] Payment link creation failed:`, err);
      actionDetails = {
        ...actionDetails,
        payment_link_error: err instanceof Error ? err.message : 'unknown',
      };
    }
  }

  // ── LOG PLANNED ACTION (write-ahead) ──
  const { data: actionRecord } = await supabase
    .from('actions')
    .insert({
      transaction_id: transaction.id,
      decision_id: decisionId,
      action_type: decision.action_type,
      action_details: actionDetails,
      razorpay_ref: razorpayRef,
      razorpay_response: razorpayResponse,
      ai_message: aiMessage,
      status: 'pending',
    })
    .select('id')
    .single();

  const actionId = actionRecord!.id;

  await logActionPlanned(transaction.id, decisionId, actionId, {
    action_type: decision.action_type,
    has_payment_link: !!razorpayRef,
    has_message: !!aiMessage,
  });

  if (razorpayRef) {
    await logPaymentLinkCreated(transaction.id, actionId, {
      short_url: actionDetails.payment_link_url,
      payment_link_id: razorpayRef,
    });
  }

  // ── Simulate payment outcome ──
  const outcome = simulatePaymentOutcome(
    classification.root_cause,
    transaction.attempt_count + 1,
    transaction.amount
  );

  if (outcome.recovered) {
    actionStatus = 'success';
    await supabase
      .from('actions')
      .update({ status: 'success', executed_at: new Date().toISOString() })
      .eq('id', actionId);

    await logActionExecuted(transaction.id, actionId, {
      action_type: decision.action_type,
      status: 'success',
      outcome: outcome.reason,
    });

    await logRecovered(transaction.id, {
      amount: transaction.amount,
      action_type: decision.action_type,
      attempt_number: transaction.attempt_count + 1,
    });

    await supabase
      .from('transactions')
      .update({
        status: 'recovered',
        attempt_count: transaction.attempt_count + 1,
      })
      .eq('id', transaction.id);

    return { recovered: true, escalated: false, action_type: decision.action_type };
  }

  // Not recovered — update attempt count
  actionStatus = 'failed';
  await supabase
    .from('actions')
    .update({ status: 'failed', executed_at: new Date().toISOString() })
    .eq('id', actionId);

  await logActionExecuted(transaction.id, actionId, {
    action_type: decision.action_type,
    status: 'failed',
    outcome: outcome.reason,
  });

  const newAttemptCount = transaction.attempt_count + 1;

  // Create promise-to-pay if that was the action
  if (decision.action_type === 'promise_to_pay') {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7); // Due in 7 days

    await supabase.from('promises_to_pay').insert({
      transaction_id: transaction.id,
      action_id: actionId,
      customer_id: transaction.customer_id,
      promised_amount: transaction.amount,
      promised_date: dueDate.toISOString().split('T')[0],
      status: 'active',
    });

    await logPromiseCreated(transaction.id, actionId, {
      amount: transaction.amount,
      due_date: dueDate.toISOString().split('T')[0],
    });
  }

  // Post-action stopping rule check
  const postCheck = checkStoppingRules({
    attempt_count: newAttemptCount,
    root_cause: classification.root_cause as RootCause,
    error_reason: transaction.error_reason,
    status: 'recovering',
  });

  if (postCheck.should_stop) {
    await logStoppingRuleTriggered(transaction.id, {
      rule: postCheck.rule,
      reason: postCheck.reason,
    });

    await supabase.from('escalations').insert({
      transaction_id: transaction.id,
      reason: stoppingRuleToEscalationReason(postCheck.rule!),
      details: postCheck.reason!,
      status: 'pending',
    });

    await logEscalated(transaction.id, {
      reason: postCheck.reason,
      rule: postCheck.rule,
    });

    await supabase
      .from('transactions')
      .update({ status: 'escalated', attempt_count: newAttemptCount })
      .eq('id', transaction.id);

    return { recovered: false, escalated: true, action_type: decision.action_type };
  }

  // Still in recovery — update status for next loop iteration
  await supabase
    .from('transactions')
    .update({ status: 'recovering', attempt_count: newAttemptCount })
    .eq('id', transaction.id);

  return { recovered: false, escalated: false, action_type: decision.action_type };
}

// ============================================================
// Run batch processing on all unprocessed payments
// ============================================================
export async function runBatch(batchId?: string): Promise<BatchResult> {
  const supabase = getSupabaseAdmin();

  // Find the batch to process
  let targetBatchId = batchId;
  if (!targetBatchId) {
    const { data: latestBatch } = await supabase
      .from('batch_runs')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!latestBatch) throw new Error('No batch found. Run /api/seed first.');
    targetBatchId = latestBatch.id;
  }

  // Update batch status
  await supabase
    .from('batch_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', targetBatchId);

  // Fetch all unprocessed + recovering transactions in this batch
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('batch_id', targetBatchId)
    .in('status', ['unprocessed', 'recovering'])
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);
  if (!transactions || transactions.length === 0) {
    throw new Error('No unprocessed transactions found in this batch.');
  }

  // Counters
  let processed = 0;
  let recoveredCount = 0;
  let recoveredAmount = 0;
  let failedCount = 0;
  let escalatedCount = 0;
  let stoppedCount = 0;
  let autoRetryCount = 0;
  let messageCount = 0;
  let promiseCount = 0;
  let paymentLinkCount = 0;
  let totalAtRisk = 0;

  // Calculate total at risk
  for (const tx of transactions) {
    totalAtRisk += tx.amount;
  }

  // Process each payment (sequentially to avoid rate limits)
  for (const tx of transactions) {
    try {
      const result = await processPayment(tx as Transaction);
      processed++;

      if (result.recovered) {
        recoveredCount++;
        recoveredAmount += tx.amount;
      } else if (result.escalated) {
        escalatedCount++;
      } else {
        failedCount++;
      }

      // Track action types
      switch (result.action_type) {
        case 'auto_retry':
          autoRetryCount++;
          break;
        case 'recovery_message':
          messageCount++;
          break;
        case 'promise_to_pay':
          promiseCount++;
          break;
        case 'payment_link':
          paymentLinkCount++;
          break;
      }

      // Update batch progress every 10 records
      if (processed % 10 === 0) {
        await supabase
          .from('batch_runs')
          .update({
            processed,
            recovered_count: recoveredCount,
            recovered_amount: recoveredAmount,
            failed_count: failedCount,
            escalated_count: escalatedCount,
            stopped_count: stoppedCount,
            recovery_rate: processed > 0 ? recoveredCount / processed : 0,
          })
          .eq('id', targetBatchId);
      }
    } catch (err) {
      console.error(`[Agent] Error processing ${tx.id}:`, err);
      failedCount++;
      processed++;
    }
    
    // Sleep for 2 seconds to avoid hitting Gemini free tier rate limits (15 RPM)
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Final batch update
  const recoveryRate = processed > 0 ? recoveredCount / processed : 0;

  await supabase
    .from('batch_runs')
    .update({
      processed,
      recovered_count: recoveredCount,
      recovered_amount: recoveredAmount,
      failed_count: failedCount,
      escalated_count: escalatedCount,
      stopped_count: stoppedCount,
      recovery_rate: recoveryRate,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', targetBatchId);

  return {
    batch_id: targetBatchId!,
    total_records: transactions.length,
    processed,
    recovered_count: recoveredCount,
    recovered_amount: recoveredAmount,
    failed_count: failedCount,
    escalated_count: escalatedCount,
    stopped_count: stoppedCount,
    recovery_rate: recoveryRate,
    total_at_risk: totalAtRisk,
    auto_retry_count: autoRetryCount,
    message_count: messageCount,
    promise_count: promiseCount,
    payment_link_count: paymentLinkCount,
  };
}
