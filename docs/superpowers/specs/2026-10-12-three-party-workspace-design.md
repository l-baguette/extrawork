# Three-party project workspace

**Date:** 12 October 2026
**Branch:** `feat/three-party-workspace` (from `fix/whatsapp-delivery-and-templates` at `1d13ca6`)
**Sources:** "Nithin Uncle Notes" (both documents), ExtraWork Brief, the September Tier 1 spec.
**Status:** approved direction, implemented on this branch.

## Why this exists

The product was built as a two-party change-order ledger that a contractor pays
for: the owner works in a dashboard, field employees text requests that go
straight to the customer, and the customer approves through a link. The notes
change three things at once.

1. **Who it is for.** Interior designers and architects are the primary user.
   The construction company is a collaborator that can also use the platform.
   The homeowner can see the whole record whenever they want.
2. **What it is for.** Organising an unorganised sector comes first; the legal
   record is a side benefit. A project becomes a shared folder: the customer,
   the contract value and its history, the timeline, the people, the drawings,
   spreadsheets and photos, and one dedicated record of every change.
3. **How requests move.** Everything goes through the designer. A contractor or
   homeowner raises a request (usually over WhatsApp, in one low-friction
   message); the designer reviews and completes it; only then does it reach the
   homeowner for a decision. Only the designer makes actual changes.

Nothing here weakens the evidence machinery. Frozen versions, the append-only
audit chain, integer money, atomic decisions and RLS stay exactly as they are;
they become the "approvals and contracts" folder of each project rather than
the whole product.

## Decisions taken

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **A shared project lives in the designer's workspace.** Collaborators from other firms join that workspace with a new `COLLABORATOR` role and a project grant (`project_members`). They switch workspaces from the rail.                                                                                                                                                                 | Sessions, `x-organization-id`, `switch-organization`, project grants and RLS all already support one user in several organisations. A cross-tenant sharing model would have to reopen every RLS policy and tenant-bound foreign key; this reuses them unchanged. |
| D2  | **Two kinds of people on a project.** _Collaborators_ have accounts and use the web app. The _site team_ (the old "employees") is people identified only by their WhatsApp number. One person can be both.                                                                                                                                                                               | The notes ask for both "collaborators (other users)" and "employees/teams on the project". Most site staff will never log in.                                                                                                                                    |
| D3  | **Requests route through the designer by default.** New organisation setting `request_routing`: `DESIGNER_REVIEW` (default) or `AUTO_SEND` (the old behaviour, kept for firms that want it).                                                                                                                                                                                             | "Everything goes through the architect." Keeping `AUTO_SEND` preserves the tested direct path instead of deleting it.                                                                                                                                            |
| D4  | **A proposal is a DRAFT version with review provenance**, not a new status. `submitted_for_review_at` set and `reviewed_at` null means "awaiting the designer". Proposals may be incomplete (no price yet); send gating still applies.                                                                                                                                                   | The state machine, freeze guard and transition trigger stay untouched. A contractor who doesn't know the price can still raise the request; the designer fills it in.                                                                                            |
| D5  | **The homeowner gets a no-account project portal link** (`/p/{token}`), read-only plus "ask for a change". It is also what WhatsApp returns when a homeowner asks for "contracts".                                                                                                                                                                                                       | The brief's no-registration principle. Approval tokens are stored as hashes, so old receipt links cannot be regenerated; a fresh portal link can.                                                                                                                |
| D6  | **WhatsApp becomes a project channel, not only a request form.** Senders are site-team numbers _and_ customer contacts. A message is classified as a request or as content (files, notes); content is saved to the project's "From WhatsApp" folder. Multi-project senders are asked which project once, then the choice sticks for two hours. Every reply offers a one-word correction. | One message, no syntax to learn, and the designer is notified of everything. Asking "request or file?" every time would add the friction the notes warn against; classifying and offering a correction does not.                                                 |
| D7  | **The global unique index on employee phone numbers is dropped.** A foreman who works with two design firms can be on both rosters. Ambiguity is resolved by asking, never by guessing.                                                                                                                                                                                                  | The old rule assumed the contractor was the customer; in the new model the same site person routinely works with several designers.                                                                                                                              |
| D8  | **Request numbers carry the project number:** `P-0004-R03` is the third request on project P-0004. Existing numbers are untouched.                                                                                                                                                                                                                                                       | The notes ask for an ID "based on the project and how many requests were made before". The sequence was already per project; only the format changes.                                                                                                            |
| D9  | **Room and type of work are part of the frozen record.** They are added to the snapshot's `scope` object only when present, so existing snapshots and their digests are unchanged; both are added to the freeze guard.                                                                                                                                                                   | They describe the scope the homeowner agrees to.                                                                                                                                                                                                                 |
| D10 | **Files: a safe broad allowlist, not "any type".** Images, PDF, `.xlsx/.docx/.pptx`, CSV/TXT, DWG/DXF. Legacy macro-capable `.xls/.doc` are refused with "save as .xlsx/.docx". Every file is stored privately and downloaded as an attachment, never rendered.                                                                                                                          | "Any type" would make the platform a malware relay. This covers plans, BOQs, quotes and photos.                                                                                                                                                                  |
| D11 | **Storage is per workspace, 2 GiB in beta**, not 10 MB per user.                                                                                                                                                                                                                                                                                                                         | 10 MB is three phone photos.                                                                                                                                                                                                                                     |
| D12 | **Google Drive is linked, not synced.** A project can hold links (Drive, Dropbox, OneDrive or any https URL) in any folder.                                                                                                                                                                                                                                                              | Sync needs a Google Cloud project, OAuth verification for Drive scopes and a background sync job; a link covers "link to Google Drive if needed" today.                                                                                                          |
| D13 | **New workspaces start on a free `BETA` plan** with generous limits. Paid plans and Razorpay stay in the code, dormant.                                                                                                                                                                                                                                                                  | Early users get free access; monetisation "not priority at all".                                                                                                                                                                                                 |
| D14 | **Reminders: in-app and email, plus a private calendar feed (ICS).** Subscribing in Google/Apple Calendar gives phone notifications for completion dates without building push notifications.                                                                                                                                                                                            | "Sends notifications if enabled, reminding of completion dates."                                                                                                                                                                                                 |
| D15 | **The Tier 1 "invoiced" mark and paste-to-draft ship here too**, as designed on 14 September, adapted to the review flow (a pasted message becomes a proposal).                                                                                                                                                                                                                          | Both were approved and not built; paste-to-draft is exactly the designer turning a contractor's WhatsApp message into a request.                                                                                                                                 |

