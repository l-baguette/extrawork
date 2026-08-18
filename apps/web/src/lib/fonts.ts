import { Archivo, Spline_Sans_Mono } from 'next/font/google';

/**
 * Typefaces for the authenticated console.
 *
 * `next/font` downloads these at build time and serves them from our own
 * origin, so the CSP's `font-src 'self'` holds and no request ever reaches a
 * third party. That distinction matters: report §11.3 forbids third-party
 * fonts, not web fonts. The public approval surface at `/r/*` still runs on the
 * system stack and does not load either of these.
 *
 * **Archivo** carries a width axis as well as weight, and that axis is the
 * design idea rather than a nicety. A reinforcement schedule sets its column
 * heads narrow to fit the rule spacing and its figures wide so they read across
 * a workshop — one voice, two widths, decided by the column. This does the
 * same: condensed for table heads and labels, expanded for money.
 *
 * **Spline Sans Mono** sets the reference codes — CO-0007, project numbers,
 * receipt ids, phone numbers. Anything a person might read aloud, copy into an
 * invoice, or compare character by character belongs in a fixed pitch with
 * unmistakable zeroes.
 */

export const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  axes: ['wdth'],
  variable: '--font-sans',
});

export const splineMono = Spline_Sans_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
});
