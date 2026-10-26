import Link from 'next/link';

/** Notifications and the raw WhatsApp log are two views of one inbox. */
export function InboxTabs({ current }: { current: 'notifications' | 'whatsapp' }) {
  return (
    <nav className="tabbar" aria-label="Inbox sections">
      <Link
        className="tab"
        href="/app/inbox"
        aria-current={current === 'notifications' ? 'page' : undefined}
      >
        Notifications
      </Link>
      <Link
        className="tab"
        href="/app/inbox/whatsapp"
        aria-current={current === 'whatsapp' ? 'page' : undefined}
      >
        WhatsApp log
      </Link>
    </nav>
  );
}
