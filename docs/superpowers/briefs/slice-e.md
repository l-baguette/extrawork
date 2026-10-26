# Slice E — Landing page, positioning copy and workflow docs

Worktree: `/home/claude/wt-e` · branch `feat/ws-e-landing`.

Read `/home/claude/briefs/common.md` first (the environment and committing rules apply; you
will not need the database). Then read the spec, `docs/ExtraWork_Startup_Overview.md`,
`docs/ExtraWork_Product_Brief.md`, `README.md` and the current landing page
`apps/web/src/app/page.tsx`, and skim `apps/web/src/app/globals.css` and
`apps/web/src/app/layout.tsx` to learn the visual language and fonts.

## Context: what changed

The founder's latest notes (summarised in the spec) move ExtraWork from "a change-order ledger a
contractor pays for" to "a simple organisation and management system for interior designers and
architects, shared with the construction company and the homeowner". Key lines from the notes:

- "Tool to help facilitate an unorganized sector; legal aspect comes later."
- "Internal designers and architects are the primary target market; construction company can
  also use or access; construction + client can send or request stuff via WhatsApp."
- "Everything goes through the architect." "Minimal friction and maximally easy UI/UX."
- Each project is like a folder: documents, plans, spreadsheets, photos, and one folder with all
  the approvals/contracts; requests numbered per project; a collated timeline; collaborators.
- Early users get the product free permanently in exchange for feedback (alpha/beta).
- Name undecided (Indian vs English) — keep "ExtraWork" as the working name everywhere and do
  not invent a new one.

## You own

- `apps/web/src/app/page.tsx` (and any new `apps/web/src/components/landing/*` you create); you
  may append a clearly labelled `/* --- Slice E: landing --- */` section at the very end of
  `globals.css`.
- `README.md`, `CLAUDE.md` (the "What this is" section and a short new bullet list of the
  three-party invariants — keep everything else intact), new docs files.

Do NOT edit any other application code.

## Build

1. **Landing page.** Load and follow the `frontend-design` skill before writing it. Keep the
   existing behaviour: a signed-in visitor is redirected to `/app/dashboard`; no third-party
   scripts or external assets; fonts and tokens from the existing design system (it has a
   distinctive "drafting schedule sheet" language — extend it, don't replace it with a generic
   SaaS template). Audience: an interior designer or architect in an Indian metro running several
   residential projects, reading on a phone. Sections, roughly: a headline that says what it is
   in one breath (organisation for every project; every change approved before it is billed);
   the three parties and how they connect (designer at the centre, construction company and
   homeowner sending things over WhatsApp, designer reviewing before the client decides) as a
   simple inline SVG or CSS diagram that works in narrow viewports; what is inside a project
   (folders and files, numbered requests, timeline, team); how WhatsApp works for site teams and
   homeowners (one message; "which project?" only if needed; files saved to the project); the
   approval record as a side benefit (frozen, timestamped, downloadable) — stated plainly, no
   legal promises (keep the existing "not a licensed e-signature" honesty); "Free for founding
   firms during the beta" with sign-up and sign-in calls to action; the existing line about
   customers opening an approval link without an account; footer with the legal links
   (`SiteFooter` component already exists — check how it is used). Copy rules: concrete and
   plain, short sentences, Indian English spelling (organise, colour), rupee examples where
   helpful (₹), no hype words ("seamless", "revolutionary", "supercharge", "unlock"), no
   em-dash-as-decoration, no fake testimonials, logos, statistics or customer names. Typecheck
   `apps/web`, lint, format.
2. **`docs/workflows.md`.** The notes' to-do list asks for workflows/flowcharts. Write Mermaid
   flowcharts (GitHub renders them) plus short prose for: starting a project; the change-request
   lifecycle (raised on WhatsApp / by a collaborator / by the homeowner on the portal / by the
   designer → designer review → sent → approved / declined / change requested → invoiced);
   WhatsApp message handling (identify sender → commands → which project (explicit, sticky,
   single, ask) → request or file/note → act → notify → reply with a one-word correction); and a
   point-of-view section for each role — designer/architect (primary user), construction company
   owner, foreman/site employee, homeowner, collaborating architecture firm — what they see, what
   they can do, through which channel. Include the RACI table from the spec. Base every statement
   on the spec; where the spec is silent, say "to be decided" rather than inventing behaviour.
3. **`docs/ExtraWork_Product_Brief_v3.md`.** The product brief rewritten for the new direction,
   same structure as `docs/ExtraWork_Product_Brief.md` (what it is, underlying idea, who uses it,
   end-to-end workflow, core value, MVP scope, later expansion, what it deliberately is not),
   plus a short "What changed from v2" section. Add one line at the top of the v2 brief and of
   `docs/ExtraWork_Startup_Overview.md`: "> Superseded in part by
   `ExtraWork_Product_Brief_v3.md` (October 2026): the primary user is now the designer or
   architect; see that document." Do not otherwise rewrite the founder's startup overview.
4. **`README.md` and `CLAUDE.md`.** Update the opening description, the core journey (now the
   three-party flow), the architecture table if new packages/areas matter, the "Deliberately
   deferred" table (Drive sync, file editing, marketplace, ads/affiliates, push notifications)
   and the launch gates (live WhatsApp, hosting, counsel; payments now "not needed during the
   free beta"). Keep the existing honesty and tone; do not claim features the spec lists as not
   done.

## Done means

`apps/web` typecheck, `pnpm lint` and `pnpm format:check` clean; docs render as valid Markdown
with valid Mermaid; everything committed.
