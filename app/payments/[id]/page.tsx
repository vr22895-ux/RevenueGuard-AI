'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';

export default function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = use(params);
  const { id } = unwrappedParams;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/transactions/${id}`)
      .then(res => res.json())
      .then(data => {
        setData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="page-container"><div className="card"><div className="empty-state"><span className="spinner" /><p className="mt-md">Loading deep dive...</p></div></div></div>;
  }

  if (!data?.transaction) {
    return <div className="page-container"><div className="card"><div className="empty-state">Transaction not found.</div></div></div>;
  }

  const { transaction, classifications, decisions, actions, escalations } = data;

  const formatAmount = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  
  const getStatusBadge = (status: string) => {
    const colorMap: Record<string, string> = {
      unprocessed: 'muted', classified: 'info', action_planned: 'info',
      recovering: 'warning', recovered: 'success', failed: 'danger', 
      escalated: 'danger', closed: 'muted'
    };
    return <span className={`badge badge--${colorMap[status] || 'muted'}`}>{status.replace(/_/g, ' ')}</span>;
  };

  const isEscalated = escalations && escalations.length > 0;

  return (
    <div className="page-container">
      <div className="page-header flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <Link href="/dashboard" className="text-sm text-muted mb-xs block">← Back to Dashboard</Link>
          <h1>Payment Detail</h1>
          <p className="text-mono text-sm">{transaction.id}</p>
        </div>
        <div>
          {getStatusBadge(transaction.status)}
        </div>
      </div>

      <div className="grid grid-2 mb-lg">
        <div className="card">
          <div className="card-header mb-md">
            <span className="card-title">Customer & Payment</span>
          </div>
          <div className="flex flex-col gap-sm">
            <div className="flex justify-between border-b pb-sm">
              <span className="text-muted">Customer Name</span>
              <span className="font-bold">{transaction.customer_name}</span>
            </div>
            <div className="flex justify-between border-b pb-sm">
              <span className="text-muted">Amount</span>
              <span className="font-bold text-mono">{formatAmount(transaction.amount)}</span>
            </div>
            <div className="flex justify-between border-b pb-sm">
              <span className="text-muted">Method</span>
              <span>{transaction.method}</span>
            </div>
            <div className="flex justify-between border-b pb-sm">
              <span className="text-muted">Error Reason</span>
              <span>{transaction.error_reason.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex justify-between border-b pb-sm">
              <span className="text-muted">Razorpay Payment ID</span>
              <span className="text-mono">{transaction.payment_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Total Attempts</span>
              <span className="text-mono">{transaction.attempt_count}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header mb-md">
            <span className="card-title">AI Classification History</span>
          </div>
          {classifications && classifications.length > 0 ? (
            classifications.map((c: any) => (
              <div key={c.id} className="mb-sm pb-sm border-b last:border-0 last:mb-0 last:pb-0">
                <div className="flex justify-between items-center mb-xs">
                  <span className="badge badge--info">{c.root_cause}</span>
                  <span className="text-sm text-muted text-mono">Attempt {c.attempt_number}</span>
                </div>
                <p className="text-sm text-muted mb-xs">Confidence: {(c.confidence * 100).toFixed(1)}%</p>
                <p className="text-sm italic" style={{ borderLeft: '3px solid var(--color-info)', paddingLeft: '8px' }}>
                  {c.reasoning}
                </p>
              </div>
            ))
          ) : isEscalated ? (
            <div className="p-sm text-sm text-muted rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
              Skipped: Stopping rule (Hard Decline) triggered at Step 1 before AI classification.
            </div>
          ) : (
            <div className="p-sm text-sm text-muted rounded" style={{ background: 'var(--bg-tertiary)' }}>
              No classifications yet.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-2 mb-lg">
        <div className="card">
          <div className="card-header mb-md">
            <span className="card-title">Rule Engine Decisions</span>
          </div>
          {decisions && decisions.length > 0 ? (
            decisions.map((d: any) => (
              <div key={d.id} className="mb-sm pb-sm border-b last:border-0 last:mb-0 last:pb-0">
                <div className="flex justify-between items-center mb-xs">
                  <span className="badge badge--warning">{d.action_type}</span>
                  <span className="text-sm text-muted text-mono">Attempt {d.attempt_number}</span>
                </div>
                <p className="text-sm text-muted mb-xs">Rule: {d.rule_matched}</p>
                <p className="text-sm">{d.decision_reason}</p>
              </div>
            ))
          ) : isEscalated ? (
            <div className="p-sm text-sm text-muted rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
              Skipped: Escalated directly to human queue via stopping rule.
            </div>
          ) : (
            <div className="p-sm text-sm text-muted rounded" style={{ background: 'var(--bg-tertiary)' }}>
              No decisions yet.
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header mb-md">
            <span className="card-title">Executed Actions</span>
          </div>
          {actions && actions.length > 0 ? (
            actions.map((a: any) => (
              <div key={a.id} className="mb-sm pb-sm border-b last:border-0 last:mb-0 last:pb-0">
                <div className="flex justify-between items-center mb-xs">
                  <span className="badge badge--primary">{a.action_type}</span>
                  <span className={`badge badge--${a.status === 'success' ? 'success' : a.status === 'failed' ? 'danger' : 'muted'}`}>
                    {a.status}
                  </span>
                </div>
                {a.action_details?.payment_link_url && (
                  <a href={a.action_details.payment_link_url} target="_blank" rel="noreferrer" className="text-sm text-primary block mb-xs">
                    Payment Link Created →
                  </a>
                )}
                {a.ai_message && (
                  <div className="mt-xs p-sm text-sm rounded" style={{ whiteSpace: 'pre-wrap', background: a.status === 'failed' ? 'var(--bg-tertiary)' : 'var(--bg-muted)', opacity: a.status === 'failed' ? 0.7 : 1 }}>
                    <strong className={a.status === 'failed' ? 'text-danger' : ''}>
                      {a.status === 'failed' ? 'AI Drafted SMS/Email (NOT SENT DUE TO FAILURE):' : 'AI Drafted SMS/Email:'}
                    </strong>
                    <br /><br />
                    {a.ai_message}
                  </div>
                )}
              </div>
            ))
          ) : isEscalated ? (
            <div className="p-sm text-sm text-muted rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
              No automated actions executed (escalated for manual human review).
            </div>
          ) : (
            <div className="p-sm text-sm text-muted rounded" style={{ background: 'var(--bg-tertiary)' }}>
              No actions yet.
            </div>
          )}
        </div>
      </div>

      {isEscalated && (
        <div className="card mb-lg" style={{ borderLeft: '3px solid var(--color-danger)' }}>
          <div className="card-header mb-md">
            <span className="card-title text-danger">Escalation Notice</span>
          </div>
          {escalations.map((e: any) => (
            <div key={e.id} className="mb-md last:mb-0">
              <div className="flex gap-sm mb-xs">
                <span className="badge badge--danger">{e.reason}</span>
                <span className="badge badge--muted">Status: {e.status}</span>
              </div>
              <p className="text-sm mb-xs">{e.details}</p>
              {e.resolution && (
                <p className="text-sm text-success mt-xs"><strong>Resolution:</strong> {e.resolution}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
