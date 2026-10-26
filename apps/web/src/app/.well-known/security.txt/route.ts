import { legalIdentity } from '@/lib/legal';

/**
 * RFC 9116 security.txt.
 *
 * Served from a route rather than `public/` so the contact address comes from
 * the same configured identity as the policy pages — a hard-coded file would
 * drift the moment the address changed, and a security contact nobody reads is
 * worse than none because it looks like a channel.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const identity = legalIdentity();

  // RFC 9116 requires Expires and recommends under a year, so that a stale file
  // is visibly stale rather than quietly trusted.
  const expires = new Date();
  expires.setUTCMonth(expires.getUTCMonth() + 6);

  const body = [
    `Contact: mailto:${identity.contactEmail}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    'Policy: /legal/contact',
    '',
    '# Please report privately first and give us a chance to fix it. Do not',
    '# access, change or keep data belonging to anyone else while testing, and',
    '# do not run tests that degrade the service for other users. We will not',
    '# pursue a researcher who stays within those limits.',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
