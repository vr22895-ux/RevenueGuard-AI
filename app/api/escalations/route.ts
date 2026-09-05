// GET /api/escalations — Fetch escalation queue
// PATCH /api/escalations — Resolve/dismiss an escalation
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batch_id');

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('escalations')
      .select(`
        *,
        transactions!inner (
          id, customer_name, customer_email, amount, method,
          error_reason, payment_id, attempt_count, status, batch_id
        )
      `)
      .order('created_at', { ascending: false });

    if (batchId) {
      query = query.eq('transactions.batch_id', batchId);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    return NextResponse.json({ escalations: data, count: data?.length || 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status, resolution } = body;

    if (!id || !status) {
      return NextResponse.json({ error: 'id and status required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('escalations')
      .update({
        status,
        resolution: resolution || null,
        resolved_at: ['resolved', 'dismissed'].includes(status) ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // If resolved or dismissed, update transaction status and add audit log
    if (['resolved', 'dismissed'].includes(status)) {
      const newStatus = status === 'resolved' ? 'recovered' : 'failed';
      await supabase
        .from('transactions')
        .update({ status: newStatus })
        .eq('id', data.transaction_id);

      await supabase.from('audit_log').insert({
        transaction_id: data.transaction_id,
        event_type: 'closed',
        event_details: { 
          resolution_status: status,
          resolution_notes: resolution || null 
        },
        decision_reason: `Escalation manually ${status}`,
      });
    }

    return NextResponse.json({ escalation: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

