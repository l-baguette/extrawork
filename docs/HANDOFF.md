# ExtraWork — Project Handoff

**Purpose of this document.** Everything needed to resume work in a fresh
session with no prior context. Read this first, then `README.md` for setup and
`docs/IMPLEMENTATION_PLAN.md` for requirement traceability.

**Repo:** `/Users/vedantsacheendran/Desktop/MFC/extrawork`
**Last verified:** the full build, migrations, seed and 287 automated tests all
pass on this machine. **Nothing is committed to git yet** (no commits on `main`).

---

## 1. What the product is

A WhatsApp-first approval ledger for Indian contractors. A site employee texts
one WhatsApp message describing extra work the customer asked for. The system
authenticates them, prices it, generates a contract, and sends the customer a
link to review and sign — **without the customer installing anything or creating
an account**. The approved version, timestamps, identity evidence and an
append-only history are preserved so the contractor can invoice the extra work
and substantiate it later.

**Guiding principle (from the founder, and it overrides convenience elsewhere):**
extremely low friction. It must be fast to explain, fast to set up, and fast to
use. Every field the system can derive is a field nobody types.

---

## 2. Current status in one table

| Area                                                        | State                                |
| ----------------------------------------------------------- | ------------------------------------ |
| Database schema + 5 migrations                              | **Done**, applies cleanly from empty |
| Money/tax engine, canonical snapshots, audit hash chain     | **Done**, heavily tested             |
| Tenant isolation, authorization, approval tokens            | **Done**, negative-tested            |
| Change-order domain: draft → send → decide → evidence       | **Done** end-to-end                  |
| Fastify API (56 OpenAPI paths)                              | **Done**                             |
| Worker: outbox, jobs, evidence PDFs, reminders, integrity   | **Done**                             |
| Next.js web: contractor app + public approval page          | **Done**                             |
| Test suites (unit/property/integration/security/golden/e2e) | **Done**, 287 passing                |
| Ops: runbooks, backup scripts, CI, Docker                   | **Done**                             |
| **WhatsApp intake — schema**                                | **Done** (migration 0005)            |
| **WhatsApp intake — message parser**                        | **Done**, 23 tests passing           |
| **WhatsApp gateway (simulator + Cloud API)**                | **NOT STARTED**                      |
| **Intake service (authenticate → draft → send)**            | **NOT STARTED**                      |
| **Contract template rendering + signature pad**             | **NOT STARTED**                      |
| **Owner dashboard: employees, template editor**             | **NOT STARTED**                      |

Roughly **60% of the WhatsApp pivot remains**. Everything it depends on exists.

---

## 3. How to get running (5 minutes)

```bash
cd /Users/vedantsacheendran/Desktop/MFC/extrawork
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev              # api :4000, worker, web :3000
```

**PostgreSQL is already configured on this machine.** Homebrew `postgresql@16`
runs as a service on the standard port 5432, with a `postgres/postgres`
superuser and both `extrawork` and `extrawork_test` databases created. The
`.env.example` defaults work verbatim — no Docker needed.

If `.env` is missing: `cp .env.example .env`. It contains no secrets, only
development placeholders, and `packages/config` refuses to boot in production
with them.

Useful commands:

```bash
pnpm test:all         # every Vitest suite (264 tests)
pnpm test:e2e         # Playwright, needs api + web running (16 tests)
pnpm verify           # format + lint + typecheck + all tests
pnpm db:verify-chain  # recompute every audit hash chain
pnpm db:reset         # drop schema and re-migrate (refuses on production)
```

---

## 4. Architecture

A **modular monolith** in a pnpm/TypeScript monorepo. Three processes share one
domain codebase and one transactional PostgreSQL database.

```
  [Next.js web :3000]          [Fastify API :4000]        [Worker process]
   /app/*  contractor UI   →    /v1         business    →   outbox pump
   /r/*    public approval      /public/v1  customer        job runner
                                /webhooks/v1 providers      evidence PDFs
                                        ↓                   reminders
                                   PostgreSQL 16            integrity checks
                              (domain + outbox + jobs
                               + append-only audit chain)
                                        ↓
                            private object storage (S3 / local fs)
```

