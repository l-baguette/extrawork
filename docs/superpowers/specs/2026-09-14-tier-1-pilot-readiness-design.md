# Tier 1 — Pilot readiness

**Date:** 14 September 2026
**Branch:** `fix/whatsapp-delivery-and-templates`
**Status:** approved design, not yet implemented

## Why these three

ExtraWork's four remaining launch blockers — live WhatsApp, hosting, payments,
counsel — are all external. None of them blocks a pilot as much as it appears
to, because native share is the designed MVP delivery path (report §10.3 Phase
0): the contractor sends the approval link from their own number, and the
system records `SHARE_INTENT_OPENED`. Outbound to the customer already works
with no Meta dependency. What Cloud API actually unlocks is inbound employee
intake.

So the loop that can run today is: owner composes on the dashboard → shares on
their own WhatsApp → customer decides → evidence PDF. These three changes make
that loop usable by a real contractor.

| #   | Change                                | Why it is Tier 1                                                                                                                                                                        |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Photo attachments in the composer     | A change order without a site photograph is half the evidence, and the product brief names photographs as core. The entire server pipeline exists; only the browser cannot pick a file. |
| B   | Unbilled ledger with an invoiced mark | The screen that makes an owner pay, and the one that proves the product returned money. It also corrects a dashboard figure that is currently wrong.                                    |
| C   | Paste-to-draft                        | Delivers employee intake now, with no Meta account, by reusing the intake parser that already exists and is tested.                                                                     |

## Decisions taken before this design

1. **Invoiced mark records a toggle plus an optional invoice reference and
   date.** Not a plain toggle, not bulk marking. "Which invoice was this on?"
   is the question actually asked six months later.
2. **A pasted request is attributable to an employee.** The owner picks who
   raised it from the employees assigned to that project.
3. **Missing photographs warn at preview but never block a send.** A time-only
   or purely commercial change legitimately has no photograph.
4. **The invoiced mark lives on `change_order_versions`, not in a new table.**
   See section B.

## A. Photo attachments in the composer

### What already exists

Verified present and working end to end on the server side. None of it changes.

| Capability                                               | Location                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Presigned upload into quarantine                         | `POST /v1/uploads` → `apps/api/src/routes/files.ts`                                                |
| Upload allowlist and size caps                           | `ALLOWED_UPLOAD_MIME_TYPES`, `MAX_FILE_BYTES` in `packages/contracts/src/api/files.ts`             |
| Magic-byte type detection                                | `packages/files/src/validation.ts`                                                                 |
| Scan, decode, re-encode, EXIF/GPS strip, WebP derivative | `packages/files/src/scanner.ts`                                                                    |
| Completion and scan enqueue                              | `POST /v1/uploads/complete`                                                                        |
| Scan status and download URL                             | `GET /v1/files/:id`                                                                                |
| Attach and detach                                        | `POST /v1/change-orders/:id/attachments`, `DELETE /v1/change-orders/:id/attachments/:attachmentId` |
| Persistence with position and caption                    | `version_attachments` (migration 0001)                                                             |
| Freeze after send                                        | `version_attachments_freeze_guard()` (migration 0003)                                              |
| Send gating                                              | `ATTACHMENT_NOT_READY` / `ATTACHMENT_REJECTED` in `packages/domain/src/change-orders/validate.ts`  |
| Customer-facing rendering                                | `apps/web/src/app/r/[token]/request-summary.tsx`                                                   |

The gap is exactly one thing: there is no `<input type="file">` anywhere in
`apps/web/src`, and `attachmentIds` in the composer schema is hardcoded to an
empty array.

### What changes

**New component — `apps/web/src/features/composer/attachment-picker.tsx`.**

- `<input type="file" multiple>` with `accept` built from
  `ALLOWED_UPLOAD_MIME_TYPES`. Deliberately no `capture` attribute, so a mobile
  browser offers both the camera and the gallery instead of forcing the camera.
- Pre-flight each file in the browser against `ALLOWED_UPLOAD_MIME_TYPES` and
  `MAX_FILE_BYTES`, both already exported from `@extrawork/contracts`, which
  `apps/web` is permitted to import. A file that cannot succeed is rejected
  with a readable message rather than a 400 from the API.
- Compute SHA-256 with `crypto.subtle.digest` and send it as the optional
  `sha256` field the upload contract already accepts. The server re-verifies
  it, so this is a free end-to-end integrity check.
- Upload sequence per file: `POST /v1/uploads` → `fetch(uploadUrl, {method,
headers, body: file})` → `POST /v1/uploads/complete` → poll `GET /v1/files/:id`
  with backoff until `scanStatus` leaves `PENDING`/`SCANNING`.
