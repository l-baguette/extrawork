# ExtraWork — Implementation Plan & Requirement Traceability

Source of truth: `ExtraWork Technical Design Report and Master Build Specification v1.0` (13 Aug 2026).
Where this plan and the report disagree, the report wins.

## 1. Build order

| Step | Scope                                                                                                                                                | Report ref                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| S1   | Monorepo, workspace, TS strict, config, observability                                                                                                | §14.1, §14.2, §11.5           |
| S2   | `packages/contracts` — Zod schemas, error codes, money DTO, OpenAPI generation                                                                       | §7.2, §7.4, §14.1             |
| S3   | `packages/domain` — money/tax engine, canonical JCS + digest, state machines, tokens, numbering, assurance, entitlements, audit hash chain           | §8.1–§8.7, §4.3–§4.5          |
| S4   | `packages/db` — Drizzle schema, SQL migrations, constraints, indexes, tenant-scoped repositories, UnitOfWork, outbox, jobs, idempotency, rate limits | §9.3, §9.4, §7.6, §7.8, §13.2 |
| S5   | `packages/integrations` + `packages/files` — WhatsApp/email/OTP/payment/e-sign gateways, ObjectStore (S3 + local dev driver)                         | §10.2, §9.7, §14.3            |
| S6   | `apps/api` — Fastify, middleware chain, `/v1`, `/public/v1`, `/webhooks/v1`, OpenAPI serving                                                         | §7.3, §7.5                    |
| S7   | `apps/worker` — outbox pump, job runner, PDF evidence, reminders, expiry, integrity, retention, scans                                                | §8.5, §8.6, §13.3, §13.4      |
| S8   | `apps/web` — Next.js contractor app + isolated `/r/*` public approval                                                                                | §6.1–§6.9                     |
| S9   | Seed data, Docker Compose, `.env.example`, README, runbooks, CI                                                                                      | §11.1–§11.6, §13.6            |
| S10  | Tests: unit, property, integration (real PG), security, golden evidence, Playwright E2E                                                              | §14.5                         |

## 2. Module map → package

| Report module (§7.1) | Location                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Identity             | `packages/domain/identity`, `packages/db/repositories/*`, `apps/api/src/modules/identity` |
| Organizations        | `packages/domain/organizations`, `apps/api/src/modules/organizations`                     |
| Customers            | `packages/domain/customers`, `apps/api/src/modules/customers`                             |
| Projects             | `packages/domain/projects`, `apps/api/src/modules/projects`                               |
| Change Orders        | `packages/domain/change-orders`, `apps/api/src/modules/change-orders`                     |
| Approvals            | `packages/domain/approvals`, `apps/api/src/modules/public-approval`                       |
| Documents/Evidence   | `packages/domain/evidence`, `apps/worker/src/jobs/evidence.ts`                            |
| Messaging            | `packages/integrations/messaging`, `apps/worker/src/jobs/messaging.ts`                    |
| Files                | `packages/files`                                                                          |
| Billing/Entitlements | `packages/domain/billing`                                                                 |
| Payments             | `packages/integrations/payments`                                                          |
| Audit                | `packages/domain/audit`, `packages/db/repositories/audit.ts`                              |
| Reporting            | `packages/db/repositories/reporting.ts`                                                   |

Dependency direction is enforced by `packages/*/package.json` deps and lint:
`domain <- application <- api/worker`, `web -> contracts only`.

## 3. Deliberate MVP posture (report §2.3, §15.2)

Implemented as **adapters with a real default and a deferred provider driver**, so the deferred item is
one config switch away but is not built:

- WhatsApp: `NativeShareGateway` is the MVP default (`SHARE_INTENT_OPENED`, never `MESSAGE_SENT`).
  `WhatsAppCloudGateway` exists as an interface + unimplemented driver guarded by the
  `automatedWhatsApp` entitlement, per §10.3 Phase 1.
- OTP/A1: engine, `otp_challenges` table, rate limits and assurance gating are implemented;
  the default OTP sender is the console/email driver. A1 only becomes selectable with the
  `otpApprovals` entitlement.
- A2 e-sign: interface only; the API rejects `A2` with `ASSURANCE_UNAVAILABLE` (never silently downgrades, §13.1).
- Payments: `PaymentGateway` interface, `payment_intents` table, webhook inbox path;
  no live provider credentials required for MVP.

## 4. Requirement traceability

Legend: **Code** = implementing module, **Test** = the test that proves it.

### 4.1 Domain rules & state machine