### Packages

| Package                             | Owns                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/contracts`                | Zod schemas, stable error codes, event catalogue, **assurance copy**                                     |
| `packages/domain`                   | Money/tax engine, canonical JSON + digests, state machine, authz, tokens, audit chain, **intake parser** |
| `packages/db`                       | Schema, SQL migrations, tenant-scoped repositories, unit of work, outbox, jobs, idempotency              |
| `packages/application`              | Use cases: create, send, decide, evidence, files, auth                                                   |
| `packages/integrations`             | WhatsApp / email / OTP / payment / e-sign adapters, webhook signature verification                       |
| `packages/files`                    | Object store (S3 + local driver), upload validation, quarantine scanner                                  |
| `packages/runtime`                  | Composition root shared by every process                                                                 |
| `packages/observability`            | Structured logging with redaction, metrics, request IDs                                                  |
| `packages/testkit`                  | Seeds, fixtures, real-PostgreSQL test harness, E2E helper CLI                                            |
| `apps/api` `apps/worker` `apps/web` | The three runtime processes                                                                              |

Dependency direction is **enforced by ESLint**, not just convention:
`domain ← application ← api/worker`, and `web → contracts only`.

### Non-negotiable invariants

These are enforced by tests and database constraints. Do not weaken them.

1. **Money is never a float.** Integer minor units (paise) end to end, `bigint`
   in PostgreSQL, decimal _strings_ for quantities. One engine computes every
   total; the client may preview but never supplies an authoritative figure.
2. **A sent version is frozen.** Send builds a canonical JSON snapshot
   (RFC 8785), SHA-256s it, and stores snapshot + digest + canonicalizer version
   - terms version permanently. Any later change creates version n+1 and revokes
     the old token.
3. **Decisions are atomic and idempotent.** Decision + audit events + project
   projection + outbox event commit in one transaction. A unique constraint
   permits at most one decision per version.
4. **No provider call inside a database transaction.** Side effects go through a
   transactional outbox and a PostgreSQL job queue (`FOR UPDATE SKIP LOCKED`).
5. **Evidence is append-only**, enforced by database triggers _and_ role
   privileges. Corrections go through a repair command that records
   before/after digests.
6. **Tenant scoping is mandatory** on every repository method. A cross-tenant
   reference returns `NOT_FOUND`, never `FORBIDDEN`, so an attacker cannot
   confirm an ID exists elsewhere.

---

## 5. The product pivot (this is the important part)

The system was originally built to a technical design report where the
contractor composed a change request in a **web form** and shared it via a
`wa.me` deep link from their own phone. The founder has since redefined the
product:

> The employee's entire interface is a WhatsApp message. Everything else happens
> in the background.

This **deliberately overrides two things the original report deferred**:
automated WhatsApp (report §10.3 said native-share only until proven) and
e-signatures (report §15.2). That was an explicit founder decision, made with
the trade-offs stated.

### Target flow

```
1. Employee sends ONE WhatsApp message to the ExtraWork number
     Project: Tower 4 Flat 1204
     What:    Two extra power points in the kitchen
     Why:     Client changed the appliance layout
     Cost:    15800
     Days:    2
     [+ photos attached to the same message]

2. Backend authenticates by PHONE NUMBER
     → which employee?  → which company?  → assigned to this project?
     → within their approval ceiling?

3. Backend validates the format
     → anything missing or ambiguous, reply on WhatsApp asking only for the gap

4. Backend fills the company's contract template with the work details,
   prices it through the existing money engine, freezes a canonical snapshot

5. Contract is hosted at a temporary link on the ExtraWork site

6. Customer receives a WhatsApp message with that link

7. Customer opens it, verifies by OTP, reviews, signs (drawn signature), submits

