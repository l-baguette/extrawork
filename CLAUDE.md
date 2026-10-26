# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## What this is

ExtraWork (working name) is a WhatsApp-first project organisation and change-approval system for India's residential interiors and construction work. The primary user is the **interior designer or architect**, whose workspace each project lives in; the **construction company** collaborates on it, and the **homeowner** sees the record and decides through links **without creating an account**. A project is a shared folder (customer, contract value and its history, timeline, people, files) plus one record of every change request. Site staff and homeowners raise requests and send files over WhatsApp; everything goes through the designer, who reviews, prices and sends each request before the homeowner approves/declines/requests revision. Organisation comes first; the evidence trail is a side benefit and its guarantees are unchanged. The current direction is set by `docs/superpowers/specs/2026-10-12-three-party-workspace-design.md` (decisions D1–D15); `docs/ExtraWork_Product_Brief_v3.md` and `docs/workflows.md` describe it for humans. The evidence machinery was built to a specific internal spec — "the report" — referenced throughout code comments and docs as section numbers (e.g. "report §14.2"); that document is `docs/ExtraWork_Technical_Design_Report_v2.0.docx`. `docs/HANDOFF.md` and dated `docs/HANDOFF_*.md` files are point-in-time engineering handoffs — check dates against current work before trusting their claims of what's "done."

## Commands

```bash
pnpm install
cp .env.example .env
docker compose up -d db minio minio-init mailpit   # or a local Postgres 16, see README
pnpm db:migrate && pnpm db:seed
pnpm dev                  # api :4000, worker, web :3000 — or pnpm dev:api / dev:worker / dev:web individually
```

```bash
pnpm typecheck            # pnpm -r typecheck
pnpm lint                 # eslint . --max-warnings=0
pnpm format / format:check
pnpm verify               # format:check + lint + typecheck + test:all — run before considering work done
```

Testing (vitest workspace projects in `vitest.workspace.ts`; single test file: `vitest run --project unit tests/unit/foo.test.ts`):

```bash
pnpm test                 # unit + integration
pnpm test:unit            # pure domain logic, no database
pnpm test:integration     # real PostgreSQL: tenant isolation, races, outbox atomicity
pnpm test:security        # IDOR corpus, token leakage, webhook forgery, malicious files
pnpm test:golden          # canonical JSON digests + rendered PDF text extraction
pnpm test:all             # every vitest project
pnpm test:e2e             # Playwright; needs api + web running (pnpm e2e:install first)
```

The `integration`, `security`, and `golden` projects require a real PostgreSQL instance (`TEST_DATABASE_URL`) — never mocked, because the behavior under test (row locks, constraints, triggers) only exists in real Postgres. These projects run with `fileParallelism: false` / `singleFork: true` because files share one database and truncate between tests — don't add parallelism to them.

Database:

```bash
pnpm db:migrate           # idempotent
pnpm db:reset             # drop/recreate; refuses outside local
pnpm db:verify-chain      # recompute every audit hash chain
pnpm db:repair            # documented projection repair (audited)
pnpm db:replay            # replay a dead-lettered outbox event/job
pnpm db:harden            # create the restricted runtime DB role (deploy-time)
```

Other: `pnpm openapi` regenerates `docs/openapi/openapi.json` — run it after changing any route schema, since CI checks for drift. `pnpm build` builds packages → api/worker/web in dependency order.

## Architecture

Modular monolith, TypeScript monorepo (pnpm workspaces: `apps/*`, `packages/*`). Three processes share one domain codebase and one transactional Postgres database — there is no service-to-service network boundary between them at runtime; the boundary is enforced only at build/lint time.

| Package                  | Owns                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `packages/contracts`     | Zod schemas, error codes, event catalogue, assurance copy                                                  |
| `packages/domain`        | Money/tax engine, canonical JSON + digests, state machine, authz policy, tokens, audit chain, entitlements |
| `packages/db`            | Schema, SQL migrations, tenant-scoped repositories, unit of work, outbox, jobs, idempotency, rate limits   |
| `packages/application`   | Use cases: create, send, decide, evidence, files, auth                                                     |
| `packages/integrations`  | WhatsApp, email, OTP, payment, e-sign adapters + webhook signature verification                            |
| `packages/files`         | Object store (S3 + local), upload validation, quarantine scanner                                           |
| `packages/runtime`       | Composition root shared by every process (`Container`)                                                     |
| `packages/observability` | Structured logging with redaction, metrics, request ids                                                    |
| `packages/testkit`       | Seeds, fixtures, real-PostgreSQL test harness                                                              |
| `apps/api`               | Fastify — `/v1` (authenticated), `/public/v1` (token-based approval), `/webhooks/v1`                       |
| `apps/worker`            | Outbox pump, job runner, evidence PDFs, reminders, integrity checks, retention                             |
| `apps/web`               | Next.js App Router — `/app/*` contractor dashboard, `/r/*` public approval page                            |

**Dependency direction is lint-enforced** (`eslint.config.mjs`), not just convention: `domain` must never import `db`/`integrations`/`files`/`runtime`; `apps/web` must only import `@extrawork/contracts`, never server-side packages (`domain`, `application`, `db`, `runtime`, `integrations`). Tests, `testkit`, `scripts/`, and `cli/` directories are exempted from this rule since they legitimately cross layers.

### Three-party invariants (spec 2026-10-12)