## Roles and RACI

Membership roles (`membership_role`): `OWNER`, `ADMIN`, `PROJECT_MANAGER`
(shown as **Designer**), `FINANCE` (shown as **Accounts**), `VIEWER`, and new
`COLLABORATOR`. A collaborator's membership also records their **party**
(`CONSTRUCTION`, `ARCHITECT`, `CONSULTANT`, `HOMEOWNER`, `OTHER`) and company.

| Capability                                | Owner/Admin | Designer (PM) | Accounts | Viewer  | Collaborator |
| ----------------------------------------- | :---------: | :-----------: | :------: | :-----: | :----------: |
| See granted projects, requests, timeline  |     all     |    granted    |   all    | granted |   granted    |
| Raise a request for review (`propose`)    |      ✓      |       ✓       |          |         |      ✓       |
| Edit, price, send, dismiss a request      |      ✓      |       ✓       |          |         |              |
| Upload files, add links and notes         |      ✓      |       ✓       |          |         |      ✓       |
| Rename/move/delete files, manage folders  |      ✓      |       ✓       |          |         |              |
| Invite/remove collaborators, share portal |      ✓      |       ✓       |          |         |              |
| Milestones                                |   manage    |    manage     |   read   |  read   |     read     |
| Customers, site team roster, reports      |      ✓      | read/limited  |   read   |  read   |              |

Each project's Team tab shows a RACI matrix generated from the people actually
on the project:

| Activity                        | Designer firm | Construction | Homeowner |
| ------------------------------- | :-----------: | :----------: | :-------: |
| Raise a change request          |       R       |      R       |     R     |
| Review, price and send it       |      A/R      |      C       |     I     |
| Approve, decline or revise      |       C       |      I       |    A/R    |
| Carry out the approved work     |       A       |      R       |     I     |
| Keep drawings and files current |      A/R      |      C       |     I     |
| Maintain the project record     |      A/R      |      I       |     I     |

## Data model

All new tenant tables carry `organization_id`, tenant-bound composite foreign
keys (`(organization_id, x_id) → x(organization_id, id)`), and are added to the
`tenant_isolation` RLS policy. Migrations `0020`–`0023`.

