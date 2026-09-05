'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/audit', label: 'Audit Trail' },
  { href: '/escalations', label: 'Escalations' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="navbar">
      <Link href="/dashboard" className="navbar-brand">
        <span className="navbar-brand-icon">R</span>
        <div className="navbar-brand-text">
          <span className="navbar-brand-title">RevenueGuard</span>
          <span className="navbar-brand-tagline">AI-powered revenue recovery with deterministic rules and full audit trail</span>
        </div>
      </Link>
      <div className="navbar-links">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`navbar-link ${pathname === item.href ? 'navbar-link--active' : ''}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