- **A shared project lives in the designer's workspace.** People from other firms join it with the `COLLABORATOR` role plus a `project_members` grant; there is no cross-tenant sharing, so RLS and tenant-bound keys stay as they are (D1). `COLLABORATOR` is never in `ORG_WIDE_ROLES` and sees only granted projects.
- **Only the designer changes the record.** Collaborators, the site team and the homeowner can only _propose_. A proposal is a DRAFT version with `submitted_for_review_at` set and `reviewed_at` null, not a new status: the state machine, freeze guard and transition trigger are untouched (D4). `DESIGNER_REVIEW` is the default routing; `AUTO_SEND` keeps the old direct path (D3).
- **Folder visibility decides who sees a file.** `INTERNAL` is the firm only, `PROJECT` adds collaborators, `CLIENT` adds the homeowner portal. The portal shows only `CLIENT` folders and requests that were actually sent, never proposals.
- **New frozen terms only when present.** Room and type of work enter the snapshot's `scope` only when set, so existing snapshots and digests are unchanged (D9). Review provenance and the invoiced mark sit outside the freeze guard.
- **WhatsApp never guesses between projects or firms.** Phone numbers are no longer globally unique (D7); an ambiguous sender is asked once, the answer sticks for two hours, and every reply offers a one-word correction (D6).
- **Files are an allowlist, private, and downloaded as attachments, never rendered** (D10). New tokens (portal links, invitations, calendar feeds) are stored as SHA-256 hashes only, like approval tokens.
- **Notify inside the write transaction, deliver outside it.** Use `NotificationService.notifyProject`/`notifyUsers` within the command's transaction; email and WhatsApp still go through jobs or the outbox.

### Non-obvious invariants worth knowing before touching money, evidence, or delivery code

- **Money is never a float.** Integer minor units (paise), `bigint` end to end. Lint hard-errors on `parseFloat` and `Math.round` in `domain`/`application`/`db` — use `parseQuantity` and `roundHalfUpToBigint` instead.
- **A sent version is frozen.** Sending builds a canonical JSON snapshot (RFC 8785 / JCS, `packages/domain` jcs.ts), hashes it (SHA-256), and stores snapshot + digest + canonicalizer version + terms version permanently. Any later edit creates version n+1 and revokes the old token — it never mutates a sent version.
- **Decisions are atomic and idempotent.** Decision + audit events + project projection update + outbox event commit in one transaction; a unique constraint allows at most one decision per version (races resolve to one winner, one `409 ALREADY_DECIDED`).
- **No provider call inside a transaction.** All side effects (WhatsApp, email, PDF) go through a transactional outbox + Postgres job queue (`FOR UPDATE SKIP LOCKED`, leases, backoff, dead-letter) consumed by `apps/worker`.
- **Evidence is append-only.** `audit_events` and `decisions` are protected by DB triggers _and_ revoked UPDATE/DELETE role privileges (see `pnpm db:harden` / `packages/db` harden.ts). Corrections only happen through the documented, audited repair command (`pnpm db:repair`) — never hand-edit these tables.
- **Automated WhatsApp/customer delivery sends only authenticated ciphertext**, and the contractor sends the link from their own number — ExtraWork records `SHARE_INTENT_OPENED`, never "delivered". Full automated Cloud API sending, contractor-owned numbers, and A2 licensed e-signature are intentionally deferred (see README "Deliberately deferred" table) — adapters/interfaces exist but are not wired to a real provider.
- **Assurance levels (A0/A1/A2)** and their exact legal wording live in one file, `packages/contracts/src/assurance.ts`, frozen into each snapshot as `termsVersion`. A2 is explicitly rejected, never silently downgraded — don't add e-signature claims elsewhere.
- **Tenant isolation is enforced twice.** Every repository scopes on `organization_id`, _and_ PostgreSQL row-level security enforces the same rule underneath (migration 0019). The tenant reaches the database through `packages/db/src/tenant-scope.ts`: the API sets it when `requireAuth` resolves a session, the worker and the operator CLIs declare `SYSTEM_SCOPE`, and token-keyed bootstrap lookups (`findByToken`, `findPublicSession`, `resolveAuthenticatedSession`) are system-scoped because they are what _establish_ the tenant. The only tables carrying an `organization_id` without RLS are `memberships` (read to resolve the tenant at sign-in) and `purged_organizations` (the operator's tombstone of erased workspaces, belonging to no live tenant); `tests/security/three-party-authz.test.ts` fails if any other one appears. **An unset scope denies everything** — the failure mode of forgetting one is an empty result, never a cross-tenant read. Two consequences worth knowing: RLS is inert for superusers and table owners _even with FORCE_, so it does nothing in local dev and in most of the test suite (`tests/integration/row-level-security.test.ts` is the one place it is genuinely exercised, via a purpose-made unprivileged role); and production refuses to boot as a superuser (`assertRlsEnforceable`), so deployments must use the role from `pnpm db:harden`.
- **TenantContext / TransactionContext** are the highest-fan-out abstractions in the graph — nearly every repository method takes one. A repository method without tenant scoping is very likely a bug (see `infra/runbooks` cross-tenant-disclosure runbook and the tenant-isolation integration tests).

### Config and secrets

`packages/config` validates env at boot and **refuses to start** with `APP_ENV=production` if any secret is still a development placeholder, storage is the `local` driver, email can't actually deliver, or DB TLS is disabled. `.env.example` documents every variable; never put real secrets in `.env` files committed to source.

### Where to look for more

- `README.md` — quick start, full architecture diagram, the core user journey, testing matrix, deployment/release order, launch gates. Read this before the graph report for anything product-shaped.
- `infra/runbooks/` — operational procedures (leaked token, credential rotation, restore + chain verification, cross-tenant disclosure, data-subject requests). Consult before writing anything that touches these scenarios.
- `docs/IMPLEMENTATION_PLAN.md`, `docs/HANDOFF*.md` — engineering state and decisions; treat as a snapshot at their stated date, not a live source of truth.
