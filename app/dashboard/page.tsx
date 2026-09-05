'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface BatchMetrics {
  batch_id: string;
  total_records: number;
  processed: number;
  recovered_count: number;
  recovered_amount: number;
  failed_count: number;
  escalated_count: number;
  stopped_count: number;
  recovery_rate: number;
  total_at_risk: number;
  auto_retry_count: number;
  message_count: number;
  promise_count: number;
  payment_link_count: number;
}

interface Transaction {
  id: string;
  customer_name: string;
  amount: number;
  method: string;
  error_reason: string;
  status: string;
  attempt_count: number;
  payment_id: string;
  created_at: string;
}

export default function DashboardPage() {
  const [isSeeding, setIsSeeding] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [metrics, setMetrics] = useState<BatchMetrics | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [rootCauses, setRootCauses] = useState<Record<string, number>>({});
  
  // Pagination & Filtering state
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const limit = 50;
  
  const [statusCounts, setStatusCounts] = useState<{ total: number, counts: Record<string, number> }>({ total: 0, counts: {} });
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatAmount = (paise: number) => {
    return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  };

  const fetchLatestBatch = useCallback(async () => {
    try {
      const res = await fetch(`/api/batch/latest?t=${Date.now()}`);
      const data = await res.json();
      if (data.batch) setMetrics(data.batch);
    } catch { /* ignore */ }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const filterQuery = statusFilter !== 'all' ? `&status=${statusFilter}` : '';
      const batchQuery = metrics?.batch_id ? `&batch_id=${metrics.batch_id}` : '';
      
      const res = await fetch(`/api/transactions?page=${currentPage}&limit=${limit}${filterQuery}${batchQuery}&t=${Date.now()}`);
      const data = await res.json();
      if (data.transactions) {
        setTransactions(data.transactions);
        setTotalCount(data.count || 0);
      }
      
      const countsRes = await fetch(`/api/transactions/counts?batch_id=${metrics?.batch_id || ''}&t=${Date.now()}`);
      const countsData = await countsRes.json();
      if (countsData.counts) {
        setStatusCounts(countsData);
      }
    } catch { /* ignore */ }
  }, [currentPage, statusFilter, metrics?.batch_id]);

  const fetchMetricsData = useCallback(async () => {
    try {
      const batchQuery = metrics?.batch_id ? `batch_id=${metrics.batch_id}&` : '';
      const res = await fetch(`/api/metrics?${batchQuery}t=${Date.now()}`);
      const data = await res.json();
      if (data.root_cause_counts) {
        setRootCauses(data.root_cause_counts);
      }
    } catch { /* ignore */ }
  }, [metrics?.batch_id]);

  useEffect(() => {
    fetchLatestBatch();
  }, [fetchLatestBatch]);

  useEffect(() => {
    // Only fetch these once we have the latest batch metrics (or if null)
    fetchMetricsData();
    fetchTransactions();
  }, [fetchMetricsData, fetchTransactions, metrics]);

  const handleSeedData = async () => {
    setIsSeeding(true);
    setSeedResult(null);
    setError(null);
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSeedResult(`Generated fresh batch of ${data.count} records (Batch: ${data.batch_id?.slice(0, 8)}...)`);
        setCurrentPage(1);
        setStatusFilter('all');
        
        // Wait 1s for safety, then load the new empty batch
        await fetchLatestBatch();
      } else {
        setError(`Seed failed: ${data.error}`);
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleRunBatch = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/run-batch', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        await fetchLatestBatch(); 
      } else {
        setMetrics(data as BatchMetrics);
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { className: string; label: string }> = {
      unprocessed: { className: 'badge badge--muted', label: 'Unprocessed' },
      classified: { className: 'badge badge--info', label: 'Classified' },
      action_planned: { className: 'badge badge--info', label: 'Planned' },
      recovering: { className: 'badge badge--warning', label: 'Recovering' },
      recovered: { className: 'badge badge--success', label: 'Recovered' },
      failed: { className: 'badge badge--danger', label: 'Failed' },
      escalated: { className: 'badge badge--danger', label: 'Escalated' },
    };
    const s = map[status] || { className: 'badge badge--muted', label: status };
    return <span className={s.className}>{s.label}</span>;
  };

  const totalPages = Math.ceil(totalCount / limit);

  const [runningStep, setRunningStep] = useState(0);

  const STEP_MESSAGES = [
    ' Ingesting failed payments & verifying signatures...',
    ' Classifying root causes...',
    ' Evaluating deterministic decision matrix & stopping rules...',
    ' Executing retries, payment links & recovery messages...',
    ' Writing write-ahead audit logs & updating live metrics...'
  ];

  useEffect(() => {
    if (!isRunning) {
      setRunningStep(0);
      return;
    }
    const interval = setInterval(() => {
      setRunningStep((prev) => (prev + 1) % STEP_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [isRunning, STEP_MESSAGES.length]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="text-sm text-muted" style={{ marginTop: '4px' }}>
          Real-time AI recovery metrics, root cause breakdowns, and execution control
        </p>
      </div>

      {/* ── Control Panel ── */}
      <div className="card mb-lg">
        <div className="card-header flex items-center justify-between" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <span className="card-title">Control Panel</span>
          <div className="pipeline-flow">
            <span className="pipeline-label">Agent Flow:</span>
            <span className={`pipeline-step ${isRunning && runningStep === 1 ? 'pipeline-step--active' : ''}`}>Classify</span>
            <span className="pipeline-arrow">→</span>
            <span className={`pipeline-step ${isRunning && runningStep === 2 ? 'pipeline-step--active' : ''}`}>Decide</span>
            <span className="pipeline-arrow">→</span>
            <span className={`pipeline-step ${isRunning && runningStep === 3 ? 'pipeline-step--active' : ''}`}>Execute</span>
            <span className="pipeline-arrow">→</span>
            <span className={`pipeline-step ${isRunning && runningStep === 4 ? 'pipeline-step--active' : ''}`}>Audit</span>
            <span className="pipeline-arrow">→</span>
            <span className={`pipeline-step ${isRunning && runningStep === 0 ? 'pipeline-step--active' : ''}`}>Stop Check</span>
          </div>
        </div>
        <div className="flex gap-md items-center" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn--ghost" onClick={handleSeedData} disabled={isSeeding || isRunning}>
            {isSeeding ? <><span className="spinner" /> Generating...</> : 'Generate Test Payments'}
          </button>
          <button className="btn btn--primary" onClick={handleRunBatch} disabled={isRunning || transactions.length === 0}>
            {isRunning ? <><span className="spinner" /> Processing Agent...</> : 'Run Recovery Agent'}
          </button>
        </div>
        {seedResult && <p className="mt-sm text-sm text-success">{seedResult}</p>}
        {error && <p className="mt-sm text-sm text-danger">{error}</p>}
        {isRunning && (
          <div className="mt-md p-sm" style={{ background: 'rgba(129, 140, 248, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(129, 140, 248, 0.15)' }}>
            <p className="text-sm font-medium pulse" style={{ color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="spinner" style={{ width: '14px', height: '14px', borderTopColor: '#a5b4fc' }} />
              {STEP_MESSAGES[runningStep]}
            </p>
          </div>
        )}
      </div>

      {/* ── Batch Metrics ── */}
      {metrics && (
        <>
          <div className="grid grid-4 mb-lg">
            <div className="card metric-card metric-card--info">
              <span className="card-title">Revenue at Risk</span>
              <div className="card-value">{formatAmount(metrics.total_at_risk)}</div>
              <span className="text-xs text-muted">{metrics.total_records} failed payments</span>
            </div>
            <div className="card metric-card metric-card--success">
              <span className="card-title">Recovered</span>
              <div className="card-value">{formatAmount(metrics.recovered_amount)}</div>
              <span className="text-xs text-muted">{metrics.recovered_count} payments</span>
            </div>
            <div className="card metric-card metric-card--warning">
              <span className="card-title">Recovery Rate</span>
              <div className="card-value">{(metrics.recovery_rate * 100).toFixed(1)}%</div>
              <span className="text-xs text-muted">{metrics.recovered_count} of {metrics.processed} processed</span>
            </div>
            <div className="card metric-card metric-card--danger">
              <span className="card-title">Escalated</span>
              <div className="card-value">{metrics.escalated_count}</div>
              <span className="text-xs text-muted">Sent to human queue</span>
            </div>
          </div>
          
          <div className="grid grid-2 mb-lg">
            {/* AI Root Cause Breakdown */}
            <div className="card">
               <span className="card-title mb-sm" style={{ display: 'block' }}>AI Root Cause Breakdown</span>
               <div className="flex flex-col gap-sm mt-md">
                 {Object.entries(rootCauses).length > 0 ? (
                   Object.entries(rootCauses)
                     .sort((a, b) => b[1] - a[1])
                     .slice(0, 5)
                     .map(([cause, count]) => (
                       <div key={cause}>
                         <div className="flex justify-between text-sm mb-xs">
                           <span>{cause.replace(/_/g, ' ')}</span>
                           <span className="text-mono">{count}</span>
                         </div>
                         <div style={{ width: '100%', height: '4px', background: 'var(--bg-tertiary)', borderRadius: '2px' }}>
                           <div style={{ 
                             width: `${Math.min(100, (count / metrics.processed) * 100)}%`, 
                             height: '100%', 
                             background: 'var(--color-info)',
                             borderRadius: '2px',
                             opacity: '0.7'
                           }} />
                         </div>
                       </div>
                   ))
                 ) : (
                   <span className="text-muted text-sm">No classification data yet.</span>
                 )}
               </div>
            </div>

            {/* Recovery Funnel */}
            <div className="card">
               <span className="card-title mb-sm" style={{ display: 'block' }}>Recovery Funnel</span>
               <div className="flex flex-col gap-md mt-md">
                 <div>
                   <div className="flex justify-between text-sm mb-xs">
                     <span>Total At Risk</span>
                     <span className="text-mono">{metrics.total_records}</span>
                   </div>
                   <div style={{ width: '100%', height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px' }} />
                 </div>
                 <div>
                   <div className="flex justify-between text-sm mb-xs">
                     <span>Processed by Agent</span>
                     <span className="text-mono">{metrics.processed}</span>
                   </div>
                   <div style={{ width: `${(metrics.processed / Math.max(1, metrics.total_records)) * 100}%`, height: '6px', background: 'var(--color-info)', borderRadius: '3px', transition: 'width 0.5s', opacity: '0.7' }} />
                 </div>
                 <div>
                   <div className="flex justify-between text-sm mb-xs">
                     <span>Successfully Recovered</span>
                     <span className="text-mono">{metrics.recovered_count}</span>
                   </div>
                   <div style={{ width: `${(metrics.recovered_count / Math.max(1, metrics.total_records)) * 100}%`, height: '6px', background: 'var(--color-success)', borderRadius: '3px', transition: 'width 0.5s', opacity: '0.7' }} />
                 </div>
               </div>
            </div>
          </div>

          <div className="grid grid-4 mb-lg">
            <div className="card">
              <span className="card-title">Auto-Retries</span>
              <div className="card-value">{metrics.auto_retry_count}</div>
            </div>
            <div className="card">
              <span className="card-title">AI Messages</span>
              <div className="card-value">{metrics.message_count}</div>
            </div>
            <div className="card">
              <span className="card-title">Payment Links</span>
              <div className="card-value">{metrics.payment_link_count}</div>
            </div>
            <div className="card">
              <span className="card-title">Promises</span>
              <div className="card-value">{metrics.promise_count}</div>
            </div>
          </div>
        </>
      )}

      {/* ── Transactions Table ── */}
      {transactions.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 'var(--space-md) var(--space-lg)', borderBottom: '1px solid var(--border-primary)' }}>
            <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: '1rem' }}>
              <span className="card-title">Failed Payments ({totalCount})</span>
              <div className="flex gap-sm">
                {['all', 'unprocessed', 'recovered', 'escalated', 'recovering', 'failed'].map(s => {
                  const label = s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1);
                  const count = s === 'all' ? statusCounts.total : (statusCounts.counts[s] || 0);
                  
                  return (
                    <button
                      key={s}
                      className={`btn btn--sm ${statusFilter === s ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => {
                        setStatusFilter(s);
                        setCurrentPage(1);
                      }}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Error Reason</th>
                  <th>Attempts</th>
                  <th>Status</th>
                  <th>Payment ID</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{tx.customer_name}</td>
                    <td className="text-mono">{formatAmount(tx.amount)}</td>
                    <td><span className="badge badge--info">{tx.method}</span></td>
                    <td className="text-sm">{tx.error_reason.replace(/_/g, ' ')}</td>
                    <td className="text-mono">{tx.attempt_count}</td>
                    <td>{getStatusBadge(tx.status)}</td>
                    <td className="text-mono text-xs text-muted">{tx.payment_id.slice(0, 12)}...</td>
                    <td>
                      <Link href={`/payments/${tx.id}`} className="btn btn--sm btn--ghost">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ padding: 'var(--space-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-primary)' }}>
                <span className="text-muted text-sm">Showing page {currentPage} of {totalPages}</span>
                <div className="flex gap-sm">
                  <button 
                    className="btn btn--sm btn--ghost" 
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  >
                    ← Previous
                  </button>
                  <button 
                    className="btn btn--sm btn--ghost" 
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Empty State ── */}
      {transactions.length === 0 && !metrics && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">↗</div>
            <h3>Ready to Recover Revenue</h3>
            <p>Generate test payments to seed synthetic data, then run the Recovery Agent.</p>
          </div>
        </div>
      )}
    </div>
  );
}
