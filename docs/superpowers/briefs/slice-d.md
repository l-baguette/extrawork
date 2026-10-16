# Slice D — Homeowner portal and WhatsApp as a project channel

**Status: not started.** Written 13 October 2026 as part of the handoff. It was planned to run
after slices B and C merged, because it calls their services.

Branch suggestion: `feat/ws-d-portal-whatsapp`, cut from the integration branch AFTER slices A,
B and C are merged into it. Reserved migration number if you need one: `0027_d_<what>.sql`.

Read `common.md` first (in the same folder). It covers the conventions, the environment and how
to commit. This slice implements spec decisions D5 and D6, plus the WhatsApp half of D7, from
`docs/superpowers/specs/2026-10-12-three-party-workspace-design.md`. It also covers these parts
of the notes:

- "customer can request all past contracts by sending a message";
- "if anything is forwarded/sent to the chat … it's saved to the project and shown to the
  architect as a notification";
- "simplify which project someone wants to add something to … and whether they want to send a
  request or just add something to the drive";
- "homeowner can also access if they want to see all changes/records".

## Depends on (must already be merged)

- **Slice B:** `ChangeOrderService.createProposal(ctx, projectId, input, provenance)` with an
  intake-style system context; `RequestOrigin` `WHATSAPP` and `PORTAL`; the `REVIEW` bucket.
- **Slice C:** `WorkspaceRepository.ensureDefaultFolders` / `systemFolderId(…, 'WHATSAPP')`, the
  service that adds a FILE or NOTE document, the broader file validation, and client-visible
  folder rules (folder visibility `CLIENT`).
- **Slice A:** site-team fields (`party`, `company_name`, `team_role`), and the phone number
  being unique per organization only.

## You own

- `packages/db/src/repositories/{portal,conversations}.ts` (fill the foundation stubs);
  `employees.ts` gets a `findAllByPhone` and `contacts` lookups by phone (system scope,
  documented); `inbound-messages.ts` gets `media_refs`, `contact_id`, `document_id` and
  `resolved_by_inbound_message_id` writes, plus the new statuses.
- `packages/application/src/portal/service.ts` (fill) and `packages/application/src/intake/*`.
- New pure domain module `packages/domain/src/intake/classify.ts` for request-vs-content
  classification and command detection. Do not restructure `parse-message.ts`; slice B owns it.
- `packages/domain/src/intake/replies.ts` for the new reply texts.
- `apps/api/src/routes/portal.ts` and `apps/api/src/openapi/paths/portal.ts`; the simulator
  route (`apps/api/src/routes/simulator.ts`) and its page (`apps/web/src/app/simulator/**`).
- `apps/worker/src/jobs/inbound.ts` (media handling).
- Web: `apps/web/src/app/p/[token]/**` (new portal page), and the homeowner-portal slot on the
  project Team tab that slice A left as `{/* Slice D: homeowner portal access */}`.
- Tests for all of the above, and updates to `tests/integration/intake-service.test.ts` and
  `inbound-intake.test.ts`. Those tests assume auto-send. Set the organization's
  `request_routing` to `AUTO_SEND` where a test is about that path, and add new tests for the
  default `DESIGNER_REVIEW` path.

## Build

### Homeowner portal (D5)

- **Repository:**
  - Create a link: 32 random bytes via the existing opaque-token helper, SHA-256 only, issued to
    a contact of the project's customer, `validDays` 1–365 (default 90).
  - List a project's links; revoke a link.
  - A system-scoped `findByTokenHash` that returns the org and project ids. It must refuse links
    that are expired or revoked, and links whose project's org is CLOSED.
  - Record views: `last_viewed_at` and `view_count`.
- **Service:**
  - `createLink` with the `portal:share` action, plus `listLinks` and `revokeLink`. Audit
    `PORTAL_LINK_CREATED` and `PORTAL_LINK_REVOKED`.
  - `createLink` returns the URL once (`${WEB_PUBLIC_URL}/p/{token}`), a wa.me share URL to the
    contact's number, and the message text.
- **Public projection** `GET /public/v1/portal/:token` (`PortalViewSchema`):
  - project summary;
  - contract history: reuse slice B's contract-history computation;
  - every request that was ever SENT, using its latest sent version. Never drafts and never
    proposals still with the designer;
  - `evidenceReady`;
  - documents in CLIENT folders only;
  - milestones with `client_visible`.
  - Response headers and rendering rules exactly like `/r/{token}`: no-referrer, noindex, no
    third-party scripts, server-rendered.
  - Rate-limit it like the public approval routes.
