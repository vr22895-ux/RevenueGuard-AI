// GET /api/metrics — Fetch aggregated metrics for dashboard charts
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batch_id');

    const supabase = getSupabaseAdmin();

    // Fetch classifications for the root cause breakdown
    let classQuery = supabase.from('classifications').select('root_cause, transactions!inner(batch_id)');
    
    if (batchId) {
      classQuery = classQuery.eq('transactions.batch_id', batchId);
    }
    classQuery = classQuery.limit(1000);
    
    const { data: classifications, error: classError } = await classQuery;
    if (classError) throw new Error(classError.message);

    const rootCauseCounts = classifications.reduce((acc, curr) => {
      acc[curr.root_cause] = (acc[curr.root_cause] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({ root_cause_counts: rootCauseCounts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

