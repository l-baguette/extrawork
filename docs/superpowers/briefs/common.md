# Common brief for every slice agent

You are implementing one slice of a large product pivot in the ExtraWork monorepo.
Several agents work in parallel, each in its own git worktree on its own branch. A lead
engineer merges the branches afterwards. Work only inside YOUR worktree (given in your
slice brief). Never touch `/home/claude/extrawork` or other `wt-*` directories.

## Read first (in this order)

1. `docs/superpowers/specs/2026-10-12-three-party-workspace-design.md` — the approved
   design. Its decisions (D1–D15) are binding. If something in your brief conflicts with it,
   the spec wins unless the brief explicitly overrides.
2. `CLAUDE.md` — conventions and invariants (money is never a float, frozen versions,
   transactional outbox, RLS tenant isolation, lint-enforced dependency direction).
3. The foundation commit (`git show --stat HEAD`), especially:
   - migrations `packages/db/migrations/0020`–`0023` (the schema you build on — do not
     edit them; if you truly need a schema change, add a new migration named
     `00NN_<slice-letter>_<what>.sql` using the number given in your brief and say so in your
     report),
   - contracts in `packages/contracts/src` (`primitives.ts` new enums and label maps;
     `api/collaboration.ts`, `api/workspace.ts`, `api/notifications.ts`, `api/portal.ts`,
     `api/intake.ts`; additions to `api/change-orders.ts`, `api/common.ts`, `api/projects.ts`,
     `api/organizations.ts`, `api/employees.ts`, `api/files.ts`, `errors.ts`, `events.ts`).
     These are the agreed interfaces between backend and frontend and between slices. You may
     ADD to them when your slice needs it; avoid changing existing shapes other slices rely on,
     and list any contract change in your report.
   - `packages/domain/src/authz/policy.ts` (the COLLABORATOR role, new actions,
     `DESIGNER_ROLES`, `ORG_WIDE_ROLES`).
   - `packages/db/src/repositories/notifications.ts` and
     `packages/application/src/notifications/service.ts` — the notification core. To notify
     people from your service, construct `new NotificationService(this.app)` (stateless) and call
     `notifyProject(tx, tenant, {...})` or `notifyUsers(...)` INSIDE your write transaction.
   - `packages/db/src/repositories/workspace.ts` — `ensureDefaultFolders` / `systemFolderId`.
   - The stub classes/functions registered for each slice (repositories in
     `packages/db/src/repositories/{collaboration,workspace,milestones,portal,calendar,conversations}.ts`,
     services in `packages/application/src/{collaboration,workspace,timeline,portal}/service.ts`,
     routes in `apps/api/src/routes/{collaboration,workspace,timeline,portal,intake}.ts`,
     OpenAPI modules in `apps/api/src/openapi/paths/*.ts`, worker jobs
     `apps/worker/src/jobs/{invitations,reminders}.ts`). They are already wired into
     `createRepositories`, `createServices`, `buildApp` and the worker's handler map, so you
     fill in bodies rather than editing those registries.

## Environment

- Node 22, pnpm 11.21 (already active). PostgreSQL 16 on `127.0.0.1:5432`, user `postgres`,
  trust auth. Your worktree's `.env` already points `DATABASE_URL` and `TEST_DATABASE_URL` at
  databases reserved for your slice; never use any other database. Migrations are applied.
- The machine has **2 CPUs shared by several agents**. Be economical:
  - typecheck one package at a time: `cd apps/api && npx tsc -p tsconfig.json --noEmit`
    (packages: `packages/{contracts,domain,db,application,files,integrations,testkit}`,
    `apps/{api,worker,web}`);
  - run targeted tests: `pnpm exec vitest run --project unit tests/unit/x.test.ts`,
    `pnpm exec vitest run --project integration tests/integration/x.test.ts`;
  - run the broad suites once near the end:
    `pnpm exec vitest run --project unit --project property --project integration --project security`.
  - `pnpm lint` and `pnpm format:check` before your final commit (`pnpm exec prettier --write <files>`
    to fix formatting).