- **Downloads** `GET /public/v1/portal/:token/documents/:id`:
  - client-visible CLEAN files, or a READY evidence PDF of one of that project's requests;
  - a short-lived signed URL with attachment disposition.
- **Ask for a change** `POST /public/v1/portal/:token/requests` (`PortalChangeRequestSchema`):
  - creates a proposal through slice B's `createProposal`, with origin `PORTAL` and
    `submittedByContactId` set to the link's contact;
  - uses a system context like intake builds;
  - is rate-limited per token;
  - returns the new number and a plain message.
- **Web:**
  - `/p/[token]` is a phone-first page. It shows the project, its contract value and history,
    requests with status chips and evidence downloads, "Files from your designer", milestones,
    and an "Ask for a change" form. Expired or revoked links get a plain explanation.
  - On the project Team tab, a homeowner-access card lists links (contact, created, views,
    expiry, revoke) and has a "Share with homeowner" button that offers "Send on WhatsApp" and
    "Copy link".

### WhatsApp as a project channel (D6)

Follow the spec's "WhatsApp conversation rules" section exactly.

1. **Identify the sender.** Find every ACTIVE site-team row with that phone across
   organizations, and every customer contact with that phone across organizations. Use system
   scope and say why in a comment. The candidate projects are:
   - for a site-team member: their assigned projects, or all of them if `all_projects`;
   - for a contact: every ACTIVE project of their customer.
     If there are none, keep today's unknown-sender reply.
2. **Commands** (the whole message, case-insensitive):
   - `help`;
   - `projects` (numbered list);
   - `contracts` / `records` / `history`. For a contact, mint a fresh portal link per project
     (created via WHATSAPP) and reply with the links. For site team, list open requests;
   - `status`;
   - `request` / `file`, which converts the last item;
   - a bare number or a project code while a choice is pending.
3. **Pick the project.**
   - An explicit project number or title match (reuse `matchProject`) comes first.
   - Then the sticky project from `whatsapp_conversations` (2 hours) if it is still a
     candidate.
   - Then the only candidate.
   - Otherwise reply with a numbered list. Store `pending` (inbound message id, candidates,
     expiry 30 minutes) and set the inbound row to `AWAITING_CHOICE`. When the answer arrives,
     process the original message against the chosen project and set
     `resolved_by_inbound_message_id`.
   - An expired choice gets a polite reply and a `WHATSAPP_ATTENTION` notification to the
     candidate projects' designers.
4. **Classify** (pure module, unit-tested). It is a request if any of these are present:
   - a price;
   - a days/time impact;
   - request field labels;
   - change language ("can we", "please add", "instead of", "extra", "change", "shift",
     "replace", "remove").
     Otherwise it is content. Media without request language is content.
5. **Act.**
   - A request becomes `createProposal` with origin WHATSAPP and either `raisedByEmployeeId` or
     `submittedByContactId`. Under `request_routing = AUTO_SEND`, a complete request from a
     site-team member within their ceiling keeps today's direct create-and-send path.
   - Content goes into the project's WHATSAPP system folder: text becomes a NOTE, media becomes
     FILEs. Set the inbound row to `SAVED` with `document_id`.
6. **Notify** the project's DESIGNERS. Slice B and slice C's services already do this; do not
   double-notify.
7. **Reply.** Say what happened, and always offer the one-word correction ("Reply REQUEST if
   this was a change you need" / "Reply FILE if this was just for the record"). Converting
   undoes the first action: a proposal is dismissed, or a document is soft-deleted, and the
   reverse is created.

**Media.** At record time, store the provider media references in `inbound_messages.media_refs`.
The worker's `storeInboundMedia` fetches into the organization the message resolved to. It then
either attaches to the proposal's version (CHANGE_ATTACHMENT, existing quarantine and scan) or
registers PROJECT_DOCUMENT files in the WHATSAPP folder. For a message that was held for a
choice, fetch after resolution, from the stored refs.

**Simulator.** Let the simulator page pick a sender (site-team member or customer contact) and
attach a small image or PDF. The simulator route accepts base64 media (≤ 2 MB, development
only), so the whole flow can be demonstrated without Meta.

Keep the existing guarantees:

- every inbound message is logged before anything else;
- idempotency on the provider message id;
- the retryable-error checkpoint;
- never fetching media for an unknown sender.

## Done means

- Typecheck clean for every package touched.
- Lint and format clean.
- New and updated tests pass.
- The broad suite passes, minus the two known golden failures.
- `pnpm openapi` regenerated.
- Everything committed.
