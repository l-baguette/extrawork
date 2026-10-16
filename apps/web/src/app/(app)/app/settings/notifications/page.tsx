import Link from 'next/link';
import type { CalendarFeedDto, NotificationPreferencesDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { Block, SheetTop } from '@/components/sheet';
import { CalendarFeedCard } from '@/components/calendar-feed-card';
import { PreferencesForm } from './preferences-form';

/**
 * Your notification settings in this workspace — spec 2026-10-12, D14:
 * email on or off, completion and milestone reminders on or off and how far
 * ahead, and the private calendar feed. In-app notifications always arrive.
 */
export const dynamic = 'force-dynamic';

export default async function NotificationSettingsPage() {
  const [preferences, feed] = await Promise.all([
    serverGet<NotificationPreferencesDto>('/v1/notifications/preferences'),
    serverGet<CalendarFeedDto>('/v1/calendar/feed'),
  ]);
  if (!preferences.ok && preferences.status === 401) return <SignInPrompt />;
  if (!preferences.ok) return <ErrorPanel message={preferences.message} />;

  return (
    <>
      <SheetTop
        title="Notifications"
        meta="What reaches you outside the Inbox, for this workspace"
        actions={
          <Link className="btn btn-sm" href="/app/inbox">
            Inbox
          </Link>
        }
      />
      <main className="sheet sheet-narrow rule-in">
        <Block title="Email and reminders">
          <PreferencesForm initial={preferences.data} />
        </Block>
        <Block title="Calendar">
          <CalendarFeedCard initial={feed.ok ? feed.data : null} />
        </Block>
      </main>
    </>
  );
}