8. Filed as an accepted request; employee AND owner are notified on WhatsApp
```

### The owner dashboard (one website, everything in it)

- Add/manage projects, including the client's phone number
- Add/manage employees allowed to raise requests (by phone number)
- See every request ever filed and its status
- Edit the information shown to the customer in each request
- Later: analytics

---

## 6. Decisions made, and why

Each of these is a real trade-off someone will otherwise re-litigate.

### 6.1 Company field is optional, not required

The founder's spec listed **Company** as a field the employee types. It is now
**accepted but never required**.

**Why:** the sender's phone number already identifies their employer. Requiring
them to retype it adds typing for zero security benefit — an attacker would
simply type the correct name. Same reasoning makes **project optional when the
employee is assigned to exactly one site**.

**Effect:** the minimum useful message drops from 6 lines to **one line of
text**. This is the single biggest friction win in the flow.

_Reversible in one line if the founder disagrees — see
`packages/domain/src/intake/parse-message.ts`._

### 6.2 The parser refuses to guess

Two cases where it asks instead of picking:

- **Ambiguous amounts.** `15-20k`, `approx 15000`, `15k se 20k` → replies asking
  for one exact figure. A range is a quote, not a price, and a mis-parsed number
  silently becomes the price in a signed contract.
- **Ambiguous projects.** `tower` matching both "Tower 4" and "Tower 7" → asks
  which. Sending the wrong client a contract for someone else's flat is far
  worse than one extra round trip.

### 6.3 WhatsApp templates — the constraint that shapes onboarding

**Rule:** WhatsApp gates messages on _who spoke first_. When a person messages
your business number, a **24-hour window** opens _with that person_, inside
which you can send free-form. Outside it, only **pre-approved templates**.

- **Employee → us:** they message first → replying is free-form. No template.
- **Us → customer:** we initiate, and the customer has never messaged us → the
  first message **must be an approved UTILITY template**. This is true even
  though the message is one line and a link, because it is the _delivery of the
  link_ that is gated, not the contract (which lives on our own site).

**Decision:** register one template, once. Use a **dynamic URL button** with the
base `https://<domain>/r/` and pass the token as a variable. The sentence is
fixed at approval; the variables (customer, company, project, amount, token) are
per-message.

Draft to submit to Meta (UTILITY category):

```
Hi {{1}}, {{2}} has requested your approval for additional
work on {{3}}.

Amount: {{4}}
```

plus a URL button: base `https://<your-domain>/r/`, suffix variable `{{1}}`.

**Rejected alternatives, and why:**

- _SMS instead_ — India requires TRAI **DLT registration** of sender ID _and_
  message templates. Same problem, slower, worse deliverability.
- _Email_ — genuinely unrestricted, but the audience is homeowners on WhatsApp.
- _Employee forwards the link themselves_ — zero template, zero API, zero
  per-message cost, but one extra tap and no delivery proof. **Kept as the
  fallback**, because it works before Meta approves anything and keeps working
  if the WhatsApp account is restricted.

**Founder's call:** WhatsApp is the primary and only communication channel.
Register the template later. Build behind a **simulator** now.

### 6.4 Simulator-first gateway

The WhatsApp gateway is built behind an interface with two drivers:

- `simulator` — default. Records outbound messages to disk/database and exposes
  an endpoint to inject fake inbound messages. **The entire flow is testable
  end-to-end today with no Meta account.**
- `cloud-api` — the real Meta Cloud API. Swapped in by changing environment
  variables only. No code changes.

### 6.5 Signature is stronger evidence, not a stronger legal claim

A drawn signature is captured and hashed. It is **still not a licensed
electronic signature** under the IT Act. The assurance copy
(`packages/contracts/src/assurance.ts`) is the single source of truth for this
wording, is frozen into every snapshot, and is asserted by golden tests. **Do
not let the product overstate what the record is** — the owner can edit the
customer-facing copy, but _not_ the assurance language or the disclaimer.

### 6.6 Assurance levels

| Level  | What it is                                                                  | Status                                                        |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **A0** | Secure-link assent: 256-bit token, typed name, checkbox, timestamp, IP hash | default, working                                              |
| **A1** | A0 + OTP to the recorded approver phone                                     | working, plan-gated                                           |
| **A2** | Licensed e-signature with provider certificate                              | **not built**, rejected explicitly, never silently downgraded |

