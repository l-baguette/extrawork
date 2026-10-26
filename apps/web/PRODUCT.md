# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the interior designer or architect.** Runs or works in a small Indian
design or architecture practice (spec 2026-10-12). Every project lives in their
workspace and every change request routes through them: they review, price and
send each one before the homeowner decides. They use the logged-in web app on a
laptop in the studio and on a phone on site, so both have to be first-class.

It is general project management, not a single queue: projects, the people on
them, files and drawings, the timeline, and the record of every change.

Three other people touch the product:

- **The construction company** (owner, site supervisor, foreman). Some are
  invited as **collaborators** with an account and see only the projects they
  are on; most of the site team never logs in — their WhatsApp number is their
  identity, and they send requests, photos and notes by message.
- **The homeowner**, who has no account. They decide on requests through a
  private expiring link (`/r/*`), see the whole project record through a portal
  link (`/p/*`), and can ask for changes or send files by WhatsApp.
- **Other architecture firms or consultants**, invited as collaborators.

## Product Purpose

Organisation and visibility for an unorganised sector: one shared folder per
project — the customer, the contract value and its history, the timeline, the
people, the drawings and photos — plus one numbered record of every change,
approved by the homeowner without creating an account. The evidence trail
(frozen versions, an append-only history, a tamper-evident PDF) is a real side
benefit, not the headline. Success is that nobody on a project has to dig
through a WhatsApp thread to find what was agreed.

## Positioning

The field channel is WhatsApp, not an app. A foreman or homeowner sends one
message — a request, a photo, a note — and it lands in the right project for the
designer to review. A competitor with a mobile app cannot
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
  DECLINED / REVISION_REQUESTED / EXPIRED / CANCELLED / SUPERSEDED. A request
  raised by anyone but the designer is a DRAFT "awaiting review" until the
  designer sends or dismisses it.
- The owner reviews an inbound log that includes **rejected** employee messages,
  not only successful ones — "my guy says he sent it and nothing happened" is a
  real support call.
- Roles: OWNER, ADMIN, PROJECT_MANAGER (shown as Designer), FINANCE (shown as
  Accounts), VIEWER, COLLABORATOR. Accounts can read, export and mark approved
  changes invoiced but cannot change scope. VIEWER is read-only. COLLABORATOR
  sees only granted projects and can only propose and upload.

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

Implemented account controls include editing the owner's profile and business
details (email deliberately remains read-only), switching organizations,
signing out, and first-login business onboarding.

## Brand Commitments

**ExtraWork** is a working name; a rename (Indian or English) is undecided. The authenticated console now uses the
**reinforcement schedule** design system: graphite on cool drafting paper,
hairline rules instead of shadows, square cells, Archivo for the working text,
Spline Sans Mono for references, and legend-backed status colours. Revision
red and structural blue are reserved for annotations and interaction; status
colour is always paired with a letter and a written label.

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
5. **The designer is running projects, not completing a funnel.** The home
   screen leads with what needs their review, not with a single metric.
6. **Minimal friction beats feature count.** Every extra field or step on a
   phone on site has to earn its place.

## Accessibility & Inclusion

WCAG 2.2 AA is a stated project requirement, already implemented and not to be
regressed: visible focus everywhere, 48px targets, non-colour status cues,
reduced-motion support, and a skip link.