### 0020 — collaboration and roles

- `ALTER TYPE membership_role ADD VALUE 'COLLABORATOR'`.
- `memberships` + `collaborator_party text`, `company_name text`.
- `organizations` + `business_type`, `request_routing`, `storage_quota_bytes`.
- `subscriptions.plan_code` CHECK extended with `BETA`.
- `project_invitations` — one row per (email, project) invitation; token stored
  as SHA-256 only; `PENDING → ACCEPTED | REVOKED | EXPIRED`. Acceptance requires
  the signed-in user's email to match.
- `employees` + `party`, `company_name`, `team_role`; drop
  `employees_phone_global_idx`.

### 0021 — requests

`change_order_versions` gains:

- `room text`, `work_category text` (CHECK against the category list) — terms,
  frozen by an updated `versions_freeze_guard()`.
- `submitted_for_review_at`, `submitted_by_user_id`, `submitted_by_contact_id`,
  `reviewed_at`, `reviewed_by_user_id` — provenance, outside the freeze guard.
- `invoiced_at`, `invoice_reference`, `invoiced_by_user_id` — bookkeeping,
  outside the freeze guard (Tier 1 B).
- `origin` CHECK extended: `WEB`, `WHATSAPP`, `IMPORT`, `PASTED`,
  `COLLABORATOR`, `PORTAL`.

`projects` gains `description text`.

### 0022 — project workspace

- `project_folders` — name, position, `visibility` (`INTERNAL` firm only,
  `PROJECT` firm + collaborators, `CLIENT` also the homeowner portal),
  `system_key` for the defaults. Defaults are created with the project and
  lazily for older projects: Plans & drawings (CLIENT), Contracts & quotes
  (CLIENT), Site photos (PROJECT), Bills & invoices (INTERNAL), From WhatsApp
  (PROJECT). The "Approvals & change records" folder is virtual: the request
  register and evidence packs.
- `project_documents` — `kind` `FILE` | `LINK` | `NOTE`, title, notes, the file
  object or https URL or note body, who added it (user, site-team member or
  customer contact), `source` `WEB` | `WHATSAPP`, soft delete.
- `project_milestones` — title, due date, kind, notes, completed.

### 0023 — notifications, portal, calendar, conversations

- `notifications` — per recipient user; kind, title, body, link, read.
- `notification_preferences` — per (organization, user): email on/off,
  completion reminders on/off, lead days.
- `project_portal_links` — homeowner portal tokens (hash only), issued to a
  contact, expiring, revocable, view counter.
- `calendar_feed_tokens` — private ICS feed per (organization, user).
- `whatsapp_conversations` — per phone number: pending choice, sticky project,
  the last item (for "REQUEST"/"FILE" corrections). System-scoped like
  `inbound_messages`.
- `inbound_messages` + `media_refs jsonb` so media can be fetched after a
  pending choice is resolved.

## API surface (new)

