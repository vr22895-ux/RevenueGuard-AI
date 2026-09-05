'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Escalation {
  id: string;
  transaction_id: string;
  reason: string;
  details: string;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  transactions: {
    id: string;
    customer_name: string;
    customer_email: string;
    amount: number;
    method: string;
    error_reason: string;
    payment_id: string;
    attempt_count: number;
    status: string;
  } | null;
}

const REASON_LABELS: Record<string, string> = {
  max_retries: 'Max Retries Exceeded',
  hard_decline: 'Hard Decline',
  high_value: 'High Value',
  low_confidence: 'Low AI Confidence',
  promise_broken: 'Promise Broken',
  customer_declined: 'Customer Declined',
  manual: 'Manual Review',
};

export default function EscalationsPage() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const fetchEscalations = async () => {
    try {
      const batchRes = await fetch('/api/batch/latest');
      const batchData = await batchRes.json();
      const batchId = batchData.batch?.id;
      
      const url = batchId ? `/api/escalations?batch_id=${batchId}&t=${Date.now()}` : `/api/escalations?t=${Date.now()}`;
      const res = await fetch(url);
      const data = await res.json();
      setEscalations(data.escalations || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEscalations(); }, []);

  const handleResolve = async (id: string, status: string) => {
    await fetch('/api/escalations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        status,
        resolution: status === 'resolved' ? 'Manually reviewed and resolved' : 'Dismissed: no action needed',
      }),
    });
    fetchEscalations();
  };

  const formatAmount = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });

  const filtered = filter === 'all'
    ? escalations
    : filter === 'pending'
      ? escalations.filter(e => e.status === 'pending')
      : escalations.filter(e => ['resolved', 'dismissed'].includes(e.status));

  const pendingCount = escalations.filter(e => e.status === 'pending').length;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Escalation Queue</h1>
        <p>Payments that hit stopping rules or need human review · {pendingCount} pending</p>
      </div>

      <div className="flex gap-sm mb-lg">
        {['all', 'pending', 'resolved'].map(f => (
          <button key={f} className={`btn btn--sm ${filter === f ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setFilter(f)}>
            {f === 'all' ? `All (${escalations.length})` : f === 'pending' ? `Pending (${pendingCount})` : `Resolved (${escalations.length - pendingCount})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><div className="empty-state"><span className="spinner" /><p className="mt-md">Loading...</p></div></div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty-state"><h3>No Escalations</h3><p>All clear! No payments need human review.</p></div></div>
      ) : (
        <div className="flex flex-col gap-md">
          {filtered.map(esc => (
            <div key={esc.id} className="card" style={{
              borderLeftWidth: '3px',
              borderLeftColor: esc.status === 'pending' ? 'var(--color-danger)' : 'var(--color-success)',
            }}>
              <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <span className={`badge ${esc.status === 'pending' ? 'badge--danger' : 'badge--success'}`}>
                    {esc.status}
                  </span>
                  <span className="badge badge--info" style={{ marginLeft: '0.5rem' }}>
                    {REASON_LABELS[esc.reason] || esc.reason}
                  </span>
                </div>
                <div className="flex gap-sm items-center">
                  {esc.status === 'pending' && (
                    <>
                      <button className="btn btn--success btn--sm" onClick={() => handleResolve(esc.id, 'resolved')}>
                        Resolve
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => handleResolve(esc.id, 'dismissed')}>
                        ✕ Dismiss
                      </button>
                    </>
                  )}
                  {esc.transaction_id && (
                    <Link href={`/payments/${esc.transaction_id}`} className="btn btn--ghost btn--sm">
                      View Details →
                    </Link>
                  )}
                </div>
              </div>

              {esc.transactions && (
                <div className="mt-sm flex gap-lg items-center" style={{ flexWrap: 'wrap' }}>
                  <div>
                    <span className="text-xs text-muted">Customer</span>
                    <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{esc.transactions.customer_name}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Amount</span>
                    <p className="text-mono font-bold">{formatAmount(esc.transactions.amount)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Method</span>
                    <p>{esc.transactions.method}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Error</span>
                    <p>{esc.transactions.error_reason.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Attempts</span>
                    <p className="text-mono">{esc.transactions.attempt_count}</p>
                  </div>
                </div>
              )}

              <p className="mt-sm text-sm" style={{ color: 'var(--text-secondary)' }}>{esc.details}</p>

              {esc.resolution && (
                <p className="mt-sm text-sm text-success">Resolution: {esc.resolution}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