| Req (report §)                                                                                | Code                                                 | Test                                                                  |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| Change-order aggregate states + legal transitions (§4.3)                                      | `packages/domain/src/change-orders/state-machine.ts` | `state-machine.test.ts` (full transition matrix)                      |
| APPROVED/DECLINED terminal; no edit-in-place (§4.3, §4.4)                                     | `state-machine.ts`, `change-order-service.ts`        | `state-machine.test.ts`, `integration/approval-race.test.ts`          |
| Draft edits until first send; post-send edit ⇒ v(n+1), prior SUPERSEDED, token revoked (§4.4) | `application/src/change-orders/create-revision.ts`   | `integration/versioning.test.ts`                                      |
| Numbering org/project scoped, gap tolerant, never reused (§8.2)                               | `packages/db/src/repositories/sequences.ts`          | `integration/numbering.test.ts`                                       |
| Money is integer minor units, decimal quantities, round-half-up (§8.1)                        | `packages/domain/src/money/`                         | `money.test.ts`, `money.property.test.ts`                             |
| `revised = baseline + prior approved + current delta` (§8.1)                                  | `packages/domain/src/money/totals.ts`                | `money.property.test.ts`                                              |
| Negative/deduction change and zero-price time-only change valid (§4.6)                        | `domain/src/change-orders/validate.ts`               | `state-machine.test.ts`, `money.test.ts`                              |
| Negative revised total or currency mismatch rejected (§4.6)                                   | `domain/src/change-orders/validate.ts`               | `money.test.ts`                                                       |
| Canonical JSON (JCS) + SHA-256, stable under key reorder (§8.3)                               | `packages/domain/src/canonical/`                     | `canonical.test.ts`, `canonical.property.test.ts`                     |
| Audit hash chain `h[n]=SHA256(h[n-1]                                                          |                                                      | canonical(e[n]))` (§8.5)                                              | `packages/domain/src/audit/chain.ts` | `audit-chain.test.ts`, `integration/audit-chain.test.ts` |
| Reminder dedupe key + suppression rules (§8.6)                                                | `packages/domain/src/reminders/`                     | `reminders.test.ts`                                                   |
| Entitlements evaluated server-side; lapse ⇒ read/export mode (§8.7)                           | `packages/domain/src/billing/entitlements.ts`        | `entitlements.test.ts`, `integration/entitlement-enforcement.test.ts` |

### 4.2 Security & isolation

| Req (report §)                                                                                  | Code                                                                                                       | Test                                                                  |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `allow(actor,action,resource)` rule shape (§3.2)                                                | `packages/domain/src/authz/policy.ts`                                                                      | `authz.test.ts` (full matrix)                                         |
| Every tenant repo requires `TenantContext` (§3.2, §14.4)                                        | `packages/db/src/repositories/*`                                                                           | `integration/tenant-isolation.test.ts` (negative corpus, every repo)  |
| 32-byte token, store SHA-256 only, return once (§3.4)                                           | `packages/domain/src/approvals/token.ts`                                                                   | `token.test.ts`, `security/token.test.ts`                             |
| Token bound to one version+approver, expiry, revoke on supersede/decide (§3.4)                  | `db/src/repositories/approval-tokens.ts`                                                                   | `integration/token-lifecycle.test.ts`                                 |
| Token never logged / no referrer / no indexing (§3.4, §11.3)                                    | `packages/observability/src/redact.ts`, `apps/api/src/plugins/security-headers.ts`, `apps/web` `/r` layout | `security/token-leakage.test.ts`                                      |
| Idempotency `(scope, subject, key)` + payload-hash conflict (§7.6)                              | `packages/db/src/repositories/idempotency.ts`                                                              | `integration/idempotency.test.ts`                                     |
| Rate limits per surface (§7.7)                                                                  | `apps/api/src/plugins/rate-limit.ts`                                                                       | `security/rate-limit.test.ts`                                         |
| Optimistic lock on drafts; row locks on decision/send (§7.8)                                    | `application/src/change-orders/*`, `approvals/decide.ts`                                                   | `integration/approval-race.test.ts`, `integration/draft-lock.test.ts` |
| ≤1 terminal decision per version (unique partial index) (§7.8)                                  | migration `0001_init.sql`                                                                                  | `integration/approval-race.test.ts`                                   |
| CSRF for cookie auth; secure/HttpOnly/SameSite (§6.5, §12.1)                                    | `apps/api/src/plugins/session.ts`, `csrf.ts`                                                               | `security/csrf.test.ts`                                               |
| File type/size allowlist, magic-byte MIME, scan, private + short-lived signed URL (§9.7, §12.1) | `packages/files/src/`                                                                                      | `security/file-upload.test.ts`                                        |
| Webhook signature verified on raw body, constant-time (§10.3, §12.1)                            | `packages/integrations/src/webhooks/`                                                                      | `security/webhook.test.ts`                                            |
| Append-only evidence: runtime role denied UPDATE/DELETE (§9.6, §12.1)                           | migration `0003_append_only.sql`                                                                           | `integration/append-only.test.ts`                                     |
| Support access time-bound + audited (§3.1, §12.1)                                               | `support_access_grants`, `application/src/support/`                                                        | `integration/support-access.test.ts`                                  |

