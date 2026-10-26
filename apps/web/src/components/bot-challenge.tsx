'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * The human-verification widget, rendered only when a site key is configured.
 *
 * Deployments without bot protection render nothing and the forms submit with
 * no token, which the API accepts because its driver is off too. That symmetry
 * is what keeps local development and the test suite from needing a network
 * round-trip to Cloudflare to sign in.
 *
 * The token is short-lived and single-use. `onToken(null)` on expiry is what
 * stops a form sitting open for ten minutes from submitting a dead token and
 * showing the person a confusing failure.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback': () => void;
          'error-callback': () => void;
          theme?: 'auto' | 'light' | 'dark';
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function BotChallenge({ onToken }: { onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const instanceId = useId();

  useEffect(() => {
    if (!SITE_KEY || !container.current) return;

    let widgetId: string | undefined;
    let cancelled = false;

    function render() {
      if (cancelled || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: SITE_KEY as string,
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => {
          onToken(null);
          setFailed(true);
        },
      });
    }

    if (window.turnstile) {
      render();
    } else {
      // One shared script tag however many widgets mount; a second copy would
      // reset the first widget's state.
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      const script = existing ?? document.createElement('script');
      if (!existing) {
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
      script.addEventListener('error', () => setFailed(true));
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken, instanceId]);

  if (!SITE_KEY) return null;

  return (
    <div className="field">
      <div ref={container} />
      {failed ? (
        <p className="error-text">
          The verification check could not load. Check your connection and reload the page.
        </p>
      ) : null}
    </div>
  );
}

/** True when this deployment expects a token, so forms can require one. */
export const BOT_CHALLENGE_ENABLED = Boolean(SITE_KEY);
