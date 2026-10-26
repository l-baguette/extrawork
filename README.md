# ExtraWork

A WhatsApp-first project organisation and change-approval system for India's
residential interiors and construction work. The primary user is the **interior
designer or architect**; each project is shared with the **construction
company** that builds it and the **homeowner** who pays for it.

A project is one shared folder: the customer, the contract value and its
history, the timeline, the people, the drawings, spreadsheets and photos, and
one dedicated record of every change request. Site staff and homeowners send
requests and files in one WhatsApp message; collaborators from other firms use
the web app; **everything goes through the designer**, who reviews each request
before it reaches the homeowner. The homeowner decides from a link **without
creating an account**, and ExtraWork keeps the exact version that was approved,
the timestamps, an append-only history and a tamper-evident PDF.

Organising an unorganised sector comes first; the approval record is a side
benefit, and its guarantees are unchanged. ExtraWork is the working name.

Product: [`docs/ExtraWork_Product_Brief_v3.md`](docs/ExtraWork_Product_Brief_v3.md).
Design: [`docs/superpowers/specs/2026-10-12-three-party-workspace-design.md`](docs/superpowers/specs/2026-10-12-three-party-workspace-design.md).
Flows and roles: [`docs/workflows.md`](docs/workflows.md). The evidence
machinery was built to the _ExtraWork Technical Design Report and Master Build
Specification v1.0_; section references throughout the code and docs point back
to it.