- Per-file state chip: Uploading → Checking → Ready, or Rejected / Failed.
  A local `URL.createObjectURL` thumbnail renders immediately so a site phone
  shows something before any round trip completes.
- Remove: `DELETE /v1/change-orders/:id/attachments/:attachmentId` once
  attached; before that, drop it from local state.

**Composer integration — `apps/web/src/features/composer/composer.tsx`.**

- The picker renders inside step 1 ("what changed"). Uploading as early as
  possible maximises the time a scan has to finish before the send gate in
  step 4.
- The composer creates the change order lazily: the first autosave `POST`s
  `/v1/projects/{projectId}/change-orders` and later saves `PATCH`
  `/v1/change-orders/{id}/draft`. So there is a window in which files are
  chosen and no version exists to attach them to. The picker calls an
  `ensureChangeOrderId()` callback that flushes a save and resolves the id,
  holding files in local state until it does.
- Step 4 renders the non-blocking warning when no attachment is present: the
  record has no photographic evidence, and can still be sent.
- The send button stays disabled while any file is unsettled, with the reason
  shown. This mirrors the server rule rather than letting the user discover it
  as an error.

**Offline.** `saveDraft` deliberately returns no id when offline, because
report §6.8 permits offline draft edits and forbids offline sends. An upload
needs the network and a `File` cannot be serialised into the local draft store,
so the picker is disabled while offline with an explanatory line, and typing
continues to work. Queueing uploads across a reload is out of scope.

### Tests

- Unit: the pre-flight function (type allowlist, size cap, hash) — pure, no DOM,
  in `tests/unit/`.
- E2E: one Playwright spec covering pick → upload → scan settles → send
  succeeds, and a rejected file blocking the send.

## B. Unbilled ledger

### The problem

`packages/db/src/repositories/reporting.ts` computes
`projectsWithUnbilledApprovedExtras` as
`count(DISTINCT project_id) WHERE status = 'APPROVED'` — every project that has
ever had an approved extra. The dashboard labels it "Approved extras not yet
invoiced". There is no invoiced concept anywhere in the schema, so the number
can never go down.

### Where the mark lives

On `change_order_versions`, as columns outside the freeze allowlist — following
the precedent already set for `origin` and `raised_by_employee_id`, documented
at `packages/db/src/repositories/change-orders.ts:803-810`: these are
_provenance, not terms_, they sit outside the canonical snapshot on purpose so
the digest the customer agreed to does not change, and migration 0013's
`versions_freeze_guard()` freezes only the listed terms columns.

An invoiced mark is the same category: bookkeeping about the record, not a term
of it, and not part of the snapshot. Following the existing pattern avoids a new
table, a new RLS policy (migration 0019 enumerates tenant tables explicitly), a
new tenant-bound composite foreign key, and a new repository.

The mutable column carries current state; the append-only audit chain carries
the history of who claimed what. That combination gives the same guarantee a
separate table would, with a materially smaller change.

### What changes

**Migration — invoiced marks** (number assigned at implementation time in
build order; `0020` if B ships first) adds to `change_order_versions`:

| Column                | Type                        | Meaning                                        |
| --------------------- | --------------------------- | ---------------------------------------------- |
| `invoiced_at`         | `timestamptz` null          | When the owner marked it billed                |
| `invoice_reference`   | `text` null                 | Free text, the contractor's own invoice number |
| `invoiced_by_user_id` | `uuid` null, FK `users(id)` | Who marked it                                  |

These are not added to `versions_freeze_guard()`. The migration carries a
comment stating why, in the same terms as the `markIntakeOrigin` rationale, so
the next person extending the guard does not add them by reflex.

**Audit events** — new codes in `packages/contracts/src/events.ts`, following
the existing `CHANGE_ORDER_X: 'change_order.x.v1'` convention:

- `CHANGE_ORDER_INVOICED: 'change_order.invoiced.v1'`
- `CHANGE_ORDER_INVOICE_CLEARED: 'change_order.invoice_cleared.v1'`

Each is appended to the aggregate's hash chain with the reference and the
acting user.

**API** — `apps/api/src/routes/change-orders.ts`:

- `POST /v1/change-orders/:id/invoicing`, body `{invoiceReference?: string}`
- `DELETE /v1/change-orders/:id/invoicing`

Both require a new `change_order:invoice` action in
`packages/domain/src/authz/policy.ts`, restricted to owner and admin roles.
Both reject unless the current version status is `APPROVED`. Both are writes and
are therefore gated by the `readOnly` entitlement like every other write, via
`app.requireWrite`.

**Reporting** — `packages/db/src/repositories/reporting.ts` replaces
`projectsWithUnbilledApprovedExtras` with:

