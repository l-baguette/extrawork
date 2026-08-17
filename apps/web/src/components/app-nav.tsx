'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/app/dashboard', label: 'Dashboard' },
  { href: '/app/projects', label: 'Projects' },
  { href: '/app/requests', label: 'Requests' },
  { href: '/app/employees', label: 'Employees' },
  { href: '/app/customers', label: 'Customers' },
  { href: '/app/reports', label: 'Reports' },
  { href: '/app/settings', label: 'Settings' },
] as const;

/** Horizontally scrollable on a phone; `aria-current` marks the active page. */
export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname?.startsWith(link.href) ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
