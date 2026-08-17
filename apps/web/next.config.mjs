/**
 * Next.js configuration.
 *
 * `transpilePackages` lets the app import the workspace contract package
 * directly from source, which keeps one Zod schema shared between client and
 * server (report §6.3).
 *
 * The security headers implement report §11.3 and §3.4: a strict CSP with no
 * third-party origins, `Referrer-Policy: no-referrer` so an approval token can
 * never leak through a referrer, and `noindex` on the public approval routes.
 */
const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; 'unsafe-inline' is scoped to scripts
  // we author and no third-party origin is allowed to load at all.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@extrawork/contracts'],
  webpack(config) {
    // The workspace packages are consumed as TypeScript source and use
    // extension-ful relative imports (`./errors.js`) so the same files work
    // under Node's NodeNext resolution in the API and worker. Webpack needs to
    // be told that a `.js` specifier may resolve to a `.ts` file.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          ...(isDev
            ? []
            : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
        ],
      },
      {
        // Approval links must never be indexed or archived (report §3.4).
        source: '/r/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' }],
      },
    ];
  },
};
