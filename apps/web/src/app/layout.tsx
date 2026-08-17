import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ExtraWork',
  description:
    'Record customer-approved extra work with a price, a schedule impact and an evidence trail.',
  // Public approval routes additionally send X-Robots-Tag from next.config.mjs.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never lock zoom: pinch-zoom is an accessibility requirement (WCAG 2.2).
  maximumScale: 5,
  themeColor: '#1f6feb',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
