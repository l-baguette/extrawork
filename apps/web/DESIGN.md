# Design

<!-- impeccable:design-schema 1 -->

Recorded from the built world at `src/app/globals.css`, not from intention.
Scope is the authenticated console at `/app/*`. The public approval surface at
`/r/*`, sign-in and register share this stylesheet but were deliberately not
redesigned.

## The world

**The reinforcement schedule.** Every Indian construction site runs on a bar
bending schedule: a dense printed table, one row per steel bar, ruled with
hairlines, coded by diameter, carrying a legend block and revisions annotated in
red pencil. It is beautiful because nothing on it is decorative — every mark
carries information.

A change register is the same document. `CO-0007`, a coded type, a quantity, a
rate, an amount. Adopting the schedule's grammar was not a metaphor laid over
the product; it was recognising the information architecture the product already
had.

Three rules govern everything and are enforced in the stylesheet's own comments:

1. **Structure is rules, not shadows.** There is no `box-shadow` anywhere.
   Depth comes from hairlines and ground changes, as on a printed sheet.
2. **Colour is a code, never decoration.** Chrome — navigation, buttons,
   headings, tables — is entirely graphite on paper. State colours appear only
   where they encode a status.
3. **Cells are square.** `--r` is 2px, and several surfaces are 0. The rounded
   card is the most legible tell of a generic template.

## Colour

Ground and ink:

| Token       | Value     | Role                                          |
| ----------- | --------- | --------------------------------------------- |
| `--paper`   | `#eef1f0` | app ground, cool drafting paper               |
| `--sheet`   | `#ffffff` | the sheet                                     |
| `--sheet-2` | `#f7f8f8` | hover, inset wells                            |
| `--sheet-3` | `#eceff0` | column heads                                  |
| `--ink`     | `#14171a` | graphite, primary text, primary button fill   |
| `--ink-2`   | `#454f58` | secondary text                                |
| `--ink-3`   | `#5e6a75` | lightest text permitted — 4.79:1 worst ground |
| `--rule`    | `#dadee1` | hairline                                      |
| `--rule-2`  | `#b9c0c6` | structural rule, borders                      |
| `--rule-3`  | `#14171a` | grand-total rule                              |

Coded states, drawn from the diameter tags on rebar bundles. Each is bound to a
**letter** and a **written label**; the colour is the third cue, never the only
one:

| Token      | Value     | Code      | Meaning                    |
| ---------- | --------- | --------- | -------------------------- |
| `--code-a` | `#1d6a46` | A         | approved                   |
| `--code-w` | `#96650a` | W / O / R | waiting, opened, revision  |
| `--code-d` | `#b3352c` | X / E     | declined, expired          |
| `--code-n` | `#4a5560` | D / C / S | draft, cancelled, replaced |

Two further roles:

- `--revision` `#b3352c` — the red pencil an engineer annotates a schedule with.
  This system's single accent. It marks the active nav item and the current
  composer step. It is never a background field.
- `--focus` `#1d4e7c` — focus rings and links only.

**Strategy: full palette, four named roles, applied as a code.** In practice the
surface reads as neutral: the coded colours occupy small tags, and everything
else is graphite on paper.

The primary action is an **ink block**, not a coloured pill. Colour here means
status, so a coloured primary button would assert the button had one.

## Type

Two faces, both self-hosted through `next/font` so the CSP's `font-src 'self'`
holds and nothing reaches a third party.

- **Archivo** (variable, `wght` + `wdth`). The width axis is the design idea:
  a schedule sets its column heads narrow to fit the rule spacing and its
  figures wide to read across a workshop. Column heads and labels run at
  `font-stretch: 92%`; money figures at `108%`; the wordmark at `112%`.
- **Spline Sans Mono** (`--font-mono`). Every reference code, phone number,
  GSTIN and email — anything a person reads aloud, copies into an invoice, or
  compares character by character.

Six sizes, and no more:

| Token        | Size | Use                                                 |
| ------------ | ---- | --------------------------------------------------- |
| `--t-micro`  | 11px | column heads, code tags, labels (uppercase, 0.09em) |
| `--t-small`  | 13px | secondary text, table body                          |
| `--t-body`   | 15px | base                                                |
| `--t-lead`   | 17px | h2, wordmark                                        |
| `--t-head`   | 22px | h1                                                  |
| `--t-figure` | 34px | money cells (1.75rem on mobile)                     |

Form inputs are pinned to **16px** regardless of scale — below that iOS zooms
the viewport on focus.

## Layout

- **Shell:** `grid-template-columns: var(--rail) minmax(0, 1fr)`. A 232px rail,
  sticky and full-height, holding wordmark, navigation, the status-code legend
  and the account block. Below 900px it folds into a top bar with a collapsing
  nav — it collapses rather than overlaying, so the sheet is never covered by
  navigation the reader did not ask for.
- **Sheet:** `max-width: 1400px` (`.sheet-narrow` 760px for forms), with a
  sticky `.sheet-top` carrying the title, a meta line and the page's actions.
- **Spacing:** one 4→64px scale (`--s1`…`--s8`). More space above a heading than
  below it, via `.block-head` and its ruled leader.

## Components

- `.schedule` / `.schedule-row` — the row grammar shared by every list:
  mark, code, subject, right-aligned figure, chevron. On mobile it reflows to a
  2×2 grid via named grid areas. `href` makes the whole 56px row the target.
- `.figures` / `.figure` — the money row across the top of a sheet, divided by
  hairlines rather than gaps, so it reads as one ruled block.
- `.code` — the square letter tag, rendered from `data-code` so the letter is in
  the markup and survives CSS loss.
- `.panel`, `.data-table`, `.table-total` (the one heavy rule on a page),
  `.segmented`, `.banner`, `.empty` (which keeps its ruling so the shape of the
  absent table is legible), `.menu`, `.account-trigger`.
- Icons are drawn to the sheet's own rules: 16px grid, 1.5px strokes, square
  caps and joins. A stock icon set inside a committed form is the lapse that
  gives a design away.

## Motion

Two patterns, and nothing else:

1. `--ease` — a 120ms snap on hover, focus and state change.
2. `.rule-in` — a sheet arrives by ruling itself in from the left
   (`clip-path: inset(0 100% 0 0)` → `inset(0)`), not by fading up.

`prefers-reduced-motion: reduce` disables both globally, including
`scroll-behavior`.

## Accessibility

Hard requirements, already implemented and not to be regressed:

- Every status carries a letter and a written label before it carries a colour.
- `--ink-3` is the lightest text permitted anywhere. It is verified against the
  **darkest** ground it is set on (`--sheet-3`, the column heads), not against
  white: the earlier `#64707b` measured 5.07 on white and a failing 4.38 there.
  All 23 foreground/ground pairs in this system now measure ≥4.5:1.
- 44px minimum tap targets (`--tap`), usable with work gloves.
- Visible focus everywhere: 2px `--focus` ring, offset 2px. Never removed.
- Inputs never below 16px.
- Skip link, `aria-current` on navigation, `role="alert"` on errors,
  `role="status"` on confirmations, `aria-expanded`/`aria-controls` on the
  account menu, Escape and outside-click to dismiss.

## Boundaries

- `/r/*`, `/sign-in`, `/register` and `/simulator` are **not** in this world.
  They share the stylesheet and are served by a compatibility layer
  (`.page`, `.card`, `.chip`, `.button` and friends) restated in the schedule's
  language. The approval page in particular is evidence a customer reads once,
  and churning it is risk without upside.
- The input selector is written by **exclusion**
  (`input:not([type='checkbox'])…`) rather than by enumerating text-like types.
  `input[type='text']` does not match `<input>` with no type attribute, which is
  valid HTML and defaults to text; an enumerated selector silently leaves those
  at their intrinsic ~150px width. This was a live defect before it was fixed.
- No accent bars in any direction. The banner carried a left stripe, then a
  heavier top rule, and both were the same mistake: a second decorative device
  for something the system already has a language for.
