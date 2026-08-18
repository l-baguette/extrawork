# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the construction business owner or administrator.** Runs a small
Indian construction or interior fit-out firm. Uses the logged-in web app
**desk-first on a laptop**, in an office or site cabin. Phone is secondary.

They are not there for one task. Confirmed by the user: it is general
management — adding and managing projects and employees, watching costs change,
reviewing current requests, everything. The app is an operating console for the
business, not a single-purpose queue.

Two other people touch the product but never see these screens:

- **The site employee**, who has no account at all. Their phone number is their
  entire identity. They message the ExtraWork WhatsApp number and get a reply.
- **The customer**, who has no account. They receive a private expiring link,
  decide, and are done. Their pages live at `/r/*` and are deliberately outside
  this design scope.

## Product Purpose

Records work a customer asked for beyond the original contract — with a price, a
schedule impact and photographs — gets an approve/decline/revise decision
without the customer creating an account, and keeps the exact version that was
approved with timestamps, identity evidence, an append-only history and a
tamper-evident PDF. Success is that extra work can be substantiated and invoiced
later without an argument.

## Positioning

The intake channel is WhatsApp, not an app. A site employee types five lines and
everything else happens automatically. A competitor with a mobile app cannot
copy this, because the differentiator is that the person doing the work installs
nothing and learns nothing.

The second differentiator is evidentiary honesty: the system records what was
sent, when, what was shown, and what was decided — and says plainly, in the
product copy, that this is not a licensed electronic signature.

## Operating Context

- Money is Indian rupees, integer paise, never floating point. Amounts are
  frequently lakhs and must stay legible at that magnitude.
- Every change request belongs to a project, which has an original contract
  baseline that **locks** once the first change is sent.
- Requests move through a state machine: DRAFT → SENT → VIEWED → APPROVED /
  DECLINED / REVISION_REQUESTED / EXPIRED / CANCELLED / SUPERSEDED.
- The owner reviews an inbound log that includes **rejected** employee messages,
  not only successful ones — "my guy says he sent it and nothing happened" is a
  real support call.
- Roles: OWNER, ADMIN, PROJECT_MANAGER, FINANCE, VIEWER. FINANCE can read and
  export but cannot change scope. VIEWER is read-only.

## Capabilities and Constraints

Confirmed in code:

- Next.js 15 App Router, React 19, TanStack Query, react-hook-form, Zod.
  No CSS framework and no component library is currently installed.
- **CSP is `font-src 'self'`** and the technical report forbids third-party
  fonts. Any web font must be self-hosted (`next/font` satisfies this by
  serving from our own origin at build time).
- **No web fonts at all on `/r/*`** approval pages — that restriction is
  specific to the public surface and does not bind `/app/*`.
- Colour may never be the only carrier of meaning; every status already shows a
  text label plus a non-colour cue.
- Minimum tap target 48px — the same components are used with work gloves.
- Inputs never below 16px, or iOS zooms the viewport.
- `prefers-reduced-motion` is already honoured globally and must remain so.

Not yet built, in scope for this work: editing the owner's own profile and
business details (email is not editable), signing out, and the ordinary account
affordances a logged-in product is expected to have.

## Brand Commitments

The name **ExtraWork** stays. Nothing else is binding — the user confirmed the
current blue (`#1f6feb`), typography and component styling are placeholders to
be replaced outright, not a brand to preserve.

## Evidence on Hand

- Real seeded demonstration data exists (`pnpm db:seed`): a Bengaluru interior
  fit-out firm, two projects, seven change requests covering every state the
  domain supports. This is genuine material for designing against.
- There are **no** customers, testimonials, case studies, logos, press, or
  usage numbers. None may be invented anywhere in the interface.

## Product Principles

1. **The record must be trustworthy, and must look it.** This interface is
   evidence for a future disagreement about money.
2. **Never overstate what the system knows.** It records intent and assent, not
   proof of identity or delivery. The design must not imply certainty the
   product does not have.
3. **Rejected and awkward states are first-class.** A refused message, an
   expired link and a superseded version are things the owner came to see, not
   edge cases to hide.
4. **Money is the most important text on the screen.** It must be unambiguous
   at a glance, at lakh scale, with the sign never in doubt.
5. **The owner is managing a business, not completing a funnel.** No single
   metric owns the home screen.

## Accessibility & Inclusion

WCAG 2.2 AA is a stated project requirement, already implemented and not to be
regressed: visible focus everywhere, 48px targets, non-colour status cues,
reduced-motion support, and a skip link.
