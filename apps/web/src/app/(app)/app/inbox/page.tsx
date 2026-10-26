import type { NotificationListDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { SheetTop } from '@/components/sheet';
import { InboxTabs } from './inbox-tabs';
import { NotificationFeed } from './notification-feed';

/**
 * The inbox — spec 2026-10-12. Everything that arrived on your projects: a
 * request a contractor raised, photos the homeowner sent, a decision recorded,
 * a collaborator who joined, a completion date coming up.
 */
export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const result = await serverGet<NotificationListDto>('/v1/notifications?limit=50');
  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;

  return (
    <>
      <SheetTop
        title="Inbox"
        meta={
          result.data.unreadCount > 0
            ? `${result.data.unreadCount} unread`
            : 'Everything that arrived on your projects'
        }
      />
      <main className="sheet rule-in">
        <InboxTabs current="notifications" />
        <NotificationFeed initial={result.data} />
      </main>
    </>
  );
}
