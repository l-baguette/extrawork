'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  IconBuilding,
  IconCalendar,
  IconChevron,
  IconClose,
  IconCustomers,
  IconEmployees,
  IconInbox,
  IconMenu,
  IconProjects,
  IconReports,
  IconRequests,
  IconSettings,
  IconSheet,
  IconSignOut,
  IconSimulator,
  IconSwap,
  IconUser,
} from './icons';
import { LEGEND } from './status-chip';
import { PendingInvitationsBanner } from './pending-invitations-banner';

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
  { href: '/app/timeline', label: 'Timeline', Icon: IconCalendar },
  { href: '/app/inbox', label: 'Inbox', Icon: IconInbox },
] as const;

const NAV_MANAGE = [
  { href: '/app/customers', label: 'Customers', Icon: IconCustomers },
  { href: '/app/employees', label: 'Site team', Icon: IconEmployees },
  { href: '/app/reports', label: 'Reports', Icon: IconReports },
] as const;

const NAV_SYSTEM = [
  { href: '/app/settings', label: 'Settings', Icon: IconSettings },
  { href: '/simulator', label: 'Simulator', Icon: IconSimulator },
] as const;

/**
 * A collaborator (another firm, or the homeowner) sees only the projects they
 * were invited to: no customer list, no roster, no reports, no firm settings.
 * The API refuses those anyway; hiding the links keeps the rail honest.
 */
const COLLABORATOR_HREFS: ReadonlySet<string> = new Set([
  '/app/dashboard',
  '/app/projects',
  '/app/requests',
  '/app/timeline',
  '/app/inbox',
]);

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  PROJECT_MANAGER: 'Designer',
  FINANCE: 'Accounts',
  VIEWER: 'Viewer',
  COLLABORATOR: 'Collaborator',
};

export interface ShellWorkspace {
  organizationId: string;
  organizationName: string;
  role: string;
}

export interface ShellUser {
  displayName: string;
  email: string;
  role: string | null;
  organizationName: string | null;
  activeOrganizationId: string | null;
  /** Every workspace the person belongs to, their own firm and any shared with them. */
  workspaces: ShellWorkspace[];
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCounts(user.activeOrganizationId);
  const isCollaborator = user.role === 'COLLABORATOR';
  const visible = <T extends { href: string }>(items: readonly T[]) =>
    isCollaborator ? items.filter((item) => COLLABORATOR_HREFS.has(item.href)) : items;

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
            <WorkspaceSwitcher user={user} unread={unread} />
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
            {visible(NAV).map((item) => (
              <RailLink
                key={item.href}
                {...item}
                pathname={pathname}
                badge={item.href === '/app/inbox' ? unread.active : 0}
              />
            ))}
          </div>
          {isCollaborator ? null : (
            <>
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
            </>
          )}

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

      <div id="main">
        {/* Slice A: invitations to other firms' projects, above every page. */}
        <PendingInvitationsBanner />
        {children}
      </div>
    </div>
  );
}

function RailLink({
  href,
  label,
  Icon,
  pathname,
  badge = 0,
}: {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  pathname: string | null;
  badge?: number;
}) {
  // `/app/projects` must not stay marked while you are on `/app/projects/123`'s
  // sibling routes, but it should while you are inside a project.
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  return (
    <Link className="rail-link" href={href} aria-current={active ? 'page' : undefined}>
      <Icon />
      {label}
      {badge > 0 ? (
        <span className="rail-badge" aria-label={`${badge} unread`}>
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}

interface UnreadCounts {
  /** Unread in the workspace being viewed. */
  active: number;
  byWorkspace: Record<string, number>;
}

/**
 * Unread notification counts, refreshed once a minute and whenever the tab
 * regains focus. A failed poll keeps the last good numbers rather than
 * flashing the badge away.
 */
function useUnreadCounts(activeOrganizationId: string | null): UnreadCounts {
  const [counts, setCounts] = useState<UnreadCounts>({ active: 0, byWorkspace: {} });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const summary = await api<{
          workspaces: Array<{ organizationId: string; unreadCount: number }>;
        }>('/v1/notifications/summary');
        if (cancelled) return;
        const byWorkspace: Record<string, number> = {};
        for (const w of summary.workspaces) byWorkspace[w.organizationId] = w.unreadCount;
        setCounts({
          active: activeOrganizationId ? (byWorkspace[activeOrganizationId] ?? 0) : 0,
          byWorkspace,
        });
      } catch {
        // Signed out, offline, or the API restarting: keep what we had.
      }
    }
    void load();
    const timer = setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [activeOrganizationId]);

  return counts;
}

/**
 * The workspace switcher — spec 2026-10-12, D1.
 *
 * A designer's own firm and every firm that has shared a project with them are
 * separate workspaces; switching is a server round trip that moves the
 * session's active organization, then a full reload so no cached query from
 * the previous workspace survives into the next.
 */
function WorkspaceSwitcher({ user, unread }: { user: ShellUser; unread: UnreadCounts }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

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

  if (!user.organizationName) return null;

  const others = user.workspaces.filter((w) => w.organizationId !== user.activeOrganizationId);
  const otherUnread = others.reduce(
    (sum, w) => sum + (unread.byWorkspace[w.organizationId] ?? 0),
    0,
  );

  if (others.length === 0) {
    return (
      <div className="rail-org" title={user.organizationName}>
        {user.organizationName}
      </div>
    );
  }

  async function switchTo(organizationId: string) {
    setSwitching(organizationId);
    setError(null);
    try {
      await api('/v1/auth/switch-organization', { method: 'POST', body: { organizationId } });
      window.location.assign('/app/dashboard');
    } catch {
      setSwitching(null);
      setError('Could not switch. Try again.');
    }
  }

  return (
    <div className="workspace-switch" ref={containerRef}>
      <button
        type="button"
        className="rail-org rail-org-button"
        aria-expanded={open}
        aria-controls={listId}
        title={user.organizationName}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rail-org-name">{user.organizationName}</span>
        <IconSwap />
        {otherUnread > 0 ? <span className="rail-dot" aria-label="Unread elsewhere" /> : null}
      </button>
      {open ? (
        <div className="menu workspace-menu" id={listId} role="menu">
          <div className="menu-head">
            <div className="section-title">Switch workspace</div>
          </div>
          {others.map((w) => (
            <button
              key={w.organizationId}
              type="button"
              className="menu-item"
              role="menuitem"
              disabled={switching !== null}
              onClick={() => void switchTo(w.organizationId)}
            >
              {switching === w.organizationId ? <span className="spinner" /> : <IconBuilding />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="account-name">{w.organizationName}</span>
                <span className="account-role">
                  {w.role === 'COLLABORATOR' ? 'Shared with you' : (ROLE_LABELS[w.role] ?? w.role)}
                </span>
              </span>
              {(unread.byWorkspace[w.organizationId] ?? 0) > 0 ? (
                <span className="rail-badge">{unread.byWorkspace[w.organizationId]}</span>
              ) : null}
            </button>
          ))}
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
          {user.role ? (
            <span className="account-role">{ROLE_LABELS[user.role] ?? user.role}</span>
          ) : null}
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
          {user.role === 'COLLABORATOR' ? null : (
            <Link className="menu-item" href="/app/settings" role="menuitem">
              <IconBuilding />
              Business settings
            </Link>
          )}
          <Link className="menu-item" href="/app/settings/notifications" role="menuitem">
            <IconInbox />
            Notifications
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
