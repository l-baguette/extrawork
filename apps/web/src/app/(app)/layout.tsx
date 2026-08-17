import Link from 'next/link';
import { Providers } from '@/lib/providers';
import { AppNav } from '@/components/app-nav';

/**
 * Authenticated contractor shell — the `/app/*` route group from report §6.1.
 *
 * Kept separate from `/r/*` so the public approval surface never loads this
 * shell, its navigation, or its client-side query cache. Report §6.4 is
 * explicit that approval-page state is not kept in the authenticated cache.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <header className="appbar">
        <div className="appbar-inner">
          <Link className="brand" href="/app/dashboard">
            ExtraWork
          </Link>
          <AppNav />
        </div>
      </header>
      <div id="main">{children}</div>
    </Providers>
  );
}
