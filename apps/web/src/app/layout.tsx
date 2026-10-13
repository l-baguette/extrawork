import type { Metadata, Viewport } from 'next';
import { SiteFooter } from '@/components/site-footer';
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
  themeColor: '#14171a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        {/*
          THESIS: An evidence console built as a reinforcement schedule — the dense
          coded table every Indian site already reads — refusing the SaaS card grid
          that hides money inside soft rounded boxes.
          OWN-WORLD: Graphite ink on cool drafting paper. Hairline rules carry
          structure; there are no drop shadows. Four state colours are a legend-backed
          CODE, never decoration, each locked to a letter and a label. Archivo's width
          axis sets condensed column heads against expanded figures; Spline Sans Mono
          sets every reference code.
          STORY: The owner opens a sheet, not a homepage. They read status codes down
          a ruled column, see money right-aligned and unambiguous at lakh scale, and
          reach any record in one move.
          FIRST VIEWPORT: Fixed legend rail left. Sheet header with org name and
          period. Four figure cells across the top in expanded numerals. Beneath, the
          live schedule of change requests, ruled, coded, newest first.
          FORM: Reinforcement schedule; candidate 4 of 7; seed key db3976d7.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the
          finish review, the verdict, and DESIGN.md
        */}
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
