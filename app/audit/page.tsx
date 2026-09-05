'use client';

import { useState, useEffect } from 'react';

interface AuditEntry {
  id: string;
  transaction_id: string;
  event_type: string;
  event_details: Record<string, unknown>;
  decision_reason: string | null;
  created_at: string;
}

const EVENT_COLORS: Record<string, string> = {
  payment_ingested: 'muted',
  classified: 'info',
  decision_made: 'info',
  action_planned: 'warning',
  action_executed: 'warning',
  retry_attempted: 'warning',
  retry_succeeded: 'success',
  retry_failed: 'danger',
  message_drafted: 'info',
  message_sent: 'info',
  payment_link_created: 'info',
  promise_created: 'warning',
  promise_fulfilled: 'success',
  promise_broken: 'danger',
  stopping_rule_triggered: 'danger',
  escalated: 'danger',
  recovered: 'success',
  closed: 'muted',
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    async function loadAudit() {
      try {
        const batchRes = await fetch('/api/batch/latest');
        const batchData = await batchRes.json();
        const batchId = batchData.batch?.id;
        
        const url = batchId ? `/api/audit?limit=500&batch_id=${batchId}&t=${Date.now()}` : `/api/audit?limit=500&t=${Date.now()}`;
        const res = await fetch(url);
        const data = await res.json();
        setEntries(data.entries || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadAudit();
  }, []);

  const filteredEntries = filter === 'all'
    ? entries
    : entries.filter(e => e.event_type === filter);

  const eventTypes = [...new Set(entries.map(e => e.event_type))];

  const formatTime = (ts: string) => {
    return new Date(ts).toLocaleString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      day: '2-digit', month: 'short',
    });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Audit Trail</h1>
        <p>Immutable, append-only log of every AI decision and action · Write-ahead pattern</p>
      </div>

      {/* Filters */}
      <div className="flex gap-sm mb-lg" style={{ flexWrap: 'wrap' }}>
        <button
          className={`btn btn--sm ${filter === 'all' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setFilter('all')}
        >
          All ({entries.length})
        </button>
        {eventTypes.map(t => (
          <button
            key={t}
            className={`btn btn--sm ${filter === t ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setFilter(t)}
          >
            {t.replace(/_/g, ' ')} ({entries.filter(e => e.event_type === t).length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><div className="empty-state"><span className="spinner" /><p className="mt-md">Loading audit trail...</p></div></div>
      ) : entries.length === 0 ? (
        <div className="card"><div className="empty-state"><h3>No Audit Entries</h3><p>Run the Recovery Agent to generate audit trail entries.</p></div></div>
      ) : (
        <div className="card" style={{ padding: 'var(--space-lg)' }}>
          <div className="timeline">
            {filteredEntries.slice(0, 100).map(entry => {
              const color = EVENT_COLORS[entry.event_type] || 'muted';
              return (
                <div key={entry.id} className="timeline-item">
                  <div className={`timeline-dot timeline-dot--${color}`} />
                  <div className="timeline-time">{formatTime(entry.created_at)}</div>
                  <div className="timeline-content">
                    <h4>
                      <span className={`badge badge--${color}`} style={{ marginRight: '0.5rem' }}>
                        {entry.event_type.replace(/_/g, ' ')}
                      </span>
                    </h4>
                    {entry.decision_reason && (
                      <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                        {entry.decision_reason}
                      </p>
                    )}
                    <details style={{ marginTop: '0.25rem' }}>
                      <summary className="text-xs text-muted" style={{ cursor: 'pointer' }}>
                        Details (Transaction: {entry.transaction_id.slice(0, 8)}...)
                      </summary>
                      <pre style={{
                        marginTop: '0.5rem',
                        padding: '0.5rem',
                        background: 'var(--bg-primary)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.75rem',
                        overflow: 'auto',
                        maxHeight: '200px',
                      }}>
                        {JSON.stringify(entry.event_details, null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
          {filteredEntries.length > 100 && (
            <p className="text-muted text-sm" style={{ textAlign: 'center', marginTop: 'var(--space-lg)' }}>
              Showing 100 of {filteredEntries.length} entries
            </p>
          )}
        </div>
      )}
    </div>
  );
}
