// GET /api/audit — Fetch audit log entries
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('transaction_id');
    const batchId = searchParams.get('batch_id');
    const limit = parseInt(searchParams.get('limit') || '500');

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('audit_log')
      .select('*, transactions!inner(batch_id)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (transactionId) {
      query = query.eq('transaction_id', transactionId);
    }
    
    if (batchId) {
      query = query.eq('transactions.batch_id', batchId);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    return NextResponse.json({ entries: data, count: data?.length || 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

