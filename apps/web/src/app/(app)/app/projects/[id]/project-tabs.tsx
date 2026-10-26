'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The project's sections — notes: "each project is like a folder", with its
 * requests, files, people and timeline one tap apart.
 */
const TABS = [
  { segment: '', label: 'Overview' },
  { segment: '/requests', label: 'Requests' },
  { segment: '/files', label: 'Files' },
  { segment: '/team', label: 'Team' },
  { segment: '/timeline', label: 'Timeline' },
] as const;

export function ProjectTabs({
  projectId,
  counts,
}: {
  projectId: string;
  counts?: Partial<Record<(typeof TABS)[number]['segment'], number>>;
}) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}`;
  return (
    <nav className="tabbar" aria-label="Project sections">
      {TABS.map((tab) => {
        const href = `${base}${tab.segment}`;
        const active = tab.segment === '' ? pathname === base : pathname?.startsWith(href);
        const count = counts?.[tab.segment];
        return (
          <Link
            key={tab.label}
            className="tab"
            href={href}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
            {count ? <span className="tab-count">{count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
