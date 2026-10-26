# Slice A — Collaborators, roles, site team and workspace settings

Worktree: `/home/claude/wt-a` · branch `feat/ws-a-collaboration` · reserved migration number if
you need one: `0024_a_<what>.sql`.

Read `/home/claude/briefs/common.md` first. This slice implements spec decisions D1, D2, D7
(UI side), D13 (display) and the "roles"/"collaborators"/"employees-teams on the project"/
"RACI" parts of the notes.

## You own

- `packages/db/src/repositories/collaboration.ts` (fill the stub)
- `packages/application/src/collaboration/service.ts` (fill the stub)
- `apps/api/src/routes/collaboration.ts`, `apps/api/src/openapi/paths/collaboration.ts`
- `apps/worker/src/jobs/invitations.ts` (fill the stub, if you send invitations by job)
- `apps/api/src/routes/organizations.ts`, `apps/api/src/routes/auth.ts` (only the parts below)
- `packages/db/src/repositories/identity.ts` (`listMemberships` party, anything invitations need)
- Web: `apps/web/src/app/invite/**` (new), `apps/web/src/app/onboarding/**`,
  `apps/web/src/app/(app)/app/projects/[id]/team/**` and `project-team.tsx`,
  `apps/web/src/app/(app)/app/employees/**`, `apps/web/src/app/(app)/app/settings/**` except a
  new `settings/notifications` route (slice C owns that one), `apps/web/src/components/app-shell.tsx`
  (pending-invitations banner only), any new components you create.
- Tests: `tests/integration/collaboration-*.test.ts` and updates to tests your changes affect.

Do NOT edit: the dashboard page, the requests pages, the composer, change-order code, project
repository/service (slice B); files/workspace/timeline code (slice C); intake/WhatsApp code.

## Build

### Invitations and collaborators (backend)

Repository (`CollaborationRepository`), all tenant methods take `TenantContext`:

- create an invitation (token stored only as SHA-256; reuse the opaque-token helpers in
  `packages/domain/src/approvals/token.ts` or `hashOpaqueToken` used by sessions — find the
  existing helper and reuse it, do not invent a new token scheme). Re-inviting the same email to
  the same project while one is PENDING refreshes that row (new token, new expiry) because of the
  partial unique index. Expiry: 14 days.
- list a project's invitations (pending first) with inviter display name; revoke.
- `findByTokenHash` and `findPendingForEmail` are bootstrap lookups that must run under
  `runInScope(SYSTEM_SCOPE, ...)` (the invitee is not a member yet) — document why, return only
  what the preview needs (org display name, project title + number, inviter name, party, masked
  email, status, expiry). Treat a PENDING row past `expires_at` as EXPIRED (update it when seen).
- `projectPeople(ctx, projectId)`: every ACTIVE member who can see the project — OWNER/ADMIN/
  FINANCE (org-wide) and members with a `project_members` grant — with role, party, company,
  `orgWide`, joined date.
- grant / revoke a project for a user (`project_members`).

Service (`CollaborationService`):

- `invite(ctx, projectId, input)` — authorize `collaborator:invite` on the project; normalise the
  email (`normalizeEmail` in domain); if that person already sees the project (org-wide staff or
  existing grant) → `ALREADY_COLLABORATING`; create/refresh the invitation; audit
  `COLLABORATOR_INVITED`; if `phone` is given and party is not HOMEOWNER, add or reuse a site-team
  member (`employees`) in this organization with the mapped party, the company name and the
  project assigned (reuse `EmployeeService`/repository behaviour, normalising the phone the same
  way); deliver the email (see below); return the invite URL
  `${WEB_PUBLIC_URL}/invite/{token}` once, plus a `https://wa.me/?text=` share URL with a short,
  plain message ("<inviter> invited you to collaborate on <project> on ExtraWork: <url>").
- Email delivery: prefer a `SEND_INVITATION` job carrying the link as authenticated ciphertext
  using the SAME helper the approval-link delivery uses (find it — `APPROVAL_LINK_ENCRYPTION_SECRET`),
  purged after sending, mirroring how approval URLs are delivered. If that helper does not fit
  cleanly, send the email after the transaction commits exactly the way `AuthService` sends
  sign-in emails, best-effort with a logged failure, and leave the job stub a documented no-op.
  Either way the designer always gets the link in the response to share on WhatsApp.
- `revokeInvitation`, `removeCollaborator(ctx, projectId, userId)` — designers only; refuse to
  remove org-wide staff from a single project (they see everything by role) with a clear
  message; when a COLLABORATOR loses their last grant, revoke the membership and revoke their
  sessions for that organization (`identity.revokeSessionsForMembership`). Audit
  `COLLABORATOR_REMOVED`.
