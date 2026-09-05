// POST /api/agent/run-batch — Run the full recovery pipeline on a batch
import { NextResponse } from 'next/server';
import { runBatch } from '@/lib/recovery-agent';

export const maxDuration = 300; // 5 minutes max for batch processing

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const batchId = body.batch_id || undefined;

    const result = await runBatch(batchId);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[run-batch] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
