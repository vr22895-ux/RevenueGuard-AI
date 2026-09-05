'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function DemoLimitReachedPage() {
  const router = useRouter();

  return (
    <div className="page-container flex justify-center items-center" style={{ minHeight: '80vh' }}>
      <div className="card" style={{ maxWidth: '600px', width: '100%', textAlign: 'center', padding: '3rem 2rem' }}>
        <div className="mb-md" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(255, 171, 0, 0.1)', color: 'var(--color-warning)' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        
        <h1 className="mb-sm">Razorpay Test Limit Reached</h1>
        
        <p className="text-muted mb-lg" style={{ lineHeight: '1.6' }}>
          You've clicked a <strong>Simulated Demo Link</strong>. 
          <br /><br />
          Razorpay's test mode has a hard limit of 30 payment links per account. During this demo, RevenueGuard AI hit that API limit.
          <br /><br />
          Instead of crashing or faking a success, our system <strong>caught the error</strong>, logged the exact API failure in the audit trail, and generated this honest mock link so you could continue exploring the dashboard without interruption.
        </p>

        <div className="p-md bg-muted rounded text-left mb-lg">
          <p className="text-sm text-muted mb-xs font-bold uppercase tracking-wider">Audit Trail Integrity Check</p>
          <p className="text-sm text-mono">
            "An audit trail that records success: true for an action that actually failed is a fabricated audit trail."
          </p>
        </div>

        <button 
          onClick={() => router.push('/dashboard')}
          className="btn btn--primary"
        >
          ← Go Back
        </button>
      </div>
    </div>
  );
}