- `preview(token)` (public) and `accept(userId, token)` — accept requires a session but NOT an
  existing membership (a contractor may have no firm on ExtraWork). Check status, expiry, and that
  the signed-in user's verified email equals the invitation email (`INVITATION_EMAIL_MISMATCH`
  otherwise). Then, inside one transaction scoped to the HOST organization
  (`runInScope(tenantScope(orgId), ...)`): `organizations.ensureCollaboratorMembership` (already in
  the foundation — never demotes existing staff), grant the project, mark accepted, audit
  `COLLABORATOR_JOINED`, notify the project's designers (`COLLABORATOR_JOINED`, link to the
  project's Team tab). The route then sets the session's active organization to the host org.
- `listPending(userId)` and `acceptPending(userId, invitationId)` for the in-app path (email must
  match the signed-in user).

Routes (exact paths in the spec table): `GET/POST /v1/projects/:id/collaborators`,
`DELETE /v1/projects/:id/collaborators/:userId`, `DELETE /v1/invitations/:id`,
`GET /v1/invitations/pending`, `GET /public/v1/invitations/:token`,
`POST /v1/invitations/accept`, `POST /v1/invitations/accept-pending`.
`/v1/invitations/pending` and both accept routes must work for a signed-in user with no
organization: resolve the session directly and check CSRF on mutations, exactly as
`POST /v1/organizations` in `auth.ts` does (do not use `requireAuth` there). Rate-limit the
public preview like the public approval routes.

`GET /v1/auth/me` memberships include `collaboratorParty`; `GET /v1/memberships` returns
`collaboratorParty` and `companyName`. Onboarding (`POST /v1/organizations`) accepts
`businessType` and passes it through to `AuthService.createOrganization` (signature already
accepts it) and the repository.

Prove collaborator scoping end to end with integration tests: a collaborator granted project P
sees P in `GET /v1/projects`, `GET /v1/projects/:id`, its change register and
`GET /v1/change-orders?projectId=P`; cannot see project Q; gets 403 on `/v1/customers`,
`/v1/employees`, `/v1/reports/extra-work`, `/v1/memberships` and on `POST /v1/projects/:id/change-orders`.
If any of those leaks or wrongly refuses, fix the route/repository (minimal change) and report it.

### Web

- `/invite/[token]` (outside the `(app)` group, like `/onboarding`): show who invited whom to
  what. Signed out → "Sign in" / "Create an account" that come back here afterwards (add a safe
  `next` parameter to sign-in/register if missing: only same-origin paths starting with a single
  `/`). Signed in → "Accept" → POST → go to `/app/projects/{projectId}`. Handle mismatch/expired/
  revoked with plain explanations.
- Onboarding: if the signed-in user has pending invitations, show them first with "Accept" so a
  contractor never has to create a firm to join a project; keep "Set up my own business" below.
  Add a business-type select (labels `BUSINESS_TYPE_LABELS`).
- A pending-invitations banner for signed-in members (e.g. a designer invited into another firm's
  project), rendered by `AppShell` above the page content, dismissible for the session.
- Project Team tab: (1) People with access — staff and collaborators, role/party/company, remove
  (designers only, collaborators only); (2) Invite a collaborator — email, name, party, company,
  optional WhatsApp number, optional message; after creating, show the link with "Send on
  WhatsApp" and "Copy link"; pending invitations with Revoke; (3) the site team (the existing
  `ProjectTeam`, updated to show company and team role); (4) a RACI matrix generated from the
  people actually on the project, using the spec's matrix, naming people under each party column
  (designer firm, construction, homeowner = the project's customer/approver). Leave a clearly
  marked slot comment `{/* Slice D: homeowner portal access */}` where homeowner portal sharing
  will go.
- Site team (`/app/employees`): heading "Site team", explain these are people identified by their
  WhatsApp number; add party, company and team-role (`TEAM_ROLE_LABELS`) to the form and list;
  update copy about phone numbers (unique within your team; the same person may be on another
  firm's team).
- Settings: business type; request routing (radio: "Designer reviews every request
  (recommended)" / "Send complete WhatsApp requests straight to the client") with one sentence on
  what each means; People & roles — staff with `MEMBERSHIP_ROLE_LABELS`, change role for
  non-owners via the existing PATCH, collaborators listed separately with party/company and the
  projects they can see if cheap to show; plan shown as "Founding beta — free" for BETA. Add a
  link to `/app/settings/notifications` (slice C builds that page).

## Done means

Typecheck clean for every package you touched, lint and format clean, the new integration tests
pass, the broad suite passes (minus the two known golden failures), `pnpm openapi` regenerated,
everything committed.
