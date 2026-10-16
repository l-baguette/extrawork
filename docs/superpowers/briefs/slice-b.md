# Slice B — Requests that route through the designer

Worktree: `/home/claude/wt-b` · branch `feat/ws-b-requests` · reserved migration number if you
need one: `0025_b_<what>.sql`.

Read `/home/claude/briefs/common.md` first. This slice implements spec decisions D4, D8, D9, the
Tier 1 B (invoiced mark) and Tier 1 C (paste-to-draft) designs from
`docs/superpowers/specs/2026-09-14-tier-1-pilot-readiness-design.md` (sections B and C — follow
them, adapted as below), and the "requests", "contract value history", "project closure" and
"requests tab" parts of the notes.

## You own

- Domain: `packages/domain/src/canonical/snapshot.ts`, `numbering/`, `change-orders/validate.ts`,
  `intake/parse-message.ts` (room / work-category extraction only — slice D later adds message
  classification in a NEW file).
- DB: `packages/db/src/repositories/change-orders.ts`, `projects.ts`, `reporting.ts`.
- Application: `packages/application/src/change-orders/*`, `projects/service.ts`,
  `approvals/decide.ts` (decision notification only), `evidence/*` only if a snapshot field
  change requires it.
- API: `apps/api/src/routes/change-orders.ts`, `projects.ts`, `reports.ts`, `intake.ts` (fill
  the stub), `apps/api/src/openapi/paths/requests.ts`.
- Web: `apps/web/src/features/composer/**` except `attachment-picker.tsx` and
  `attachment-upload.ts` (slice C changes their type lists), `apps/web/src/app/(app)/app/changes/**`,
  `.../projects/[id]/page.tsx`, `.../projects/[id]/requests/**`, `.../projects/[id]/changes/**`,
  `.../projects/[id]/layout.tsx`, `.../app/requests/**`, `.../app/dashboard/**`,
  `.../app/reports/**`, `apps/web/src/app/r/**` only if the customer page must show room/type.
- Tests for all of the above.

Do NOT edit: collaboration/invitation/site-team/settings code (slice A), files/folders/timeline
code and the new-project form (slice C), WhatsApp intake service and worker inbound job (slice D,
next wave — but keep `IntakeService` compiling and its existing tests green if your changes
touch shared signatures).

## Build

### Domain

- Snapshot: `scope.room` and `scope.workCategory` emitted ONLY when non-null, so every existing
  snapshot and digest is byte-identical. Unit-test both properties (the golden structure test
  must keep passing untouched).
- Numbering (D8): new requests are numbered `${projectNumber}-R${n padded to 2}` — `P-0004-R03`,
  `P-0004-R100`. The per-project sequence already exists; only the format changes. Keep parsing
  of legacy `EW-001` numbers. Update tests that hard-code new-request numbers; never rewrite
  stored numbers.
- `validateDraft` gains an `allowEmpty` option used only for proposals; send gating
  (`collectSendBlockers` and the send service) stays exactly as strict as today.
- Parser: extract `room` (labelled `room:` / `area:` / `location:`, or a conservative
  case-insensitive match of `ROOM_SUGGESTIONS` phrases in the description) and `workCategory`
  (labelled `category:` / `type:` / `work:`, or a keyword map — plumbing/pipe/tap → PLUMBING;
  wiring/switch/socket/point → ELECTRICAL; paint → PAINTING; tile/marble/flooring → FLOORING;
  false ceiling/gypsum/POP → FALSE_CEILING; wardrobe/plywood/shutter/carpentry → CARPENTRY;
  modular kitchen → MODULAR_KITCHEN; AC/duct → HVAC; waterproofing → WATERPROOFING;
  demolish/break → DEMOLITION; brick/plaster/masonry/civil → CIVIL; glass/aluminium →
  GLASS_ALUMINIUM; grill/MS/fabrication → FABRICATION; sofa/furniture → FURNITURE). Ambiguity
  → null, never a guess. All existing parser tests keep passing; add tests.

### DB

- Versions read/write `room`, `work_category`, review provenance (`submitted_for_review_at`,
  `submitted_by_user_id`, `submitted_by_contact_id`, `submission_note`, `reviewed_at`,
  `reviewed_by_user_id`), invoicing columns, `origin`, `raised_by_employee_id`.
- Summaries return every field `ChangeOrderSummarySchema` now has (`room`, `workCategory`,
  `projectNumber`, `origin`, `awaitingReview`, `submittedByLabel`, `invoicedAt`).
  `submittedByLabel`: site-team member → "Name · Company" (company only if set); user →
  display name (+ " · company" from their membership for collaborators); contact →
  "Name (homeowner)". Null when the designer raised it themselves.
- Bucket filters `REVIEW` / `DRAFT` / `UNBILLED` already exist; keep them correct.
- Projects: `description` on create/update/find; `awaitingReviewCount` on the project DTO and
  summaries; `city`/`expectedCompletionDate` on summaries; reopen a closed project;
  contract history (baseline + each amendment from `baseline_versions`, each APPROVED version by
  `decided_at`, running total; deductions negative).
- Reporting: `unbilledApprovedTotalMinor`, `unbilledApprovedCount`, `awaitingReviewCount`,
  `awaitingReview` (latest 5) on the dashboard — all respecting project grants exactly like the
  existing figures.

### Application

