// GET /api/batch/latest — Fetch the latest batch run metrics
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('batch_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is no rows returned, which is fine
      throw new Error(error.message);
    }

    let batch = data;

    if (batch) {
      const { data: txData } = await supabase
        .from('transactions')
        .select(`
          id, 
          amount,
          status,
          actions ( action_type )
        `)
        .eq('batch_id', batch.id);
        
      let totalAtRisk = 0;
      let autoRetryCount = 0;
      let messageCount = 0;
      let promiseCount = 0;
      let paymentLinkCount = 0;
      let escalatedCount = 0;
      let recoveredCount = 0;
      let recoveredAmount = 0;

      if (txData) {
        txData.forEach((tx: any) => {
          totalAtRisk += tx.amount;
          
          if (tx.status === 'escalated') escalatedCount++;
          if (tx.status === 'recovered') {
            recoveredCount++;
            recoveredAmount += tx.amount;
          }
          
          if (tx.actions) {
            tx.actions.forEach((a: any) => {
              if (a.action_type === 'auto_retry') autoRetryCount++;
              if (a.action_type === 'recovery_message') messageCount++;
              if (a.action_type === 'promise_to_pay') promiseCount++;
              if (a.action_type === 'payment_link') paymentLinkCount++;
            });
          }
        });
      }

      batch.total_at_risk = totalAtRisk;
      batch.auto_retry_count = autoRetryCount;
      batch.message_count = messageCount;
      batch.promise_count = promiseCount;
      batch.payment_link_count = paymentLinkCount;
      batch.escalated_count = escalatedCount;
      batch.recovered_count = recoveredCount;
      batch.recovered_amount = recoveredAmount;
      batch.recovery_rate = batch.processed > 0 ? recoveredCount / batch.processed : 0;
      batch.batch_id = batch.id;
    }

    return NextResponse.json({ batch: batch || null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