- Do not run `pnpm dev` servers or Playwright unless your brief says so.
- The golden suite has two known environmental failures in this sandbox (PDF text extraction
  letter-spacing with a substitute Chromium). Ignore exactly those two.

## How code is written here

- Rationale comments: explain _why_, in the repo's voice; reference the spec decision
  (e.g. "spec 2026-10-12, D4") where it drives a rule.
- Routes (`apps/api/src/routes/*`): parse input with the zod schema from contracts; call
  `app.requireAuth`; `app.requireWrite(request, action)` for writes; use the `read`/`write`
  rate-limit preHandlers as other route files do; map rows to DTOs explicitly; never derive
  the organization from the body.
- Services (`packages/application`): `authorize(ctx.actor, action, { organizationId, projectId })`
  before doing anything; one `app.uow.transaction` per command; audit significant domain
  actions with `app.repos.audit.append` (look at existing calls for the shape and allowed
  `aggregateType` values); side effects (email, WhatsApp) only through jobs (`enqueueJob`) or
  the outbox, never inside a transaction.
- Repositories (`packages/db`): every tenant method takes `TenantContext` and scopes on
  `organization_id`; raw SQL through drizzle's `sql` tag; methods that genuinely span tenants
  (token bootstrap lookups) must run in `runInScope(SYSTEM_SCOPE, ...)` and say why.
  Map snake_case records to camelCase rows; bigint money stays bigint until the DTO.
- Web (`apps/web`): may import only `@extrawork/contracts`. Server components fetch with
  `serverGet` from `@/lib/server-fetch`; client components call `api()` from `@/lib/api`
  (it handles CSRF). Reuse the design system in `apps/web/src/app/globals.css` — a
  "drafting schedule sheet" language: `sheet`, `card`, `panel`, `btn`, `btn-primary`,
  `btn-sm`, `btn-quiet`, `banner`, `banner-error`, `code code-{approved|waiting|declined|neutral}`,
  `data-table`, `tabbar`/`tab`, `kv`, `segmented`, `feed`, `stack`, `row-between`, `actions`,
  `muted`, `small`, `field-error`, components in `@/components/sheet` (SheetTop, Block,
  Schedule, ScheduleRow, Figure, Empty) and `@/components/status-chip` (StatusChip,
  RequestStatusChip). Add new CSS only by APPENDING a clearly labelled section at the very
  end of `globals.css` (`/* --- Slice X: ... --- */`) to keep merges clean. Mobile-first: the
  people using this are on phones on site. Minimal friction beats feature count.
- OpenAPI: describe your routes in your module file under `apps/api/src/openapi/paths/`, then
  run `pnpm openapi` once at the end.
- Tests: integration tests for every new route (happy path, authorization, tenant isolation,
  and at least one collaborator-scoping case where relevant) using the existing harness —
  see `tests/integration/project-scope-api.test.ts` and `tests/integration/employee-api.test.ts`
  for building the app, creating sessions and making CSRF'd requests, and `packages/testkit`
  for `createTenant`, `addMember`, `createSentChangeOrder`. Unit tests for pure logic.
  Existing tests whose expectations the spec deliberately changes may be updated — say which
  and why in your report. Never weaken an assertion just to get green.

## Committing

Commit in focused steps on your branch, message style like the existing log (imperative,
sentence case, a body explaining why), ending with exactly these two trailer lines:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DTqAWTLmuNKmi2gRVGXgHK
```

Leave the worktree clean (everything committed) when you finish.

## Final report (your last message)

1. What you built, by layer (db / application / api / worker / web).
2. Files you touched outside your slice's ownership, and why.
3. Contract changes (added fields/schemas).
4. Tests added; the exact pass/fail counts of your final broad test run.
5. Anything unfinished, risky, or a judgement call the lead should review.