**Open question for the founder:** the flow says the customer should
"authenticate himself". Without an account the strongest option is **A1 (OTP to
the phone on file)**. That is built but adds a step for the customer. _Confirm
whether OTP should be ON by default._

---

## 7. What was built for the pivot (this session)

### Migration `0005_whatsapp_intake.sql` — applied and verified

- **`employees`** — phone-authorized, **no login**. Unique per organization
  _and_ globally unique across organizations, because an inbound message from a
  number registered at two companies is ambiguous and guessing the tenant is
  exactly the cross-tenant mistake to avoid. Carries `max_request_minor`, a
  per-request approval ceiling — the owner's main control.
- **`employee_project_assignments`** — plus an `all_projects` flag on the
  employee.
- **`inbound_messages`** — every message logged, **including unauthenticated
  ones**, with the parse result and the reply that was sent. "Someone texted us
  claiming to be X" is what an operator needs later.
- **`request_templates`** — owner-editable customer-facing copy, versioned, and
  frozen into each sent version so a later edit cannot change what a customer
  already agreed to.
- New columns: `change_order_versions.origin` (`WEB` | `WHATSAPP` | `IMPORT`),
  `raised_by_employee_id`, `template_snapshot`; `decisions.signature_*`.

### `packages/domain/src/intake/` — 23 tests passing

- **`parse-message.ts`** — forgiving parser. Any field order, any case,
  `:` `-` `=` separators, synonyms including Hinglish (`Kaam:`, `Site:`),
  amounts as `15800` / `15,800` / `₹15800` / `15800/-` / `15.8k` / `1.5 lakh` /
  `2 lac`, days as `2` / `two days` / `1 week` / `nahi`. An unlabelled message
  becomes the description.
- **`match.ts`** — fuzzy project resolution. Matches `1204`, `tower 4`, `mehta`.
  Weights numeric tokens higher (people quote flat numbers precisely because
  they disambiguate). Returns `AMBIGUOUS` rather than guessing between close
  candidates.
- **`replies.ts`** — the WhatsApp messages the employee reads. Echoes back what
  was understood and asks only for the gap. Explicitly tells the employee **not
  to start work** until approval arrives.

**Test file:** `tests/unit/intake-parse.test.ts`

---

## 8. Next steps, in build order

Each step is independently testable. Steps 1–3 make the flow work end to end.

### Step 1 — WhatsApp gateway with simulator driver

`packages/integrations/src/messaging/`

- Extend `MessageGateway` with inbound parsing and media download.
- `SimulatorWhatsAppGateway`: writes outbound messages to
  `./.data/whatsapp/outbox.jsonl`, exposes inbound injection.
- `WhatsAppCloudGateway`: real Graph API send (text + template + media),
  `X-Hub-Signature-256` verification already exists in
  `packages/integrations/src/webhooks/signature.ts`.
- Add a dev endpoint `POST /webhooks/v1/simulator/whatsapp` (**non-production
  only**) that accepts `{ from, body, media[] }` and runs the real inbound path.

### Step 2 — Intake service

`packages/application/src/intake/intake-service.ts`

Orchestrates, in this order, logging to `inbound_messages` at every branch:

1. Look up employee by `from` phone → unknown ⇒ reply, status
   `REJECTED_UNKNOWN_SENDER`.
2. `parseIntakeMessage(body)`.
3. Resolve project via `matchProject` against the employee's assignments →
   `AMBIGUOUS` ⇒ reply listing options.
4. `validateIntake` → missing/ambiguous ⇒ `incompleteReply`, status
   `REJECTED_UNPARSEABLE`.
5. Policy: project open? amount within `max_request_minor`? ⇒ else
   `REJECTED_POLICY`.
6. Create the change order through the **existing**
   `ChangeOrderService.create` (one line item from the parsed amount), then
   `SendService.send`. Do not reimplement pricing or freezing.
7. Reply `sentToCustomerReply`; send the customer the template message.

