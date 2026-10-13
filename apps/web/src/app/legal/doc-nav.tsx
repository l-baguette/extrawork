'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The policy switcher.
 *
 * A client component only so the current document can carry `aria-current`,
 * which is what makes this a set of tabs rather than five identical links — for
 * a screen reader as much as visually.
 */
const POLICIES = [
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/refunds', label: 'Refunds' },
  { href: '/legal/cookies', label: 'Cookies' },
  { href: '/legal/contact', label: 'Contact' },
];

export function DocNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Policies" className="doc-nav">
      {POLICIES.map((policy) => (
        <Link
          key={policy.href}
          href={policy.href}
          {...(pathname === policy.href ? { 'aria-current': 'page' as const } : {})}
        >
          {policy.label}
        </Link>
      ))}
    </nav>
  );
}
