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
  let isActionFailed = false;
  let actionFailureReason = '';

  const requiresLink = ['payment_link', 'recovery_message'].includes(decision.action_type);

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
        has_payment_link: requiresLink,
      });
    } catch (err) {
      console.error(`[Agent] Message drafting failed:`, err);
      aiMessage = `Dear ${transaction.customer_name}, your payment of ₹${(transaction.amount / 100).toFixed(2)} could not be processed. Please complete your payment at [Payment Link].`;
    }
  }

  // Create payment link if needed
  if (requiresLink) {
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
        isActionFailed = true;
        actionFailureReason = linkResult.error || 'Payment link creation failed';
      }
    } catch (err) {
      console.error(`[Agent] Payment link creation failed:`, err);
      const errMsg = err instanceof Error ? err.message : 'unknown';
      actionDetails = {
        ...actionDetails,
        payment_link_error: errMsg,
      };
      isActionFailed = true;
      actionFailureReason = errMsg;
    }
  }

  // Inject actual payment link URL into AI drafted message body or strip placeholders if no link exists
  if (aiMessage) {
    const linkUrl = actionDetails.payment_link_url as string | undefined;
    const linkRegex = /\[(?:Payment Link|Link|Insert Payment Link Here|Link:.*?)\]/gi;

    if (linkUrl) {
      if (linkRegex.test(aiMessage)) {
        aiMessage = aiMessage.replace(linkRegex, linkUrl);
      } else if (!aiMessage.includes(linkUrl)) {
        aiMessage += `\n\nPayment Link: ${linkUrl}`;
      }
    } else {
      // No payment link created for this action type (e.g. promise_to_pay) — strip leftover link placeholders
      aiMessage = aiMessage
        .replace(linkRegex, '')
        .replace(/please use the payment link below to .*?:/gi, 'please confirm your payment details:')
        .replace(/click the payment link below to .*?:/gi, 'please confirm your payment details:')
        .trim();
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

  // Handle action failure gracefully before simulation
  if (isActionFailed) {
    actionStatus = 'failed';
    await supabase
      .from('actions')
      .update({ status: 'failed', executed_at: new Date().toISOString(), action_details: actionDetails })
      .eq('id', actionId);

    await logActionExecuted(transaction.id, actionId, {
      action_type: decision.action_type,
      status: 'failed',
      outcome: `Action failed: ${actionFailureReason}`,
    });

    await logEscalated(transaction.id, {
      reason: `Action execution failed: ${actionFailureReason}`,
      rule: 'SYSTEM_ERROR',
      action_id: actionId,
    });

    await supabase.from('escalations').insert({
      transaction_id: transaction.id,
      reason: 'system_error',
      details: `Action execution failed: ${actionFailureReason}`,
      status: 'pending',
    });

    await supabase
      .from('transactions')
      .update({ status: 'escalated', attempt_count: transaction.attempt_count + 1 })
      .eq('id', transaction.id);

    return { recovered: false, escalated: true, action_type: decision.action_type };
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

  // Action executed cleanly (message sent / payment link created)
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

  // Fetch ALL transactions in this batch to get accurate total records & total at risk
  const { data: allTransactions, error: fetchError } = await supabase
    .from('transactions')
    .select('*')
    .eq('batch_id', targetBatchId)
    .order('created_at', { ascending: true });

  if (fetchError) throw new Error(`Failed to fetch transactions: ${fetchError.message}`);
  if (!allTransactions || allTransactions.length === 0) {
    throw new Error('No transactions found in this batch.');
  }

  // Filter transactions that need processing in this run (unprocessed or recovering)
  const transactionsToProcess = allTransactions.filter((tx) =>
    ['unprocessed', 'recovering'].includes(tx.status)
  );

  if (transactionsToProcess.length === 0) {
    throw new Error('All transactions in this batch are already fully processed.');
  }

  // Action counters for this run
  let autoRetryCount = 0;
  let messageCount = 0;
  let promiseCount = 0;
  let paymentLinkCount = 0;

  // Process each payment (sequentially to avoid rate limits)
  for (const tx of transactionsToProcess) {
    try {
      const result = await processPayment(tx as Transaction);

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
    } catch (err) {
      console.error(`[Agent] Error processing ${tx.id}:`, err);
    }

    // Sleep for 2 seconds to avoid hitting Gemini free tier rate limits (15 RPM)
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Calculate CUMULATIVE stats across ALL transactions in the batch
  const { data: updatedTxData } = await supabase
    .from('transactions')
    .select(`
      id,
      amount,
      status,
      actions ( action_type )
    `)
    .eq('batch_id', targetBatchId);

  const txList = updatedTxData || [];
  const totalRecords = txList.length;
  const cumulativeProcessed = txList.filter((t: any) => t.status !== 'unprocessed').length;
  const cumulativeRecovered = txList.filter((t: any) => t.status === 'recovered').length;
  const cumulativeRecoveredAmount = txList
    .filter((t: any) => t.status === 'recovered')
    .reduce((sum: number, t: any) => sum + t.amount, 0);
  const cumulativeEscalated = txList.filter((t: any) => t.status === 'escalated').length;
  const cumulativeFailed = txList.filter((t: any) => t.status === 'failed').length;
  const cumulativeTotalAtRisk = txList.reduce((sum: number, t: any) => sum + t.amount, 0);

  // Recovery rate is cumulative recovered / total records
  const recoveryRate = totalRecords > 0 ? cumulativeRecovered / totalRecords : 0;

  // Reset counters for accurate cumulative recounting
  autoRetryCount = 0;
  messageCount = 0;
  promiseCount = 0;
  paymentLinkCount = 0;

  // Action type breakdown across batch
  txList.forEach((t: any) => {
    if (t.actions) {
      t.actions.forEach((a: any) => {
        if (a.action_type === 'auto_retry') autoRetryCount++;
        if (a.action_type === 'recovery_message') messageCount++;
        if (a.action_type === 'promise_to_pay') promiseCount++;
        if (a.action_type === 'payment_link') paymentLinkCount++;
      });
    }
  });

  // Final batch update with true cumulative metrics
  await supabase
    .from('batch_runs')
    .update({
      total_records: totalRecords,
      processed: cumulativeProcessed,
      recovered_count: cumulativeRecovered,
      recovered_amount: cumulativeRecoveredAmount,
      failed_count: cumulativeFailed,
      escalated_count: cumulativeEscalated,
      recovery_rate: recoveryRate,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', targetBatchId);

  return {
    batch_id: targetBatchId!,
    total_records: totalRecords,
    processed: cumulativeProcessed,
    recovered_count: cumulativeRecovered,
    recovered_amount: cumulativeRecoveredAmount,
    failed_count: cumulativeFailed,
    escalated_count: cumulativeEscalated,
    stopped_count: 0,
    recovery_rate: recoveryRate,
    total_at_risk: cumulativeTotalAtRisk,
    auto_retry_count: autoRetryCount,
    message_count: messageCount,
    promise_count: promiseCount,
    payment_link_count: paymentLinkCount,
  };
}