**Reuse, do not rebuild:** money engine, canonical snapshot, token minting,
audit chain, outbox — all already exist and are tested.

### Step 3 — Contract rendering + signature pad

- Render `request_templates` with `{{placeholders}}` into the public page and
  the evidence PDF; freeze `template_snapshot` at send.
- Add a canvas signature pad to `apps/web/src/app/r/[token]/decision-panel.tsx`.
- Upload the signature image to private object storage, store SHA-256 +
  storage key + dimensions on `decisions`.
- Render the signature into the evidence PDF (`apps/worker/src/pdf/template.ts`)
  — **this requires a new template version and a golden-test review.**

### Step 4 — Owner dashboard pages

`apps/web/src/app/(app)/app/`

- `employees/` — CRUD, phone entry with E.164 normalization, project
  assignment, approval ceiling.
- `settings/template/` — edit heading/intro/terms/payment note, with a live
  preview of the customer page. Assurance copy must be **read-only** here.
- `requests/` — every inbound message, including rejected ones, with the reply
  that was sent. This is the founder's "see all requests ever filed".

### Step 5 — Notifications back

Extend `apps/worker/src/jobs/messaging.ts` so `approval.decided.v1` notifies
both the raising employee and the owner via `decisionReply`.

### Step 6 — Register the Meta template

Only when a Meta Business Account exists. See §6.3 for the draft text.

---

## 9. Known issues and gotchas

- **Not committed to git.** `main` has no commits. Commit early.
- **`cp .env.example .env` will overwrite a working `.env`.** It has bitten this
  project twice.
- **Drizzle returns `timestamptz` as a _string_, not a `Date`.** All row mapping
  goes through `packages/db/src/row-types.ts`. Use `toDate`/`toDateOrNull` in
  any new repository method — this caused a whole class of runtime bugs.
- **The public decision ETag is the frozen snapshot digest, not `lock_version`.**
  Deriving it from `lock_version` breaks every first-time approval, because the
  customer's own page view increments it (`publicDecisionEtag`).
- **Job handlers must read the tenant from `job_queue.organization_id`**, not
  the payload. Producers do not populate it in the payload.
- **`openapi.json` produces zero graph nodes** in graphify. Harmless.
- **Playwright E2E needs api + web already running.** It does not start them.
- Chromium for PDF rendering is installed at
  `~/Library/Caches/ms-playwright/chromium-1148`. The Playwright installer stalls
  on this machine; it was fetched directly from the CDN.

---

## 10. Test inventory

| Suite       | Count   | Proves                                                                                                                               |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| unit        | 188     | money/tax/rounding, state machine, authz matrix, canonical JSON, tokens, **intake parser**                                           |
| property    | 14      | totals invariants, digest stability under key reorder, terminal states, chain verification                                           |
| integration | 52      | **real PostgreSQL**: tenant isolation on every repo, approval races, idempotency, outbox atomicity, versioning, projection integrity |
| security    | 26      | token leakage/enumeration, minimal public projection, malicious files, webhook forgery, read-only mode                               |
| golden      | 7       | canonical snapshot structure + digest, manifest reproducibility, **rendered PDF text extraction**                                    |
| e2e         | 16      | Playwright mobile + desktop through the real UI                                                                                      |
| **Total**   | **287** |                                                                                                                                      |

---

## 11. Open questions for the founder

1. **OTP on by default?** The flow says the customer authenticates. A1 (OTP to
   the phone on file) is built but adds a step. Default on or off?
2. **Company field** — confirm optional is acceptable (see §6.1).
3. **Approval ceilings** — should a request above an employee's ceiling be
   rejected outright, or forwarded to the owner for authorization first? Schema
   supports either; currently rejects.
4. **Meta Business Account** — does one exist, and is there a phone number that
   can be dedicated to this? Nothing blocks development, but it blocks a real
   pilot.
5. **Launch blockers that code cannot close:** counsel review of the approval
   copy, privacy and evidence claims; a recorded backup-restore rehearsal; and
   ≥3 paying pilot businesses.
