// GET /api/transactions/[id] — Fetch full deep-dive for a single payment
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    // Fetch transaction
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (txError) throw new Error(txError.message);

    // Fetch related records
    const [
      { data: classifications },
      { data: decisions },
      { data: actions },
      { data: escalations },
      { data: auditLogs }
    ] = await Promise.all([
      supabase.from('classifications').select('*').eq('transaction_id', id).order('created_at', { ascending: false }),
      supabase.from('decisions').select('*').eq('transaction_id', id).order('created_at', { ascending: false }),
      supabase.from('actions').select('*').eq('transaction_id', id).order('created_at', { ascending: false }),
      supabase.from('escalations').select('*').eq('transaction_id', id).order('created_at', { ascending: false }),
      supabase.from('audit_log').select('*').eq('transaction_id', id).order('created_at', { ascending: true })
    ]);

    return NextResponse.json({
      transaction,
      classifications: classifications || [],
      decisions: decisions || [],
      actions: actions || [],
      escalations: escalations || [],
      auditLogs: auditLogs || [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