| Route                                                                     | Purpose                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET/POST /v1/projects/:id/collaborators`                                 | List; invite by email (returns a one-time invite URL)        |
| `DELETE /v1/projects/:id/collaborators/:userId`                           | Remove access                                                |
| `DELETE /v1/invitations/:id`                                              | Revoke a pending invitation                                  |
| `GET /v1/invitations/pending`                                             | Invitations addressed to the signed-in user's email          |
| `GET /public/v1/invitations/:token`                                       | Invitation preview (who, which project)                      |
| `POST /v1/invitations/accept`                                             | Accept with the token                                        |
| `GET /v1/projects/:id/workspace`                                          | Folders with documents, quota, linked folders                |
| `POST /v1/projects/:id/folders`, `PATCH/DELETE /v1/folders/:id`           | Manage folders                                               |
| `POST /v1/projects/:id/documents`                                         | Add a file (after upload), link or note                      |
| `PATCH/DELETE /v1/documents/:id`, `GET /v1/documents/:id/download`        | Rename, move, annotate, delete, download                     |
| `POST /v1/projects/:id/proposals`                                         | Raise a request for designer review                          |
| `POST /v1/change-orders/:id/dismiss`                                      | Designer declines a proposal without sending                 |
| `POST/DELETE /v1/change-orders/:id/invoicing`                             | Tier 1 B invoiced mark                                       |
| `POST /v1/intake/parse`                                                   | Tier 1 C paste-to-draft (read-only parse)                    |
| `GET /v1/projects/:id/contract-history`                                   | Baseline amendments and approved changes, with running total |
| `GET/POST /v1/projects/:id/milestones`, `PATCH/DELETE /v1/milestones/:id` | Milestones                                                   |
| `GET /v1/calendar`                                                        | Collated events across accessible projects                   |
| `POST/DELETE /v1/calendar/feed`                                           | Create/revoke the private ICS feed URL                       |
| `GET /public/v1/calendar/:token`                                          | The ICS feed                                                 |
| `GET /v1/notifications`, `POST /v1/notifications/read`                    | Inbox and mark-read                                          |
| `GET /v1/notifications/summary`                                           | Unread counts per workspace for the signed-in user           |
| `GET/PUT /v1/notifications/preferences`                                   | Preferences                                                  |
| `POST /v1/projects/:id/portal-links`, `DELETE /v1/portal-links/:id`       | Share/revoke the homeowner portal                            |
| `GET /public/v1/portal/:token`                                            | Portal projection                                            |
| `POST /public/v1/portal/:token/requests`                                  | Homeowner asks for a change (becomes a proposal)             |
| `GET /public/v1/portal/:token/documents/:id`                              | Download a client-visible file or evidence pack              |

`GET /v1/change-orders` gains a `REVIEW` bucket and `room`, `workCategory`,
`awaitingReview`, `origin`, `submittedBy` on each summary.

## WhatsApp conversation rules

1. **Identify.** Site-team numbers and customer-contact numbers, across all
   workspaces. Unknown → the existing unknown-sender reply.
2. **Commands** (whole message): `help`, `projects`, `contracts` / `records`
   (homeowner: a fresh portal link per project; site team: open requests),
   `status`, `request` / `file` (correct the last item), a number or project
   code while a choice is pending.
3. **Project.** An explicit project code or title match wins; then the sticky
   project from the last two hours; then the only candidate; otherwise ask once
   with a numbered list and hold the message until answered (30 minutes).
4. **Kind.** A request if the message carries a price, a time impact, request
   field labels, or change language ("can we", "please add", "instead of",
   "extra", "change"); otherwise content. Media without request language is
   content.
5. **Act.** Requests become proposals (or, under `AUTO_SEND` with a complete
   message from a site-team member within their ceiling, are sent as before).
   Content becomes project documents in "From WhatsApp" — photos and files as
   files, text as a note.
6. **Notify** the project's designers, and **reply** with what happened and the
   one-word correction.

## Web

- **Rail:** Overview, Projects, Requests, Timeline, Inbox (unread badge) · Manage:
  Customers, Site team, Reports · System: Settings, Simulator. A workspace
  switcher above the nav. Collaborators see only Overview, Projects, Requests,
  Timeline and Inbox.
- **Project:** tabs — Overview (details, contract value and its history,
  close/reopen), Requests, Files, Team (site team, collaborators, RACI,
  homeowner portal), Timeline (milestones).
- **New project:** customer (pick or create), title, address, description,
  start and expected completion, original contract value, files (uploaded into
  Plans & drawings after creation).
- **Requests:** every request across projects, tabbed by Needs review, Waiting
  on client, Approved, Declined, Change requested, Drafts, All; paste-a-message
  card; rows link to the request and its project.
- **Composer:** room (suggestions + free entry), type of work, justification;
  proposals open in the composer for the designer to complete and send, or
  dismiss.
- **Timeline:** month grid and agenda across projects; milestones; the private
  calendar feed.
- **Inbox:** notifications; the WhatsApp message log moves here as a tab.
- **Customers:** a detail page with contacts and every associated project.
- **Settings:** people and roles, notification preferences, request routing.
- **Portal** `/p/{token}`: project summary, contract value history, every sent
  request and its status, evidence packs, client-visible files, milestones, and
  "ask for a change".
- **Invite** `/invite/{token}`: accept an invitation; a collaborator who has no
  workspace of their own skips onboarding.
- **Landing page:** rewritten for designers and architects.

## Deliberately not done

- Live WhatsApp (Meta account, templates, webhook) — unchanged external blocker.
- Google Drive sync (D12), in-browser editing of uploaded files, file version
  history.
- Ads, affiliate links, a marketplace — notes mark them future.
- A name change — undecided; the brand stays "ExtraWork".
- Localisation ("Code in various" in the notes is ambiguous; flagged for the
  owner).
- Push notifications to phones — the ICS feed covers reminders.
