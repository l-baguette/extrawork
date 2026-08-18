'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  IconBuilding,
  IconChevron,
  IconClose,
  IconCustomers,
  IconEmployees,
  IconMenu,
  IconProjects,
  IconReports,
  IconRequests,
  IconSettings,
  IconSheet,
  IconSignOut,
  IconSimulator,
  IconUser,
} from './icons';
import { LEGEND } from './status-chip';

/**
 * The authenticated shell — a fixed legend rail and a scrolling sheet.
 *
 * A schedule sheet keeps its legend and its title block in the margin, always
 * visible, because you read the table against them. The rail is that margin:
 * it never scrolls away, it carries the code legend the rows are written in,
 * and the account block sits at its foot where the signature would be.
 *
 * Below 900px the rail folds into a top bar. The nav collapses rather than
 * becoming a drawer over the content, so the sheet is never obscured by
 * navigation the reader did not ask for.
 */

const NAV = [
  { href: '/app/dashboard', label: 'Overview', Icon: IconSheet },
  { href: '/app/projects', label: 'Projects', Icon: IconProjects },
  { href: '/app/requests', label: 'Requests', Icon: IconRequests },
] as const;

const NAV_MANAGE = [
  { href: '/app/employees', label: 'Employees', Icon: IconEmployees },
  { href: '/app/customers', label: 'Customers', Icon: IconCustomers },
  { href: '/app/reports', label: 'Reports', Icon: IconReports },
] as const;

const NAV_SYSTEM = [
  { href: '/app/settings', label: 'Settings', Icon: IconSettings },
  { href: '/simulator', label: 'Simulator', Icon: IconSimulator },
] as const;

export interface ShellUser {
  displayName: string;
  email: string;
  role: string | null;
  organizationName: string | null;
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // The mobile nav closes on navigation. Leaving it open would cover the page
  // the person just chose.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="shell">
      <div className="rail" data-open={open ? 'true' : 'false'}>
        <div className="rail-head">
          <div style={{ minWidth: 0 }}>
            <Link className="wordmark" href="/app/dashboard">
              Extra<span className="wordmark-mark">Work</span>
            </Link>
            {user.organizationName ? (
              <div className="rail-org" title={user.organizationName}>
                {user.organizationName}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-quiet rail-toggle"
            aria-expanded={open}
            aria-controls="rail-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <IconClose /> : <IconMenu />}
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>

        <nav className="rail-nav" id="rail-nav" aria-label="Main">
          <div className="rail-group">
            {NAV.map((item) => (
              <RailLink key={item.href} {...item} pathname={pathname} />
            ))}
          </div>
          <div className="rail-group">
            <div className="rail-group-title section-title">Manage</div>
            {NAV_MANAGE.map((item) => (
              <RailLink key={item.href} {...item} pathname={pathname} />
            ))}
          </div>
          <div className="rail-group">
            <div className="rail-group-title section-title">System</div>
            {NAV_SYSTEM.map((item) => (
              <RailLink key={item.href} {...item} pathname={pathname} />
            ))}
          </div>

          <div className="legend">
            <div className="legend-title">Status codes</div>
            <div className="legend-items">
              {LEGEND.map((item) => (
                <span
                  key={item.letter}
                  className={`code code-${item.tone}`}
                  data-code={item.letter}
                >
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </nav>

        <div className="rail-foot">
          <AccountMenu user={user} />
        </div>
      </div>

      <div id="main">{children}</div>
    </div>
  );
}

function RailLink({
  href,
  label,
  Icon,
  pathname,
}: {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  pathname: string | null;
}) {
  // `/app/projects` must not stay marked while you are on `/app/projects/123`'s
  // sibling routes, but it should while you are inside a project.
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  return (
    <Link className="rail-link" href={href} aria-current={active ? 'page' : undefined}>
      <Icon />
      {label}
    </Link>
  );
}

/**
 * The account block.
 *
 * Signing out is a real request, not a client-side cookie wipe: the API revokes
 * the session server-side so a copied cookie cannot be replayed. The button
 * stays disabled and labelled while that request is in flight, and a failure is
 * shown rather than swallowed — a sign-out that silently did nothing is the
 * worst outcome on a shared machine.
 */
function AccountMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    setError(null);
    try {
      await api('/v1/auth/sign-out', { method: 'POST' });
      // A full navigation, not a client push: every cached query in this tab
      // belongs to the person who just left.
      window.location.assign('/');
    } catch {
      setSigningOut(false);
      setError('Could not sign out. Check your connection and try again.');
    }
  }, []);

  const initials =
    user.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '—';

  return (
    <div className="account" ref={containerRef}>
      <button
        type="button"
        className="account-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="account-name">{user.displayName || 'Your account'}</span>
          {user.role ? <span className="account-role">{user.role.replace(/_/g, ' ')}</span> : null}
        </span>
        <IconChevron />
      </button>

      {open ? (
        <div className="menu" id={menuId} role="menu">
          <div className="menu-head">
            <div className="account-name">{user.displayName || 'Your account'}</div>
            <div className="menu-email">{user.email}</div>
          </div>
          <Link className="menu-item" href="/app/settings/profile" role="menuitem">
            <IconUser />
            Your details
          </Link>
          <Link className="menu-item" href="/app/settings" role="menuitem">
            <IconBuilding />
            Business settings
          </Link>
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item menu-item-danger"
            role="menuitem"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            {signingOut ? <span className="spinner" /> : <IconSignOut />}
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          {error ? (
            <p className="field-error" style={{ padding: '0 var(--s3) var(--s2)' }} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
