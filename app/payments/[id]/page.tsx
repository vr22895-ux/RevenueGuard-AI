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
    return <div className="page-container"><div className="card"><div className="empty-state">❌ Transaction not found.</div></div></div>;
  }

  const { transaction, classifications, decisions, actions, escalations, auditLogs } = data;

  const formatAmount = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  
  const getStatusBadge = (status: string) => {
    const colorMap: Record<string, string> = {
      unprocessed: 'muted', classified: 'info', action_planned: 'info',
      recovering: 'warning', recovered: 'success', failed: 'danger', 
      escalated: 'danger', closed: 'muted'
    };
    return <span className={`badge badge--${colorMap[status] || 'muted'}`}>{status.replace(/_/g, ' ')}</span>;
  };

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
          <span className="card-title block mb-md">Customer & Payment</span>
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
          <span className="card-title block mb-md">AI Classification History</span>
          {classifications.length > 0 ? classifications.map((c: any) => (
            <div key={c.id} className="mb-sm pb-sm border-b last:border-0 last:mb-0 last:pb-0">
              <div className="flex justify-between items-center mb-xs">
                <span className="badge badge--info">{c.root_cause}</span>
                <span className="text-sm text-muted text-mono">Attempt {c.attempt_number}</span>
              </div>
              <p className="text-sm text-muted mb-xs">Confidence: {(c.confidence * 100).toFixed(1)}%</p>
              <p className="text-sm italic" style={{ borderLeft: '3px solid var(--color-primary)', paddingLeft: '8px' }}>
                {c.reasoning}
              </p>
            </div>
          )) : <span className="text-sm text-muted">No classifications yet.</span>}
        </div>
      </div>

      <div className="grid grid-2 mb-lg">
        <div className="card">
          <span className="card-title block mb-md">Rule Engine Decisions</span>
          {decisions.length > 0 ? decisions.map((d: any) => (
            <div key={d.id} className="mb-sm pb-sm border-b last:border-0 last:mb-0 last:pb-0">
              <div className="flex justify-between items-center mb-xs">
                <span className="badge badge--warning">{d.action_type}</span>
                <span className="text-sm text-muted text-mono">Attempt {d.attempt_number}</span>
              </div>
              <p className="text-sm text-muted mb-xs">Rule: {d.rule_matched}</p>
              <p className="text-sm">{d.decision_reason}</p>
            </div>
          )) : <span className="text-sm text-muted">No decisions yet.</span>}
        </div>

        <div className="card">
          <span className="card-title block mb-md">Executed Actions</span>
          {actions.length > 0 ? actions.map((a: any) => (
            <div key={a.id} className="mb-sm pb-sm border-b last:border-0 last:mb-0 last:pb-0">
              <div className="flex justify-between items-center mb-xs">
                <span className="badge badge--primary">{a.action_type}</span>
                <span className={`badge badge--${a.status === 'success' ? 'success' : a.status === 'failed' ? 'danger' : 'muted'}`}>
                  {a.status}
                </span>
              </div>
              {a.action_details?.payment_link_url && (
                <a href={a.action_details.payment_link_url} target="_blank" rel="noreferrer" className="text-sm text-primary block mb-xs">
                  🔗 Payment Link Created
                </a>
              )}
              {a.ai_message && (
                <div className="mt-xs p-sm text-sm bg-muted rounded" style={{ whiteSpace: 'pre-wrap' }}>
                  <strong>AI Drafted SMS/Email:</strong><br /><br />{a.ai_message}
                </div>
              )}
            </div>
          )) : <span className="text-sm text-muted">No actions yet.</span>}
        </div>
      </div>

      {escalations.length > 0 && (
        <div className="card mb-lg" style={{ borderLeft: '3px solid var(--color-danger)' }}>
          <span className="card-title block mb-md text-danger">🚨 Escalation Notice</span>
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
