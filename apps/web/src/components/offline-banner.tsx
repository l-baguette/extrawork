'use client';

import { useEffect, useState } from 'react';

/**
 * Offline indicator — report §6.8.
 *
 * "When offline, show a persistent banner and queue only draft updates with
 * conflict detection." An offline send or an offline customer approval is never
 * permitted, because both need a canonical server version and timestamp, so
 * this banner is paired with disabling those controls rather than queuing them.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Read after mount: `navigator.onLine` is not available during SSR and
    // assuming offline would flash the banner on every first paint.
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="offline-bar" role="status" aria-live="polite">
      You are offline. Drafts are saved on this device. Sending is unavailable until you reconnect.
    </div>
  );
}

/** Lets a form disable its submit control while the device is offline. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
