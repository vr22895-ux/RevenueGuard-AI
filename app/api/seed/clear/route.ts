// POST /api/seed/clear — Clear all synthetic data from the database
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();
    
    // We must use 'is not null' or eq a guaranteed non-null field to safely delete all records.
    // Deleting batch_runs cascades down to transactions, classifications, decisions, actions, escalations, audit_log, and promises.
    const { error } = await supabase
      .from('batch_runs')
      .delete()
      .neq('status', 'nonexistent_status_to_force_delete_all');
      
    if (error) {
      throw new Error(error.message);
    }
    
    // Also delete any dangling transactions just in case they were inserted without batch_id
    await supabase.from('transactions').delete().neq('status', 'nonexistent');

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
