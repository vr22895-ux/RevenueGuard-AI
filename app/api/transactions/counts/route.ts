// GET /api/transactions/counts — Fetch counts of transactions grouped by status
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batch_id');

    const supabase = getSupabaseAdmin();

    let query = supabase.from('transactions').select('status');
    if (batchId) query = query.eq('batch_id', batchId);
    
    // We fetch just the statuses (max 1000 for safety, though batch is small) and count them
    // For large scale, we would use an RPC function to group by.
    query = query.limit(1000);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const counts = (data || []).reduce((acc: Record<string, number>, curr: any) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1;
      return acc;
    }, {});
    
    const total = data?.length || 0;

    return NextResponse.json({ counts, total });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