> **What this is not.** ExtraWork records a secure-link record of assent. It is
> not a licensed or government-recognised electronic signature, and it does not
> determine whether the underlying contract is enforceable or whether the person
> deciding held authority. That wording appears on the customer page and in every
> evidence pack, and it is asserted by tests. See [Assurance](#assurance-levels).

---

## Contents

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Commands](#commands)
- [The core journey](#the-core-journey)
- [Assurance levels](#assurance-levels)
- [Testing](#testing)
- [Deployment](#deployment)
- [Operations](#operations)
- [Deliberately deferred](#deliberately-deferred)
- [Launch gates](#launch-gates)

---

## Quick start

Requires Node 20+ and pnpm 11+, plus **a PostgreSQL 16 server** — either from
Docker or installed directly. Everything else runs on the host.

```bash
pnpm install
cp .env.example .env
```

### Option A — PostgreSQL via Docker

```bash
docker compose up -d db minio minio-init mailpit
```

`.env.example` already matches these services (`postgres:postgres@localhost:5432`).

### Option B — no Docker

Install PostgreSQL 16 and create the two databases, then point `DATABASE_URL`
at it. On macOS with Homebrew:

```bash
brew install postgresql@16
brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

createdb extrawork && createdb extrawork_test
for db in extrawork extrawork_test; do
  psql -d "$db" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;
                    CREATE EXTENSION IF NOT EXISTS pg_trgm;
                    CREATE EXTENSION IF NOT EXISTS unaccent;'
done
```

Then set both URLs in `.env` to match your server — note Homebrew's default
superuser is your own username, with no password:

```ini
DATABASE_URL=postgres://$(whoami)@127.0.0.1:5432/extrawork
TEST_DATABASE_URL=postgres://$(whoami)@127.0.0.1:5432/extrawork_test
```

Without Docker there is no MinIO or Mailpit, and none is needed: the defaults in
`.env.example` already use the private local filesystem object store
(`STORAGE_DRIVER=local`) and write mail to `./.data/mail`.

### Then, either way

```bash
pnpm db:migrate
pnpm db:seed
pnpm dev            # api :4000, worker, web :3000
```

If a command fails to reach the database it now tells you the address it tried
and how to start a server; it does not fail silently.

### What the seed gives you

A Bengaluru interior fit-out firm with two projects and seven change requests
covering every state the domain supports: approved additions, a substitution
that both adds and deducts, a declined change, a revision request followed by a
v2, a zero-price time-only change, and a draft in progress. It prints two **live
approval links** — open one on a phone-sized viewport to see the customer
experience.

Everything the seed creates goes through the real application services, so the
seeded records carry genuine frozen snapshots, real SHA-256 digests, real
(hashed) approval tokens and a real audit chain.

Sign in as `rajesh@shreeinteriors.example`; with `AUTH_DRIVER=local` the magic
link is written to the mail outbox and the API log.

---

## Architecture

A **modular monolith** in a TypeScript monorepo (report ADR-001). Web, API and
worker are separate processes sharing one domain codebase and one transactional
database.

```
                         Internet
                             |
                   [CDN / WAF / TLS edge]
                     /                 \
       [Business Web/PWA]          [Public Approval UI]
                     \                 /
                      \  HTTPS JSON   /
                       [Fastify API]
         +------------------+------------------+
         |                  |                  |
   [Domain modules]  [Integration adapters]  [Auth/RBAC]
         |                  |                  |
         +-------------[PostgreSQL]------------+
                            |        \
                     [Outbox/jobs]  [Audit hash chain]
                            |
                     [Worker process]
               +----------+----------+
               |                     |
        [Object storage]      [Email / OTP]
               |
        [PDF evidence packs]
```

### Packages

| Package                  | Owns                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`     | Zod schemas, error codes, event catalogue, assurance copy                                                                 |
| `packages/domain`        | Money/tax engine, canonical JSON + digests, state machine, authz policy, tokens, audit chain, entitlements                |
| `packages/db`            | Schema, SQL migrations, tenant-scoped repositories, unit of work, outbox, jobs, idempotency, rate limits                  |
| `packages/application`   | Use cases: create, review, send, decide, evidence, files, auth, collaborators, workspace, timeline, portal, notifications |
| `packages/integrations`  | WhatsApp, email, OTP, payment, e-sign adapters + webhook signature verification                                           |
| `packages/files`         | Object store (S3 + local), upload validation, quarantine scanner                                                          |
| `packages/runtime`       | Composition root shared by every process                                                                                  |
| `packages/observability` | Structured logging with redaction, metrics, request ids                                                                   |
| `packages/testkit`       | Seeds, fixtures, real-PostgreSQL test harness                                                                             |
| `apps/api`               | Fastify: `/v1`, `/public/v1` (approval, portal, invitations, calendar feed), `/webhooks/v1`                               |
| `apps/worker`            | Outbox pump, job runner, evidence PDFs, notifications, invitations, reminders, integrity, retention                       |
| `apps/web`               | Next.js: `/app/*` designer workspace, `/r/*` public approval, `/p/*` homeowner portal, `/invite/*`                        |

Dependency direction is enforced by package boundaries:
`domain ← application ← api/worker`, and `web → contracts` only.

### Decisions worth knowing

- **Money is never a float.** Integer minor units (paise) end to end, `bigint` in
  PostgreSQL, decimal strings for quantities. One engine computes every total;
  the client may preview but never supplies an authoritative figure (ADR-005).
- **A sent version is frozen.** Send builds a canonical JSON snapshot
  (RFC 8785), hashes it, and stores snapshot + digest + canonicalizer version +
  terms version permanently. Any later change creates version n+1 and revokes
  the old token.
- **Decisions are atomic and idempotent.** The decision, its audit events, the
  project projection update and the outbox event commit in one transaction. A
  unique constraint permits at most one decision per version, so a race resolves
  to one winner and a `409 ALREADY_DECIDED` for the loser.
- **No provider call inside a transaction.** Side effects go through a
  transactional outbox and a PostgreSQL job queue (`FOR UPDATE SKIP LOCKED`,
  leases, backoff, dead-letter).
- **Evidence is append-only.** `audit_events` and `decisions` are protected by
  database triggers _and_ by role privileges. Corrections go through a documented
  repair command that records before/after digests.

---

## Commands

```bash
pnpm dev                  # api + worker + web
pnpm dev:api              # one process at a time
pnpm dev:worker
pnpm dev:web
```

```bash
pnpm db:migrate           # apply migrations (idempotent)
pnpm db:reset             # drop and recreate the schema (refuses in staging/production)
pnpm db:seed              # demonstration data
pnpm db:harden            # create the restricted runtime role (deployment-time)
pnpm db:verify-chain      # recompute every audit hash chain; non-zero exit on a break
pnpm db:repair            # documented projection repair command
pnpm db:replay            # replay a dead-lettered outbox event or job
```

```bash
pnpm typecheck
pnpm lint
pnpm test                 # unit + integration
pnpm test:all             # every suite
pnpm test:e2e             # Playwright, needs api + web running
pnpm build                # web + api + worker
pnpm openapi              # regenerate docs/openapi/openapi.json
pnpm verify               # format, lint, typecheck, all tests
```

---

## The core journey

Three parties: the designer's firm owns the workspace, the construction company
collaborates, the homeowner decides. Flowcharts for each step and each role are
in [`docs/workflows.md`](docs/workflows.md).

1. **Sign in and set up** — magic link, then business identity, timezone and
   currency. `/app/onboarding`. New workspaces start on the free `BETA` plan.
2. **Customer, project, baseline** — customer, title, address, description,
   dates and the original contract value, which **locks** as soon as the first
   change is sent; changing it after that requires an explicit, audited baseline
   amendment. The project starts with default folders (Plans & drawings,
   Contracts & quotes, Site photos, Bills & invoices, From WhatsApp), each with a
   visibility: firm only, firm and collaborators, or also the homeowner.
3. **People** — the site team by WhatsApp number (no account); collaborators
   from other firms by email invitation (a `COLLABORATOR` membership with a
   grant on this project); the homeowner by a portal link (`/p/{token}`, no
   account).
4. **Requests come in** — a site-team member or the homeowner sends one
   WhatsApp message; a collaborator raises one in the web app; the homeowner
   asks from the portal; the designer pastes a contractor's message or writes
   one. By default each becomes a **proposal**: a draft awaiting the designer's
   review, numbered by project (`P-0004-R03`). Content that is not a request
   (photos, files, notes) is saved to the project's From WhatsApp folder. The
   designers are notified of everything.
5. **Designer reviews** — completes the room, type of work, lines, price, time
   impact and justification, then sends it or dismisses it with a reason. Only
   the designer edits or sends. Autosaves locally and to the server; a draft
   carries a `lockVersion` and a conflicting update shows a comparison rather
   than overwriting.
6. **Preview and send** — the **send button stays unavailable until the server
   has calculated the preview**. Sending freezes the version, mints a 32-byte
   token (its record stores only SHA-256). Automated delivery queues only
   authenticated ciphertext and removes it once the worker finishes.
   The designer sends from their own number; ExtraWork records
   `SHARE_INTENT_OPENED`, never "delivered".
7. **Homeowner reviews** — `/r/{token}`, no account, server-rendered, no
   third-party scripts, `Referrer-Policy: no-referrer`, `noindex`. Their project
   portal shows every sent request, the contract value history, shared files,
   milestones and evidence packs.
8. **Decide** — approve, decline or request revision, each behind a confirmation
   screen with a declaration that is never pre-ticked. The decision commits
   before the success response; the PDF and receipt follow asynchronously and
   their failure never reverses the approval.
9. **Totals, invoicing and timeline** — the contract value and its history,
   approved changes marked as invoiced, milestones on a timeline across
   projects with email reminders and a private calendar feed.
10. **Evidence** — a versioned PDF plus a machine-readable manifest carrying the
    content digest, the terminal audit hash and every attachment digest.

Firms that want the earlier direct path can set request routing to `AUTO_SEND`:
a complete WhatsApp request from a site-team member within their ceiling is
then sent to the homeowner without review.

---

## Assurance levels

| Level  | What it is                                                                                          | Status                                                                   |
| ------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **A0** | Secure-link assent: 256-bit token, typed name, affirmative checkbox, timestamp, IP hash, user agent | default, available                                                       |
| **A1** | A0 plus a one-time code to the recorded approver phone                                              | available when the plan includes it                                      |
| **A2** | Licensed e-signature with a provider certificate                                                    | **not in this release** — rejected explicitly, never silently downgraded |

The wording for every level lives in one file
(`packages/contracts/src/assurance.ts`) so counsel can review it in one place,
and it is frozen into each sent snapshot as `termsVersion`. Golden tests assert
that an A0 pack never claims a certified signature.

---

## Testing

| Suite       | What it proves                                                                                                                             | Command                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| unit        | money/tax/rounding, state-transition matrix, authorization matrix, canonical JSON, tokens                                                  | `pnpm test:unit`        |
| property    | totals invariants, key-order independence of digests, terminal states never transition, chain verification                                 | `pnpm test:property`    |
| integration | **real PostgreSQL**: tenant isolation on every repository, approval races, idempotency, outbox atomicity, versioning, projection integrity | `pnpm test:integration` |
| security    | token leakage and enumeration, minimal public projection, malicious files and polyglots, webhook forgery, read-only mode                   | `pnpm test:security`    |
| golden      | canonical snapshot structure and digest, manifest reproducibility, **rendered PDF text extraction**                                        | `pnpm test:golden`      |
| e2e         | Playwright mobile and desktop through the real UI                                                                                          | `pnpm test:e2e`         |

The database-backed suites talk to a real PostgreSQL instance — never an
in-memory fake, because the locking, constraint and trigger behaviour under test
only exists in the real thing. Point `TEST_DATABASE_URL` at a throwaway database.

---

## Deployment

Report §11.1 topology: Next.js on managed hosting, the Fastify API as one small
container, the worker as a second process **from the same image**, managed
PostgreSQL, S3-compatible private object storage. Keep API, database and object
storage co-located in one region.

```bash
# Build both server processes from one image (see infra/docker/Dockerfile).
docker build -f infra/docker/Dockerfile --target server -t extrawork-api .
docker build -f infra/docker/Dockerfile --target worker -t extrawork-worker .
```

Release order (expand-and-contract, report §11.4):

1. staging migration → staging contract and E2E tests
2. **production backup checkpoint**
3. backward-compatible migration
4. rolling API and worker deploy
5. web deploy
6. post-deploy smoke and metrics gate

Before the first production boot:

```bash
pnpm db:migrate
pnpm db:harden --role extrawork_runtime --password "$RUNTIME_DB_PASSWORD"
# then point DATABASE_URL at that role; keep the owner credential for migrations
```

`packages/config` refuses to start with `APP_ENV=production` if any secret is
still a development placeholder, if storage is the local driver, if email cannot
actually deliver, or if TLS to the database is disabled.

### Health and metrics

| Endpoint   | Purpose                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `/healthz` | liveness — never touches the database                                                                                |
| `/readyz`  | readiness — checks the database, reports driver configuration                                                        |
| `/metrics` | Prometheus text: decision success/failure, outbox age, queue depth, PDF duration, integrity and audit-chain failures |

Page an operator for sustained decision failures, database unavailability,
invalid audit-chain checks, or lost backup coverage. Isolated message and PDF
failures create tickets, not pages.

---

## Operations

Runbooks live in [`infra/runbooks`](infra/runbooks/README.md) and cover every
item in report §13.6: revoking a leaked token, rotating provider credentials,
replaying events, repairing project totals, restoring the database and verifying
chains, recovering a failed migration, data-subject requests, support access,
suspected cross-tenant disclosure, and freezing a single organization.

Backups: `scripts/backup.sh` (encrypted, refuses to write plaintext),
`scripts/verify-backup.sh` (daily health check that actually reads the archive),
`scripts/restore.sh` (restores to a named target, never over the live database).

---

## Deliberately deferred

Report §15.2. Each of these has an adapter or interface in place so it can be
added without reworking the domain:

| Deferred                                            | Trigger to build it                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Automated WhatsApp Cloud API sending                | evidence that automation improves send, decision or retention rates over native share                         |
| Contractor-owned WhatsApp numbers (Embedded Signup) | sender trust or branding demonstrably blocking adoption                                                       |
| A2 licensed e-signature                             | a contractual requirement from a paying customer, plus counsel sign-off on how the certificate is represented |
| Multiple / sequential approvers                     | repeated field evidence of multi-party approval disputes                                                      |
| Full invoicing and GST filing                       | never in this product — it belongs to an accounting integration                                               |
| Redis / dedicated queue                             | measured queue contention or lease-throughput limits in PostgreSQL                                            |
| Elasticsearch                                       | p95 tenant search missing its SLO after index and query tuning                                                |
| WORM storage and external timestamping              | a customer requirement for proof-of-time beyond tamper-evidence                                               |
| Native mobile apps                                  | installable PWA proving insufficient for home-screen and offline drafts                                       |
| AI drafting, OCR, translation                       | only with a disclosed processing basis and a redaction strategy                                               |
| Google Drive sync                                   | firms asking for it after using links; needs a Google Cloud project and OAuth verification for Drive scopes   |
| In-browser file editing and file version history    | beta users asking for it; files are stored privately and downloaded, never rendered                           |
| Push notifications to phones                        | the calendar feed and email proving insufficient for reminders                                                |
| Localisation of WhatsApp replies and the portal     | the owner deciding which languages ("Code in various" in the notes is ambiguous)                              |
| Marketplace for parts and services                  | marked future in the founder's notes; only after the single-firm product is proven                            |
| Ads and affiliate links                             | marked future in the founder's notes; only if they serve the designer                                         |
| A new product name                                  | the owner choosing between an Indian and an English name; "ExtraWork" is the working name until then          |

---

## Launch gates

Report §16.3. Automated gates run in CI; the rest are explicitly not
engineering's to close.

| Gate                                                         | Status                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Cross-tenant negative tests on every repository              | automated — `tests/integration/tenant-isolation.test.ts`                              |
| Approval races and idempotency on real PostgreSQL            | automated — `tests/integration/approval-race.test.ts`                                 |
| Golden evidence snapshots and hashes                         | automated — `tests/golden/evidence.test.ts`                                           |
| Files private and scanned before display                     | automated — quarantine pipeline + `tests/security`                                    |
| No public link in logs, analytics or referrers               | automated — redaction tests + E2E header assertions                                   |
| Backups exist and one restore completed                      | **ops task** — follow `infra/runbooks/backup-and-restore.md` and record the rehearsal |
| Alerting on decision and audit-integrity failure             | metrics and thresholds ship here; wiring needs a real monitoring provider             |
| Counsel review of approval copy, privacy and evidence claims | **business blocker** — cannot be closed by code                                       |
| Live WhatsApp: Meta business account, templates, webhook     | **external blocker** — the adapter exists; until then the simulator runs the rules    |
| Hosting provider selected and production deployed            | **business decision** — not yet made                                                  |
| Payments wired to a provider                                 | not needed during the free beta; Razorpay code stays in place, dormant                |
| Export available after subscription lapse                    | automated — `tests/security/token-and-files.test.ts`                                  |
| Three or more founding firms using it on live projects       | **business blocker** — cannot be closed by code                                       |

---

## Licence

Proprietary. All rights reserved.