- `unbilledApprovedTotalMinor`: `SUM(total_delta_minor)` over `APPROVED`
  versions where `invoiced_at IS NULL`
- `unbilledApprovedCount`: the number of such changes

`packages/contracts/src/api/projects.ts` changes shape accordingly, and
`pnpm openapi` is regenerated.

**Web:**

- `apps/web/src/app/(app)/app/dashboard/page.tsx` — the tile becomes a rupee
  figure with the count beneath it, replacing the project count.
- `apps/web/src/app/(app)/app/reports/page.tsx` — a list of approved,
  not-yet-invoiced changes with an inline mark action that takes the optional
  reference, and the ability to clear a mark.

### Known limitations, accepted

- The sum assumes the organization's default currency. Mixed-currency reporting
  is already on the Medium remediation backlog and is not addressed here.
- A lapsed subscription blocks marking, consistent with every other write. This
  does mean a contractor cannot tidy their ledger while deciding whether to
  renew. Revisit if a pilot complains.

### Tests

- Integration, real PostgreSQL: mark and clear; the `APPROVED`-only rule; tenant
  isolation on the new columns; the reporting sum before and after a mark;
  the freeze guard still rejecting a terms-column edit on the same row.
- Unit: the authz rule for `change_order:invoice`.

## C. Paste-to-draft

### Constraint

`parseIntakeMessage` and `validateIntake` live in
`packages/domain/src/intake/parse-message.ts`, and `eslint.config.mjs` bars
`apps/web` from importing `@extrawork/domain`. The parse therefore happens
server-side behind a new endpoint. This is the correct layering, not a
workaround.

### What changes

**Contracts** — new `packages/contracts/src/api/intake.ts`:

- `ParseIntakeRequestSchema`: `{text: string, projectId?: uuid}`
- `ParseIntakeResponseSchema`: the parsed fields, `missing`, `problems`, and the
  resolved project match. Money crosses the wire in minor units following the
  existing convention in `packages/contracts/src/api/common.ts`.

**API** — `POST /v1/intake/parse`, authenticated, rate-limited, and read-only.
It creates nothing: the owner reviews the reading before anything is written.
It composes `parseIntakeMessage`, `validateIntake` and the existing project
matcher in `packages/domain/src/intake/match.ts`.

**Attribution** — `raisedByEmployeeId` is accepted by the change-order create
and draft paths, validated against that employee's assignment to the project,
and written to the existing `change_order_versions.raised_by_employee_id`. This
is the same column WhatsApp intake populates, so reports answer "who raised
this" identically however the request arrived. `origin` today allows `WEB` (the default), `WHATSAPP` and `IMPORT`
under a CHECK constraint added in migration 0005; this work extends that
constraint with `PASTED`, so a pasted request stays distinguishable from one
typed from scratch.

**Web** — a "Paste a message" card on `apps/web/src/app/(app)/app/requests/page.tsx`,
the page that already exists for inbound requests and where live WhatsApp
intake will land later, so the two converge rather than compete.

- Textarea, project select, raised-by employee select.
- Shows what was read and what is missing, then "Open in composer".
- Handoff uses the existing local draft store in
  `apps/web/src/features/composer/draft-store.ts` rather than new query-param
  plumbing.

### Tests

- Parser unit coverage already exists in `tests/unit/intake-parse.test.ts` and
  is not duplicated.
- New unit: response mapping, including the ambiguous-amount case that must
  surface as a problem rather than a number.
- New integration: a paste attributing to an employee not assigned to that
  project is rejected; a valid one persists `raised_by_employee_id` and
  `origin = 'PASTED'`.

## Sequencing

**A → C → B.**

A and C both modify `composer.tsx`, which is already 768 lines; doing them
adjacently avoids two passes, and both the picker and the raised-by field are
extracted as their own components rather than growing that file further. B is
independent of both and can move first if the ROI screen is wanted for demos
sooner.

B and C each add one migration — the invoiced columns, and the extended
`origin` CHECK constraint. Numbers are assigned in build order at implementation
time rather than reserved here, so they cannot go stale if the order changes.

Each feature is verified with `pnpm verify`, plus `pnpm openapi` where a route
schema changed. B and C need a real PostgreSQL for their integration tests.

## Out of scope, deliberately

- Attaching photographs from the change-detail page (composer only for now).
- A lightbox or gallery on the customer approval page.
- Bulk invoice marking across a project.
- Any accounting or GST integration.
- Mixed-currency reporting.
- Queueing uploads while offline.
- Routing pasted text through the full intake service with employee phone
  authorization, spend ceilings and inbound provenance.
