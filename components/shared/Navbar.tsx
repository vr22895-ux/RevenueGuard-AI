'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/audit', label: 'Audit Trail', icon: '📋' },
  { href: '/escalations', label: 'Escalations', icon: '🚨' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="navbar">
      <Link href="/dashboard" className="navbar-brand">
        <span className="navbar-brand-icon">🛡️</span>
        RevenueGuard AI
      </Link>
      <div className="navbar-links">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`navbar-link ${pathname === item.href ? 'navbar-link--active' : ''}`}
          >
            <span>{item.icon}</span> {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