### 4.3 API & lifecycle

| Req (report §)                                          | Code                                                                 | Test                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| Middleware order (§7.5)                                 | `apps/api/src/app.ts`                                                | `integration/middleware-order.test.ts`            |
| Error envelope w/ stable code + requestId (§7.2)        | `packages/contracts/src/errors.ts`, `apps/api/src/plugins/errors.ts` | `api/errors.test.ts`                              |
| All principal endpoints (§7.3)                          | `apps/api/src/modules/*/routes.ts`                                   | `api/*.test.ts` + generated OpenAPI diff          |
| `409 ALREADY_DECIDED` / `409 VERSION_SUPERSEDED` (§4.6) | `application/src/approvals/decide.ts`                                | `integration/approval-race.test.ts`               |
| Decision committed before success response (§4.5, §2.4) | `application/src/approvals/decide.ts`                                | `integration/decide.test.ts`                      |
| No provider call inside a DB transaction (§7.6, §14.4)  | outbox in `packages/db/src/outbox.ts`                                | `integration/outbox-atomicity.test.ts`, lint rule |
| Domain + audit + outbox committed atomically (§7.5)     | `UnitOfWork`                                                         | `integration/outbox-atomicity.test.ts`            |
| Generated OpenAPI (§7.2, §14.1)                         | `docs/openapi/openapi.json` via `pnpm openapi`                       | `api/openapi.test.ts` (drift check)               |

### 4.4 Evidence

| Req (report §)                                                                         | Code                                                                               | Test                                                    |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Evidence pack = PDF + machine-readable manifest, all listed sections (§8.5)            | `packages/domain/src/evidence/manifest.ts`, `apps/worker/src/evidence/template.ts` | `golden/evidence.test.ts`                               |
| Records template/renderer/file-hash/object-version/time (§8.5)                         | `generated_documents` table                                                        | `integration/evidence.test.ts`                          |
| Every PDF shows business, project, change, version, state, assurance, timestamp (§4.4) | `template.ts`                                                                      | `golden/evidence.test.ts` (text extraction)             |
| Honest assurance copy; A0 never shown as certified e-signature (§3.3, §12.4)           | `packages/contracts/src/assurance-copy.ts`                                         | `golden/evidence.test.ts`, `e2e/assurance-copy.spec.ts` |

### 4.5 Reliability & ops

| Req (report §)                                                     | Code                                                          | Test                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------- |
| Transactional outbox schema + lease/publish (§13.2)                | `packages/db/src/outbox.ts`                                   | `integration/outbox-atomicity.test.ts` |
| Webhook inbox, dedupe key, 200 on duplicate (§13.2)                | `apps/api/src/modules/webhooks/`                              | `security/webhook.test.ts`             |
| Projection integrity job → `INTEGRITY_REVIEW`, block sends (§13.3) | `apps/worker/src/jobs/integrity.ts`                           | `integration/integrity.test.ts`        |
| Job at-least-once + lease + dead-letter + priorities (§13.4)       | `packages/db/src/jobs.ts`                                     | `integration/jobs.test.ts`             |
| Structured logs, no PII/token (§11.5)                              | `packages/observability`                                      | `security/token-leakage.test.ts`       |
| Health checks (§11.x)                                              | `apps/api/src/routes/health.ts`                               | `api/health.test.ts`                   |
| Backup/restore + runbooks (§11.6, §13.6)                           | `infra/runbooks/*`, `scripts/backup.sh`, `scripts/restore.sh` | manual drill documented in runbook     |

### 4.6 Frontend

| Req (report §)                                                         | Code                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| Two route groups `/app/*`, `/r/*` (§6.1)                               | `apps/web/src/app/(app)`, `apps/web/src/app/r` |
| Full route inventory (§6.2)                                            | `apps/web/src/app/**`                          |
| 4-step composer, autosave, server-calculated preview gates send (§6.3) | `apps/web/src/features/composer/`              |
| RHF + shared Zod, paise serialization, decimal-string qty (§6.3)       | `composer/schema.ts`                           |
| TanStack Query keys as listed (§6.4)                                   | `apps/web/src/lib/query-keys.ts`               |
| Public UX: neutral, no dark patterns, visible decline, receipt (§6.7)  | `apps/web/src/app/r/[token]/`                  |
| Offline banner, queue drafts only, never offline send/approve (§6.8)   | `apps/web/src/lib/offline.ts`                  |
| WCAG 2.2 AA, status not colour-only, ICU formatting (§6.9)             | `packages/ui`, `apps/web/src/lib/i18n.ts`      |

