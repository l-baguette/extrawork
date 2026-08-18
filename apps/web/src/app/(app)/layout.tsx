import { Providers } from '@/lib/providers';
import { AppShell, type ShellUser } from '@/components/app-shell';
import { serverGet } from '@/lib/server-fetch';

/**
 * Authenticated contractor shell — the `/app/*` route group from report §6.1.
 *
 * Kept separate from `/r/*` so the public approval surface never loads this
 * shell, its navigation, or its client-side query cache. Report §6.4 is
 * explicit that approval-page state is not kept in the authenticated cache.
 *
 * The identity is resolved here, once, on the server. Every page below already
 * renders on the server with the session cookie, so fetching it in a client
 * component would add a round trip and a flash of an empty account block for no
 * benefit.
 */

interface MeResponse {
  user: { id: string; email: string; displayName: string };
  memberships: Array<{ organizationId: string; organizationName: string; role: string }>;
  activeOrganizationId: string | null;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await serverGet<MeResponse>('/v1/auth/me');

  // An unauthenticated visitor still gets the shell, because each page below
  // renders its own sign-in prompt inside it. Blanking the chrome here would
  // make an expired session look like a broken application.
  const active = me.ok
    ? (me.data.memberships.find((m) => m.organizationId === me.data.activeOrganizationId) ??
      me.data.memberships[0])
    : undefined;

  const user: ShellUser = {
    displayName: me.ok ? me.data.user.displayName : '',
    email: me.ok ? me.data.user.email : '',
    role: active?.role ?? null,
    organizationName: active?.organizationName ?? null,
  };

  return (
    <Providers>
      <AppShell user={user}>{children}</AppShell>
    </Providers>
  );
}