- `ChangeOrderService.createProposal(ctx, projectId, input: ProposalInput, provenance)` where
  `provenance = { origin: RequestOrigin; raisedByEmployeeId?: string | null;
submittedByContactId?: string | null }` and `submitted_by_user_id = ctx.actor.userId`.
  Authorize `change_order:propose`. Approver = the project's default approver (clear
  VALIDATION_FAILED if missing). Creates a DRAFT with `allowEmpty`; an `amountMinor` becomes
  one priced line (qty 1, unit "lot", tax 0) the designer can rework; title defaults to the first
  line of the description, trimmed to 80 chars; attaches already-uploaded files through the
  existing attachment checks; sets submission fields; audits
  `CHANGE_ORDER_SUBMITTED_FOR_REVIEW`; notifies the project's DESIGNERS (`REQUEST_SUBMITTED`,
  link `/app/changes/{id}`, actor label = submitter), excluding the submitter. This method is
  what slice D will call from WhatsApp intake and the homeowner portal with a system context —
  make it usable with an intake-style context (see how `IntakeService` builds one) and document
  that.
- `raisedByEmployeeId` (paste-to-draft) is validated against that employee's assignment to the
  project (or all-projects) and is only accepted from designer roles.
- Review: the designer edits with the existing draft update (now accepting room/category);
  `send` on a version awaiting review stamps `reviewed_at`/`reviewed_by_user_id` in the same
  transaction and notifies the submitting user (`REQUEST_SENT`) if there is one.
  `dismissProposal(ctx, changeOrderId, reason)` — designer roles (`change_order:cancel`), only
  while awaiting review (`NOT_AWAITING_REVIEW` otherwise): cancels the draft through the existing
  cancel path, stamps reviewed, audits `CHANGE_ORDER_PROPOSAL_DISMISSED`, notifies the submitter
  (`REQUEST_DISMISSED`, body = reason).
- Decisions: when the homeowner decides (`DecisionService`), notify the project's EVERYONE
  audience (`DECISION_RECORDED`) inside the decision transaction. Do not change anything else
  about decisions.
- Invoicing (Tier 1 B, per that spec, with action `change_order:invoice` which the foundation
  granted to OWNER/ADMIN/FINANCE): mark/clear on APPROVED only, gated by `requireWrite`, audited
  with `CHANGE_ORDER_INVOICED` / `CHANGE_ORDER_INVOICE_CLEARED`.
- Paste-to-draft (Tier 1 C): `POST /v1/intake/parse` read-only, composing the parser, validation
  and `matchProject` over projects the actor can access; the UI then creates a proposal with
  `pasted: true` → origin `PASTED`.
- Project: reopen (`project:close` authorizes both directions; audit `PROJECT_REOPENED`),
  contract history, description.

### API

`POST /v1/projects/:id/proposals`, `POST /v1/change-orders/:id/dismiss`,
`POST/DELETE /v1/change-orders/:id/invoicing`, `POST /v1/intake/parse`,
`GET /v1/projects/:id/contract-history`, `POST /v1/projects/:id/reopen`; the change-order detail
DTO carries `room`, `workCategory`, `submission`, `invoicing`; list accepts `workCategory`.
`/v1/dashboard` must answer collaborators sensibly: it uses `report:read`, which collaborators do
not have — either make it work for project-scoped collaborators (preferred: only the queue
figures, scoped to their grants) or have the page fall back, and test whichever you choose.

### Web

- Composer: room (text input + `<datalist>` of `ROOM_SUGGESTIONS`), type of work (select of
  `WORK_CATEGORY_LABELS`), relabel the reason as the justification ("Why is it needed?").
  The composer today only edits the browser-local draft; add loading an existing server draft
  via `?changeOrderId=` (GET the change order, then PATCH it) so a proposal raised on WhatsApp
  can be reviewed, priced and sent in the composer, with a banner naming who raised it and their
  note. Update "Continue editing this draft" links to pass the id.
- `projects/[id]/changes/new/page.tsx` now renders inside the project layout, which already
  provides `<main>`: change its outer `<main>` to a `<div>`.
- Change detail: room, type of work, who raised it and how (origin); for a request awaiting
  review, designer actions "Review & price" (composer with id) and "Dismiss" (with reason);
  invoiced mark/clear on approved requests for roles that may.
- Raise-a-request form for collaborators (and anyone with `propose`):
  `/app/projects/[id]/requests/new` — description, room, type of work, justification, optional
  amount and days, photos/files (reuse the composer's upload helpers
  `features/composer/attachment-upload.ts` + `attachment-client.ts`, purpose
  CHANGE_ATTACHMENT), note. The project layout's primary button must send collaborators here and
  designers to the composer (the layout can read `/v1/auth/me` and the membership role for the
  active org).
- Requests overview (`/app/requests`, foundation version exists): keep the tabs; add the
  "Paste a WhatsApp message" card on the Needs review tab (textarea, project select, raised-by
  select from that project's site team → parse → show what was read and what is missing →
  "Create request for review"); a type-of-work filter.
- Project Requests tab: `RequestStatusChip`, room and type columns, review items first, a
  "Raise a request" button.
- Project overview: contract value history (date, what changed, amount, running total) under
  the contract value card; Close / Reopen project for designers (closing needs a reason).
- Dashboard: a "Needs review" block first (the designer's actual queue), then waiting on the
  customer, then recent decisions; the unbilled figure is already wired; collaborators see a
  sensible version (their projects and their raised requests) instead of an error.
- Reports: the unbilled ledger with inline "Mark invoiced" (+ optional reference) and "Clear".

## Done means

Typecheck clean for every package you touched, lint and format clean, the new and updated tests
pass, the broad suite passes (minus the two known golden failures), `pnpm openapi` regenerated,
everything committed.