## 5. Launch gates (report §16.3) — tracked in README

| Gate                                                      | Owner                                           |
| --------------------------------------------------------- | ----------------------------------------------- |
| Cross-tenant negative tests on every repo                 | Engineering — automated                         |
| Approval races + idempotency proven on real PostgreSQL    | Engineering — automated                         |
| Golden evidence snapshot/hash tests                       | Engineering — automated                         |
| Files private + scanned before display                    | Engineering — automated                         |
| No public link in logs/analytics/referrers                | Engineering — automated                         |
| Backups exist and one restore completed                   | Ops — runbook drill, **not automatable here**   |
| Alerting on decision + audit-integrity failure            | Ops — config shipped, needs a real provider     |
| Counsel review of approval copy, privacy, evidence claims | **Business blocker — cannot be closed by code** |
| Export after subscription lapse                           | Engineering — automated                         |
| ≥3 paying pilot businesses                                | **Business blocker — cannot be closed by code** |

---

## 6. Final status (verified on this machine)

| Check                                       | Command                            | Result                                              |
| ------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| Typecheck (12 packages + 3 apps)            | `pnpm typecheck`                   | 0 errors                                            |
| Lint, including architecture rules          | `pnpm lint`                        | pass, 0 warnings                                    |
| Unit                                        | `pnpm test:unit`                   | 165 passed                                          |
| Property                                    | `pnpm test:property`               | 14 passed                                           |
| Integration (real PostgreSQL 16)            | `pnpm test:integration`            | 52 passed                                           |
| Security                                    | `pnpm test:security`               | 26 passed                                           |
| Golden evidence (incl. PDF text extraction) | `pnpm test:golden`                 | 7 passed                                            |
| End-to-end (mobile + desktop)               | `pnpm test:e2e`                    | 16 passed                                           |
| Migrations from an empty schema             | `pnpm db:reset && pnpm db:migrate` | 4 applied, re-run is a no-op                        |
| Seed through real services                  | `pnpm db:seed`                     | 2 projects, 7 change orders, 5 decisions            |
| Audit chains                                | `pnpm db:verify-chain`             | 12 aggregates, all verified                         |
| Worker drains the queue                     | `node apps/worker/dist/main.js`    | 20 jobs completed, 0 dead-lettered, 5 evidence PDFs |
| Production build                            | `pnpm build`                       | web + api + worker compile                          |

**Total automated tests: 280** (264 Vitest + 16 Playwright).

### Defects found and fixed while building

Each of these was found by exercising the system, not by inspection:

| Defect                                                                                                                                                       | Found by         | Fix                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `drizzle.execute()` returns `timestamptz` as a string, so every `Date`-typed row field was a string at runtime                                               | seeding          | central coercion layer (`packages/db/src/row-types.ts`) applied in every mapper                                                               |
| Public decision ETag derived from `lock_version`, which the customer's own first page view increments — every first-time approval would have failed with 412 | seeding          | ETag is now the frozen snapshot digest (`publicDecisionEtag`), which is what "the content I was shown" actually means                         |
| `CHECK` constraints made a cancelled draft unrepresentable, contradicting report §4.3 `DRAFT --cancel--> CANCELLED`                                          | integration test | migration `0004` re-keys the constraints on `sent_at`                                                                                         |
| Job handlers read the tenant from the job payload, which producers did not populate                                                                          | worker run       | handlers use `job_queue.organization_id`, written inside the domain transaction                                                               |
| Outbox pump re-created evidence/receipt jobs that the decision transaction had already enqueued atomically                                                   | worker run       | `approval.decided.v1` maps to no jobs; it stays a notification topic                                                                          |
| Manifest digest was computed over a wrapper object containing the digest itself, so a recipient could not reproduce it                                       | golden test      | the manifest document is stored and digested on its own                                                                                       |
| SQL column lists used a table alias in `RETURNING` clauses that had none                                                                                     | seeding          | aliased and un-aliased projections kept separate                                                                                              |
| The public session cookie was issued to the Next.js server during SSR and discarded, so no decision could ever be submitted from the browser                 | E2E              | the browser establishes its own session; the CSRF pair travels in the response body, which also works when web and API are on different hosts |
| `code` was in the log redaction list, hiding every machine error code from operators                                                                         | worker debugging | redaction narrowed to OTP material only                                                                                                       |
| No `.gitignore`, so a real `.env` was one `git add` away from being committed                                                                                | pre-commit audit | added, with `.env.example` explicitly retained                                                                                                |
