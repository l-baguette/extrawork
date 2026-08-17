# Graph Report - extrawork  (2026-08-17)

## Corpus Check
- 298 files · ~199,396 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2999 nodes · 6347 edges · 192 communities (146 shown, 46 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 115 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0110419f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TransactionContext
- AppError
- audit.ts
- approvals.ts
- change-orders/service.ts
- repositories/change-orders.ts
- schema/index.ts
- runner.ts
- ChromiumPdfRenderer
- Database
- db/src/index.ts
- policy.ts
- totals.ts
- db/package.json
- runtime/src/index.ts
- dependencies
- testkit/package.json
- plugins/rate-limit.ts
- organizations
- intake-service.ts
- dependencies
- employee-manager.tsx
- compilerOptions
- outbox-pump.ts
- reset.ts
- app.ts
- composer.tsx
- scripts
- validation.ts
- api/projects.ts
- send.ts
- runtime/package.json
- contracts/src/index.ts
- application/package.json
- devDependencies
- main.ts
- integrations/package.json
- config/src/index.ts
- primitives.ts
- files/package.json
- api.ts
- ExtraWork — Current Project Handoff
- document.ts
- api/customers.ts
- compilerOptions
- domain/src/index.ts
- decision-panel.tsx
- 0002_search_and_projections.sql
- integrations/src/index.ts
- Adapter-with-deferred-driver MVP posture
- gateways.ts
- state-machine.ts
- domain/package.json
- TenantContext
- 0003_append_only_evidence.sql
- auth.ts
- observability/package.json
- CI job: Integration, security and golden tests
- Compose service: api
- money.ts
- approvals/assurance.ts
- messaging.ts
- authorize
- Moving off this machine: Supabase + Cloudflare R2
- Record What You Did
- jobs/webhooks.ts
- Restore Database and Verify Audit Chains Runbook
- dashboard/page.tsx
- config/package.json
- contracts/package.json
- ProviderMessageRef
- dependencies
- FileRepository
- src/rate-limit.ts
- container.ts
- Non-Erasable Decision Record
- api/package.json
- compilerOptions
- harden.ts
- compilerOptions
- token.ts
- ExtraWork Technical Design Report and Master Build Specification v1.0
- webhook-normalisation.test.ts
- e2e/fixtures.ts
- compilerOptions
- providers.tsx
- compilerOptions
- Evidence pack (PDF + manifest)
- application/tsconfig.json
- config/tsconfig.json
- contracts/tsconfig.json
- db/tsconfig.json
- domain/tsconfig.json
- files/tsconfig.json
- integrations/tsconfig.json
- observability/tsconfig.json
- runtime/tsconfig.json
- testkit/tsconfig.json
- ui/tsconfig.json
- repositories/organizations.ts
- Preserve Evidence Then Contain
- package.json
- fastify-plugin
- Audited Repair Command
- Replay Webhook and Outbox Events Runbook
- ExtraWork — Project Handoff
- ESignGateway
- scripts
- api/reports.ts
- Append-only evidence
- Job queue with lease, dead-letter and priorities
- @extrawork/contracts
- metrics
- project_integrity_mismatches
- reminders/reminders.ts
- whatsapp.ts
- .prettierrc.json
- evidence.test.ts
- next.config.mjs
- sequences.ts
- api/organizations.ts
- DocumentRepository
- Operational Runbooks Index
- @extrawork/domain
- MessageGateway
- @extrawork/config
- exports.ts
- @fastify/helmet
- api/employees.ts
- zod-to-json-schema
- next-env.d.ts
- @extrawork/db
- query-keys.ts
- Money and totals engine
- password.ts
- decide.ts
- Decision Write Path Priority
- pdfjs-dist
- @extrawork/contracts
- @types/node
- @typescript-eslint/parser
- dev-lan.sh
- Handler Idempotency
- format.ts
- zod
- typescript-eslint
- @eslint/js
- public-view.ts
- backup.sh
- restore.sh
- verify-backup.sh
- vitest.workspace.ts
- CI job: Dependency and secret scan
- Constraint Violation Means Real Bad Data
- api/change-orders.ts
- ExtraWork — Product Brief
- domain/src/approvals/otp.ts
- logger.ts
- api/files.ts
- devDependencies
- RequestTemplateRepository
- intake-service.test.ts
- CLAUDE.md
- replay.ts
- Data Access, Export and Deletion Request Runbook
- intake-repositories.test.ts
- @extrawork/application
- @typescript-eslint/eslint-plugin
- PdfRenderer
- Cross-Tenant IDOR Threat
- @extrawork/config
- @extrawork/integrations
- @extrawork/files
- fastify
- @extrawork/observability
- @extrawork/files
- @extrawork/observability
- @playwright/test
- user_identities
- vitest
- AGENTS.md
- @extrawork/api

## God Nodes (most connected - your core abstractions)
1. `TenantContext` - 122 edges
2. `TransactionContext` - 95 edges
3. `Database` - 77 edges
4. `AppError` - 73 edges
5. `newId()` - 54 edges
6. `authorize()` - 47 edges
7. `AppContext` - 45 edges
8. `RequestContext` - 45 edges
9. `toDate()` - 43 edges
10. `Repositories` - 37 edges

## Surprising Connections (you probably didn't know these)
- `A2 rejected with ASSURANCE_UNAVAILABLE` --semantically_similar_to--> `Not a licensed electronic signature disclaimer`  [INFERRED] [semantically similar]
  docs/IMPLEMENTATION_PLAN.md → README.md
- `allowBuilds native-dependency allowlist` --conceptually_related_to--> `Evidence pack (PDF + manifest)`  [AMBIGUOUS]
  pnpm-workspace.yaml → README.md
- `Launch gates (report §16.3)` --semantically_similar_to--> `Launch gates with owners`  [INFERRED] [semantically similar]
  README.md → docs/IMPLEMENTATION_PLAN.md
- `Evidence manifest and PDF template` --semantically_similar_to--> `Evidence pack (PDF + manifest)`  [INFERRED] [semantically similar]
  docs/IMPLEMENTATION_PLAN.md → README.md
- `Props` --references--> `AssuranceLevel`  [EXTRACTED]
  apps/web/src/app/r/[token]/otp-step.tsx → packages/contracts/src/primitives.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CI jobs that close automated launch blockers** — _github_workflows_ci_migrations, _github_workflows_ci_database, _github_workflows_ci_build, _github_workflows_ci_supply_chain, _github_workflows_ci_e2e, readme_launch_gates [EXTRACTED 1.00]
- **Deferred-provider adapter set** — docs_implementation_plan_nativesharegateway, docs_implementation_plan_whatsappcloudgateway, docs_implementation_plan_otp_a1, docs_implementation_plan_a2_esign_rejection, docs_implementation_plan_paymentgateway, docs_implementation_plan_mvp_posture [EXTRACTED 1.00]
- **Evidence Integrity Discipline Shared by All Runbooks** — infra_runbooks_readme_never_edit_evidence_by_hand, infra_runbooks_readme_two_connections, infra_runbooks_readme_verify_after_every_repair, infra_runbooks_readme_record_what_you_did, infra_runbooks_readme_repair_command [EXTRACTED 1.00]
- **Local development dependency stack** — docker_compose_db, docker_compose_minio, docker_compose_minio_init, docker_compose_mailpit, readme_local_dev_options [EXTRACTED 1.00]
- **Post-Restore Verification Sequence** — infra_runbooks_restore_database_stop_writes, infra_runbooks_restore_database_schema_verification_before_data, infra_runbooks_restore_database_audit_chain_verification, infra_runbooks_restore_database_projection_rebuild, infra_runbooks_restore_database_side_effect_reconciliation, infra_runbooks_repair_project_totals_repair_project_totals_runbook [EXTRACTED 1.00]
- **Credential and Access Exposure Response Family** — infra_runbooks_revoke_leaked_token_approval_token_revocation, infra_runbooks_rotate_credentials_rotation_order_of_operations, infra_runbooks_freeze_organization_bulk_token_revocation_on_compromise, infra_runbooks_cross_tenant_disclosure_cross_tenant_disclosure_runbook, infra_runbooks_support_access_customer_granted_time_bound_access [INFERRED 0.85]

## Communities (192 total, 46 thin omitted)

### Community 0 - "TransactionContext"
Cohesion: 0.08
Nodes (8): TransactionContext, newId(), generateOpaqueToken(), hashOpaqueToken(), IdentityRepository, mapUser(), SupportRepository, ScheduledReminder

### Community 1 - "AppError"
Cohesion: 0.08
Nodes (13): AppError, LocalObjectStore, LocalSignaturePayload, LocalStoreOptions, assertSafeKey(), ObjectMetadata, ObjectStore, PresignedUpload (+5 more)

### Community 2 - "audit.ts"
Cohesion: 0.07
Nodes (47): BuildEvidenceOptions, buildEvidenceViewModel(), EvidenceViewModel, formatInTimezone(), ActorType, hashRequest(), AuditEventRow, AuditWriter (+39 more)

### Community 3 - "approvals.ts"
Cohesion: 0.08
Nodes (17): AssuranceLevel, DecisionType, ApprovalRepository, ApprovalTokenRow, DECISION_COLUMNS, DECISION_COLUMNS_D, DecisionRecord, DecisionRow (+9 more)

### Community 4 - "change-orders/service.ts"
Cohesion: 0.13
Nodes (17): buildLineItemWrites(), toCalcInputs(), ADR-0005, versionEtag(), ChangeOrderService, ADR-0005, CreateChangeOrderInput, UpdateDraftInput (+9 more)

### Community 5 - "repositories/change-orders.ts"
Cohesion: 0.07
Nodes (25): VersionStatus, AttachmentRow, ChangeOrderRecord, ChangeOrderRow, ChangeOrderSummaryRecord, ChangeOrderSummaryRow, LineItemRow, mapChangeOrder() (+17 more)

### Community 6 - "schema/index.ts"
Cohesion: 0.04
Nodes (54): actorType, approvalTokens, assuranceLevel, auditEvents, authChallenges, baselineVersions, bigintNumeric, bytea (+46 more)

### Community 7 - "runner.ts"
Cohesion: 0.11
Nodes (25): classify(), delay(), JobHandler, JobRunner, RunnerOptions, startLeaseReaper(), truncate(), DOMAIN_EVENTS (+17 more)

### Community 9 - "Database"
Cohesion: 0.09
Nodes (7): ChangeType, Database, ChangeOrderRepository, mapVersion(), MessageRepository, WebhookInboxRepository, ReminderRepository

### Community 10 - "db/src/index.ts"
Cohesion: 0.06
Nodes (41): OutboxTopic, CreateDatabaseOptions, PgError, IdempotencyBeginResult, schema, OutboxEventInput, DOC_COLUMNS, DocumentRecord (+33 more)

### Community 11 - "policy.ts"
Cohesion: 0.13
Nodes (17): MembershipRole, AuthenticatedSessionContext, MembershipRow, Action, ACTIONS, Actor, hasProjectAccess(), isAllowed() (+9 more)

### Community 12 - "totals.ts"
Cohesion: 0.19
Nodes (15): DraftValidationInput, DraftValidationResult, validateDraft(), parseQuantity(), addDays(), calculateLine(), calculateVersionTotals(), deriveChangeType() (+7 more)

### Community 13 - "db/package.json"
Cohesion: 0.05
Nodes (37): drizzle-kit, dependencies, drizzle-orm, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, pg (+29 more)

### Community 14 - "runtime/src/index.ts"
Cohesion: 0.18
Nodes (12): actorContext(), asJson, config, container, force, [command, ...args], config, container (+4 more)

### Community 15 - "dependencies"
Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 16 - "testkit/package.json"
Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 17 - "plugins/rate-limit.ts"
Cohesion: 0.12
Nodes (32): buildApp(), authenticatedSubject(), hashForBucket(), ipSubject(), isAuthenticatedLimit(), publicTokenSubject(), rateLimit(), RateLimitOptions (+24 more)

### Community 18 - "organizations"
Cohesion: 0.14
Nodes (39): baseline_versions, approval_tokens, audit_events, change_order_versions, change_orders, data_subject_requests, decisions, document_sequences (+31 more)

### Community 19 - "intake-service.ts"
Cohesion: 0.07
Nodes (44): describe(), InboundWhatsAppMessage, IntakeOutcome, IntakeService, titleFrom(), validate(), InboundStatus, normalizeForSearch() (+36 more)

### Community 20 - "dependencies"
Cohesion: 0.06
Nodes (33): dependencies, @extrawork/contracts, next, react, react-dom, react-hook-form, @tanstack/react-query, zod (+25 more)

### Community 21 - "employee-manager.tsx"
Cohesion: 0.10
Nodes (24): ChangeActions(), RemindResult, EmployeeManager(), EMPTY, FormState, messageFor(), ProjectOption, OnboardingPage() (+16 more)

### Community 22 - "compilerOptions"
Cohesion: 0.06
Nodes (29): metadata, viewport, dist, .next, compilerOptions, allowSyntheticDefaultImports, declaration, declarationMap (+21 more)

### Community 23 - "outbox-pump.ts"
Cohesion: 0.13
Nodes (15): registerHealthRoutes(), shutdown(), stopLeaseReaper, delay(), EnqueueInput, jobsFor(), OutboxPump, ADR-0003 (+7 more)

### Community 24 - "reset.ts"
Cohesion: 0.12
Nodes (16): assertLocalDatabase(), DatabaseTarget, describeTarget(), LOCAL_HOSTS, config, pool, config, databaseName (+8 more)

### Community 25 - "app.ts"
Cohesion: 0.09
Nodes (26): BuildAppOptions, clientIp(), contextPlugin(), ContextPluginOptions, fastify, FastifyInstance, FastifyRequest, headerOrganizationId() (+18 more)

### Community 26 - "composer.tsx"
Cohesion: 0.11
Nodes (26): OfflineBanner(), useOnlineStatus(), Composer(), estimateLine(), Props, toApiPayload(), ADR-0005, zodResolver() (+18 more)

### Community 27 - "scripts"
Cohesion: 0.06
Nodes (34): scripts, build, build:packages, build:server, db:harden, db:migrate, db:repair, db:replay (+26 more)

### Community 28 - "validation.ts"
Cohesion: 0.14
Nodes (13): ALLOWED_UPLOAD_MIME_TYPES, AllowedMimeType, MAX_FILE_BYTES, ClamAvScanner, EICAR, FileProcessResult, ScanResult, ScanVerdict (+5 more)

### Community 29 - "api/projects.ts"
Cohesion: 0.09
Nodes (29): fullProject(), IdParams, ProjectRowLike, projectTotalsDto(), registerProjectRoutes(), summariseProject(), summaryDto(), ChangeOrderSummarySchema (+21 more)

### Community 30 - "send.ts"
Cohesion: 0.23
Nodes (12): firstName(), SendResult, SendChangeOrderInput, resolveExpiry(), assertQuota(), checkQuota(), quotaMessage(), maskEmail() (+4 more)

### Community 31 - "runtime/package.json"
Cohesion: 0.07
Nodes (27): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+19 more)

### Community 32 - "contracts/src/index.ts"
Cohesion: 0.12
Nodes (22): dynamic, dynamic, EmployeesPage(), dynamic, dynamic, dynamic, dynamic, dynamic (+14 more)

### Community 33 - "application/package.json"
Cohesion: 0.08
Nodes (25): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations, @extrawork/observability (+17 more)

### Community 34 - "devDependencies"
Cohesion: 0.08
Nodes (25): eslint, eslint-plugin-react-hooks, @extrawork/testkit, fast-check, @next/eslint-plugin-next, devDependencies, drizzle-orm, eslint (+17 more)

### Community 35 - "main.ts"
Cohesion: 0.12
Nodes (25): workerContext, EVIDENCE_GENERATOR_VERSION, EvidencePayload, generateEvidence(), truncate(), scanFile(), ScanPayload, applyRetention() (+17 more)

### Community 36 - "integrations/package.json"
Cohesion: 0.08
Nodes (24): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, nodemailer, devDependencies, @types/nodemailer (+16 more)

### Community 37 - "config/src/index.ts"
Cohesion: 0.13
Nodes (17): loadEnvFile(), anchorLocalPaths(), assertProductionSafe(), booleanish, config(), ConfigError, csv, DEVELOPMENT_PLACEHOLDERS (+9 more)

### Community 38 - "primitives.ts"
Cohesion: 0.08
Nodes (31): ApproverSchema, AttachmentDto, AuditEventDto, ChangeOrderSchema, ChangeOrderSummaryDto, ChangeOrderVersionDto, ChangeOrderVersionSchema, DecisionDto (+23 more)

### Community 39 - "files/package.json"
Cohesion: 0.08
Nodes (23): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @extrawork/config, @extrawork/contracts, @extrawork/observability (+15 more)

### Community 40 - "api.ts"
Cohesion: 0.09
Nodes (22): Challenge, OtpStep(), Props, dynamic, OutboxRecord, SendResult, SimEmployee, SimulatorConsole() (+14 more)

### Community 41 - "ExtraWork — Current Project Handoff"
Cohesion: 0.05
Nodes (42): 10. Security and evidence invariants, 11. Performance investigation and changes, 12. Local development and testing, 13. Current real WhatsApp implementation gap, 14. Most recent WhatsApp Business decisions, 15. Clear next steps, 16. Open decisions and risks, 17. Repository and documentation notes (+34 more)

### Community 42 - "document.ts"
Cohesion: 0.12
Nodes (21): buildOpenApiDocument(), commonErrors, componentSchemas, errorResponse(), idempotencyHeader, ifMatchHeader, jsonBody(), JsonObject (+13 more)

### Community 43 - "api/customers.ts"
Cohesion: 0.12
Nodes (16): ContactInput, ContactInputSchema, ContactSchema, CreateCustomerSchema, CustomerSchema, DuplicateCandidateDto, DuplicateCandidateSchema, ListCustomersQuerySchema (+8 more)

### Community 44 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, allowJs, incremental, jsx, lib, moduleResolution, noEmit, paths (+13 more)

### Community 45 - "domain/src/index.ts"
Cohesion: 0.06
Nodes (27): IdParams, OtpChallengeResult, SendService, AppContext, AuthenticatedIdentity, AuthProvider, AuthService, signInUrl() (+19 more)

### Community 46 - "decision-panel.tsx"
Cohesion: 0.11
Nodes (23): DecisionPanel(), messageFor(), Props, Receipt(), satisfies(), Stage, decisionLabel(), dynamic (+15 more)

### Community 47 - "0002_search_and_projections.sql"
Cohesion: 0.16
Nodes (18): change_order_versions_touch, change_orders_search_trigger(), change_orders_search_update, change_orders_touch, contacts_touch, customers_search_trigger(), customers_search_update, customers_touch (+10 more)

### Community 48 - "integrations/src/index.ts"
Cohesion: 0.14
Nodes (10): RFC-822, createEmailDriver(), createIntegrations(), createWhatsAppGateway(), ConsoleEmailDriver, EmailDriver, EmailGateway, EmailMessage (+2 more)

### Community 49 - "Adapter-with-deferred-driver MVP posture"
Cohesion: 0.12
Nodes (20): A2 rejected with ASSURANCE_UNAVAILABLE, 32-byte approval token, SHA-256 stored, Defect: CHECK constraints made a cancelled draft unrepresentable, Defect: 'code' in the log redaction list, Defect: public session cookie discarded during SSR, Server-side entitlements and lapse read/export mode, Adapter-with-deferred-driver MVP posture, NativeShareGateway (+12 more)

### Community 50 - "gateways.ts"
Cohesion: 0.14
Nodes (10): CreatePaymentCommand, DisabledPaymentGateway, OutboundTemplate, PaymentGateway, PaymentOrderRef, mapPaymentStatus(), RazorpayEntity, RazorpayGateway (+2 more)

### Community 51 - "state-machine.ts"
Cohesion: 0.17
Nodes (13): canTransition(), isEditable(), isTerminal(), nextStatus(), OPEN_STATUSES, STATUS_LABEL, TERMINAL_STATUSES, TRANSITIONS (+5 more)

### Community 52 - "domain/package.json"
Cohesion: 0.11
Nodes (17): decimal.js, libphonenumber-js, dependencies, decimal.js, @extrawork/contracts, libphonenumber-js, exports, @extrawork/contracts (+9 more)

### Community 53 - "TenantContext"
Cohesion: 0.09
Nodes (9): ProjectStatus, EmployeeRepository, mapEmployeeWithAssignments(), translateUniqueViolation(), mapProject(), ProjectRepository, ProjectRow, ReportingRepository (+1 more)

### Community 54 - "0003_append_only_evidence.sql"
Cohesion: 0.17
Nodes (16): audit_events_append_only(), audit_events_no_delete, audit_events_no_update, baseline_versions_append_only(), baseline_versions_no_update, decisions_append_only(), decisions_no_delete, decisions_no_update (+8 more)

### Community 55 - "auth.ts"
Cohesion: 0.15
Nodes (12): CSRF_COOKIE, SESSION_COOKIE, GoogleCallbackSchema, PasswordSignInSchema, registerAuthRoutes(), RegisterSchema, RequestSignInSchema, setSessionCookies() (+4 more)

### Community 56 - "observability/package.json"
Cohesion: 0.11
Nodes (17): dependencies, @extrawork/config, pino, pino-pretty, exports, @extrawork/config, main, name (+9 more)

### Community 57 - "CI job: Integration, security and golden tests"
Cohesion: 0.15
Nodes (17): One CI job per launch blocker, CI job: Integration, security and golden tests, CI job: End-to-end (Playwright), Migration idempotency check, CI job: Migration lint, Ephemeral PostgreSQL 16 CI service, CI job: Format, lint, typecheck, CI job: Unit and property tests (+9 more)

### Community 58 - "Compose service: api"
Cohesion: 0.15
Nodes (17): CI placeholder secrets, Compose service: api, Shared app-env anchor, app compose profile, C collation for reproducible index behaviour, Compose service: db (PostgreSQL 16), Compose service: mailpit, Compose service: minio (+9 more)

### Community 59 - "money.ts"
Cohesion: 0.15
Nodes (7): assertInt64(), currencySymbol(), MINOR_UNITS, minorUnitScale(), Money, normalizeCurrency(), toIntegerBigint()

### Community 60 - "approvals/assurance.ts"
Cohesion: 0.17
Nodes (8): OtpService, ASSURANCE_COPY, assuranceSatisfies(), assertAssuranceAvailable(), assertAssuranceSatisfied(), AssuranceCapabilities, PublicSessionAssurance, assertOtpSendAllowed()

### Community 61 - "messaging.ts"
Cohesion: 0.20
Nodes (21): firstName(), notifyTeamDecision(), ReceiptPayload, ReminderPayload, RequestMessagePayload, sendDecisionReceipt(), sendReminder(), sendRequestMessage() (+13 more)

### Community 62 - "authorize"
Cohesion: 0.09
Nodes (21): RequestContext, decodeInboundCursor(), EmployeeService, encodeInboundCursor(), FileService, ProjectService, CreateCustomerInput, CreateUploadInput (+13 more)

### Community 63 - "Moving off this machine: Supabase + Cloudflare R2"
Cohesion: 0.17
Nodes (11): 1. Supabase, 2. Cloudflare R2, 3. Put the values in `.env` yourself, 4. Run the migration, 5. Verify, Before you start, Gotchas found doing this for real, Moving off this machine: Supabase + Cloudflare R2 (+3 more)

### Community 64 - "Record What You Did"
Cohesion: 0.15
Nodes (16): Export Never Gated on Billing Status, export-subject.ts Export CLI, Legal Hold, Organization Account Deletion with 30-Day Grace, Bulk Token Revocation on Account Compromise, Freeze One Organization Runbook, Live Approval Tokens Survive a Freeze, ORGANIZATION_SUSPENDED Status (+8 more)

### Community 65 - "jobs/webhooks.ts"
Cohesion: 0.24
Nodes (9): applyMessageStatus(), mapMessageStatuses(), NormalizedStatus, normalizeWebhook(), STATUS_RANK, toNormalizedStatus(), WebhookPayload, PermanentJobError (+1 more)

### Community 66 - "Restore Database and Verify Audit Chains Runbook"
Cohesion: 0.16
Nodes (15): Backups, Health Checks and Restore Rehearsal Runbook, Backup Freshness Alert, Backup Schedule and Retention Matrix, scripts/backup.sh, Daily Logical Dump, Managed PostgreSQL PITR, Measured RTO Target, Monthly Restore Rehearsal (+7 more)

### Community 67 - "dashboard/page.tsx"
Cohesion: 0.19
Nodes (11): ChangeTable(), DashboardPage(), dynamic, ProjectsPage(), RequestsPage(), truncate(), LABELS, StatusChip() (+3 more)

### Community 68 - "config/package.json"
Cohesion: 0.14
Nodes (13): dependencies, zod, exports, zod, main, name, private, scripts (+5 more)

### Community 69 - "contracts/package.json"
Cohesion: 0.14
Nodes (13): dependencies, zod, exports, zod, main, name, private, scripts (+5 more)

### Community 70 - "ProviderMessageRef"
Cohesion: 0.27
Nodes (6): OtpDeliveryCommand, OtpGateway, ProviderMessageRef, ConsoleOtpGateway, MessageGatewayOtpGateway, UnavailableOtpGateway

### Community 71 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, drizzle-orm, @extrawork/db, @extrawork/integrations, @extrawork/runtime, @fastify/cookie, @fastify/cors, drizzle-orm (+5 more)

### Community 73 - "src/rate-limit.ts"
Cohesion: 0.13
Nodes (9): InMemoryRateLimiter, LocalReadRateLimiter, PostgresRateLimiter, RATE_LIMITS, RateLimiter, RateLimitResult, RateLimitRule, resultFor() (+1 more)

### Community 74 - "container.ts"
Cohesion: 0.15
Nodes (9): Clock, systemClock, createAuthProvider(), createServices(), PostgresUnitOfWork, createRepositories(), createScanner(), ContainerOptions (+1 more)

### Community 75 - "Non-Erasable Decision Record"
Cohesion: 0.22
Nodes (10): erase-contact.ts Pseudonymisation CLI, Non-Erasable Decision Record, Migration Checksum Guard, Never Edit Evidence By Hand, Verify Schema Before Data, A0 Bearer-Link Assurance Level, Corrective Change to Undo an Approval, Spent Token With Recorded Decision (+2 more)

### Community 76 - "api/package.json"
Cohesion: 0.25
Nodes (7): exports, ./app, main, name, private, type, version

### Community 77 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 78 - "harden.ts"
Cohesion: 0.18
Nodes (6): APPEND_ONLY_TABLES, config, dryRun, FROZEN_TABLES, pool, statements

### Community 79 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 80 - "token.ts"
Cohesion: 0.26
Nodes (8): buildApprovalUrl(), generateApprovalToken(), GeneratedToken, hashesEqual(), hashToken(), TOKEN_BYTES, TOKEN_LENGTH, TokenRecord

### Community 81 - "ExtraWork Technical Design Report and Master Build Specification v1.0"
Cohesion: 0.24
Nodes (10): CI job: Build web, API and worker, OpenAPI drift check, Build order S1–S10, Module map to package, Requirement traceability matrix, ExtraWork Technical Design Report and Master Build Specification v1.0, Workspace package globs (apps/*, packages/*), Enforced dependency direction (+2 more)

### Community 82 - "webhook-normalisation.test.ts"
Cohesion: 0.12
Nodes (23): createPool(), sslConfig(), createSilentLogger(), Container, publicContext(), createTestContainer(), ensureMigrated(), PRESERVED_TABLES (+15 more)

### Community 83 - "e2e/fixtures.ts"
Cohesion: 0.27
Nodes (6): ApprovalLink, HELPER, ROOT, run, Scenario, seedScenario()

### Community 84 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, declarationMap, module, moduleResolution, noEmit, extends, ./tsconfig.json

### Community 85 - "providers.tsx"
Cohesion: 0.38
Nodes (3): AppNav(), LINKS, Providers()

### Community 86 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, declarationMap, module, moduleResolution, noEmit, extends, ./tsconfig.json

### Community 87 - "Evidence pack (PDF + manifest)"
Cohesion: 0.28
Nodes (9): Private versioned bucket policy, Audit hash chain, Canonical JSON (JCS) + SHA-256 digest, Defect: manifest digest computed over its own wrapper, Defect: public decision ETag from lock_version, Evidence manifest and PDF template, Evidence pack (PDF + manifest), A sent version is frozen (+1 more)

### Community 88 - "application/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 89 - "config/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 90 - "contracts/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 91 - "db/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 92 - "domain/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 93 - "files/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 94 - "integrations/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 95 - "observability/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 96 - "runtime/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 97 - "testkit/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 98 - "ui/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 99 - "repositories/organizations.ts"
Cohesion: 0.07
Nodes (21): AuthenticatedSessionRecord, SessionRow, UserRecord, UserRow, mapOrganization(), ORG_COLUMNS, OrganizationRecord, OrganizationRepository (+13 more)

### Community 100 - "Preserve Evidence Then Contain"
Cohesion: 0.25
Nodes (8): Preserve Evidence Then Contain, Pseudonymous Log Correlation by requestId, PRIVACY_HASH_SECRET, Customer-Granted Time-Bound Access, Metadata-Only by Default, support_access_grants Record, Grant and Revoke Support Access Runbook, SUPPORT Actor Type Auditing

### Community 101 - "package.json"
Cohesion: 0.25
Nodes (7): description, engines, node, name, packageManager, private, version

### Community 103 - "Audited Repair Command"
Cohesion: 0.33
Nodes (7): extrawork.allow_repair Repair Mode Flag, Audited Repair Command, Two Connections: Runtime vs Maintenance Role, Diagnose Cause Before Rebuild, repair-project-totals.ts Rebuild CLI, Bounded Replay Only, Revocation Is Not Evidence

### Community 104 - "Replay Webhook and Outbox Events Runbook"
Cohesion: 0.29
Nodes (7): Dead-Letter Diagnosis Before Replay, PermanentJobError, Replay Webhook and Outbox Events Runbook, Meta WhatsApp App Secret Rotation, Payment Webhooks Are the Authority for Payment State, Razorpay Webhook Secret Rotation, Add, Switch, Observe, Remove

### Community 105 - "ExtraWork — Project Handoff"
Cohesion: 0.06
Nodes (30): 10. Test inventory, 11. Open questions for the founder, 1. What the product is, 2. Current status in one table, 3. How to get running (5 minutes), 4. Architecture, 5. The product pivot (this is the important part), 6.1 Company field is optional, not required (+22 more)

### Community 107 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, openapi, start, typecheck

### Community 108 - "api/reports.ts"
Cohesion: 0.17
Nodes (11): ApprovedChangeExport, ApprovedChangeExportSchema, CreateEvidencePackSchema, ExportJobDto, ExportJobSchema, ExtraWorkReportDto, ExtraWorkReportRow, ExtraWorkReportRowSchema (+3 more)

### Community 109 - "Append-only evidence"
Cohesion: 0.33
Nodes (6): Append-only via denied UPDATE/DELETE privileges, Defect: job handlers read tenant from payload, TenantContext required on every repository, Append-only evidence, db:harden restricted runtime role, Health and metrics endpoints

### Community 110 - "Job queue with lease, dead-letter and priorities"
Cohesion: 0.33
Nodes (6): Defect: outbox pump duplicated atomically enqueued jobs, Idempotency key (scope, subject, key), Job queue with lease, dead-letter and priorities, UnitOfWork atomic domain+audit+outbox commit, Atomic and idempotent decisions, No provider call inside a transaction

### Community 112 - "metrics"
Cohesion: 0.26
Nodes (5): labelKey(), Labels, metrics, MetricsRegistry, Series

### Community 113 - "project_integrity_mismatches"
Cohesion: 0.40
Nodes (6): INTEGRITY_REVIEW Project State, Nightly Project Integrity Job, project_integrity_mismatches(), Approved Delta Projection Drift, Repair Incorrect Project Totals Runbook, Projection Rebuild After Restore

### Community 114 - "reminders/reminders.ts"
Cohesion: 0.22
Nodes (12): isOpenForDecision(), buildReminderSchedule(), DEFAULT_REMINDER_POLICY, localHourIn(), nextLocalWindow(), ReminderChannel, ReminderContext, ReminderDecision (+4 more)

### Community 115 - "whatsapp.ts"
Cohesion: 0.12
Nodes (14): buildCloudApiPayload(), mapDeliveryStatus(), MetaWebhookPayload, payloadFingerprint(), STATUS_RANK, WHATSAPP_TEMPLATE_LANGUAGE, WHATSAPP_TEMPLATES, WhatsAppCloudGateway (+6 more)

### Community 116 - ".prettierrc.json"
Cohesion: 0.33
Nodes (5): arrowParens, printWidth, semi, singleQuote, trailingComma

### Community 117 - "evidence.test.ts"
Cohesion: 0.18
Nodes (4): FixedClock, approvedFixture(), clock, viewModel()

### Community 119 - "sequences.ts"
Cohesion: 0.26
Nodes (9): ORG_SCOPE_UUID, allocateNumber(), peekNextNumber(), DEFAULT_FORMATS, formatDocumentNumber(), NumberFormat, SEQUENCE_KINDS, SequenceKind (+1 more)

### Community 120 - "api/organizations.ts"
Cohesion: 0.10
Nodes (20): CreateOrganizationInput, CurrentUserDto, CurrentUserSchema, EntitlementsDto, EntitlementsSchema, GstinSchema, InviteMembershipInput, InviteMembershipSchema (+12 more)

### Community 122 - "Operational Runbooks Index"
Cohesion: 0.22
Nodes (11): Cross-Tenant Disclosure Response Runbook, Concurrent Index Rebuild, Expand-and-Contract Migrations, Failed Migration Recovery Runbook, Fix Forward or Roll Back the Code, Per-Migration Transaction Atomicity, Operational Runbooks Index, Auth Provider JWKS Key Rollover (+3 more)

### Community 124 - "MessageGateway"
Cohesion: 0.17
Nodes (7): MessageGateway, OutboundMessage, ProviderEvent, NativeShareWhatsAppGateway, SimulatedOutboundRecord, SimulatorOptions, SimulatorWhatsAppGateway

### Community 126 - "exports.ts"
Cohesion: 0.32
Nodes (7): csvCell(), EXPORT_TEMPLATE_VERSION, ExportPayload, generateExport(), HEADERS, toCsv(), RFC-4180

### Community 128 - "api/employees.ts"
Cohesion: 0.08
Nodes (22): CustomerSummarySchema, CreateEmployeeInput, CreateEmployeeSchema, EmployeeListSchema, EmployeeSchema, EmployeeStatus, EmployeeStatusSchema, InboundMessageDto (+14 more)

### Community 135 - "password.ts"
Cohesion: 0.32
Nodes (6): RFC-7914, hashPassword(), MIN_PASSWORD_LENGTH, OBVIOUS, scrypt(), verifyPassword()

### Community 136 - "decide.ts"
Cohesion: 0.19
Nodes (14): DecideCommand, DecisionReceipt, DecisionService, DECLARATIONS, etagMatches(), DecisionInput, beginIdempotent(), completeIdempotent() (+6 more)

### Community 142 - "dev-lan.sh"
Cohesion: 0.29
Nodes (6): API_HOST, API_PUBLIC_URL, CORS_ALLOWED_ORIGINS, NEXT_PUBLIC_API_URL, dev-lan.sh script, WEB_PUBLIC_URL

### Community 143 - "Handler Idempotency"
Cohesion: 0.29
Nodes (8): Object Storage Bucket Versioning, Regenerable Evidence PDFs, claimForGeneration State Guard, Decisions Are Never Replayable, Handler Idempotency, Message dedupe_key Check, replay.ts Audited Replay Command, Side Effect Reconciliation After Rewind

### Community 144 - "format.ts"
Cohesion: 0.23
Nodes (16): ChangePage(), dynamic, EventsResponse, ProjectPage(), ReportsPage(), dynamic, ReceiptPage(), RequestSummary() (+8 more)

### Community 148 - "public-view.ts"
Cohesion: 0.15
Nodes (13): PublicApprovalService, summariseAddress(), publicDecisionEtag(), PublicRequestContext, APPROVAL_DECLARATION, assuranceCopy, DECLINE_DECLARATION, EVIDENCE_DISCLAIMER (+5 more)

### Community 162 - "api/change-orders.ts"
Cohesion: 0.09
Nodes (25): IdParams, ProjectIdParams, summariseEvent(), CancelChangeOrderSchema, ChangeOrderEventsDto, ChangeOrderEventsSchema, ChangeOrderVersionListSchema, CreateChangeOrderSchema (+17 more)

### Community 163 - "ExtraWork — Product Brief"
Cohesion: 0.17
Nodes (11): Business owner or administrator, Core product value, Customer or authorized approver, End-to-end workflow, ExtraWork — Product Brief, Field employee, Later expansion, MVP scope (+3 more)

### Community 164 - "domain/src/approvals/otp.ts"
Cohesion: 0.18
Nodes (12): GeneratedOtp, generateOtp(), hashOtp(), OTP_DAILY_LIMIT, OTP_DIGITS, OTP_RESEND_COOLDOWN_SECONDS, OTP_WINDOW_LIMIT, OTP_WINDOW_MINUTES (+4 more)

### Community 165 - "logger.ts"
Cohesion: 0.39
Nodes (5): createLogger(), LoggerContext, redact(), REDACTED_KEYS, redactString()

### Community 166 - "api/files.ts"
Cohesion: 0.25
Nodes (7): CompleteUploadSchema, CreateUploadSchema, FileObjectDto, FileObjectSchema, PresignedUploadSchema, UploadPurpose, UploadPurposeSchema

### Community 167 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, tsx, typescript, tsx, typescript

### Community 169 - "intake-service.test.ts"
Cohesion: 0.48
Nodes (6): addEmployee(), GOOD_MESSAGE, nextMessageId(), nextPhone(), raiseAndDecide(), send()

### Community 171 - "replay.ts"
Cohesion: 0.07
Nodes (26): collectCodes(), collectMessages(), DescribedError, describeError(), formatCliError(), NodeError, redactUrl(), config (+18 more)

### Community 172 - "Data Access, Export and Deletion Request Runbook"
Cohesion: 0.33
Nodes (6): Blast Radius Determination, DPDP Data Fiduciary Notification, Data Access, Export and Deletion Request Runbook, Erasure Versus Contractual Evidence Tension, Requester Role Triage, Single-Tenant Blast Radius Check

### Community 173 - "intake-repositories.test.ts"
Cohesion: 0.70
Nodes (4): addEmployee(), nextMessageId(), nextPhone(), record()

### Community 177 - "Cross-Tenant IDOR Threat"
Cohesion: 0.50
Nodes (4): Cross-Tenant IDOR Threat, Tenant Authorization Rule, TenantContext Repository Scope, Tenant Isolation Negative Corpus

## Ambiguous Edges - Review These
- `allowBuilds native-dependency allowlist` → `Evidence pack (PDF + manifest)`  [AMBIGUOUS]
  pnpm-workspace.yaml · relation: conceptually_related_to

## Knowledge Gaps
- **970 isolated node(s):** `printWidth`, `singleQuote`, `trailingComma`, `semi`, `arrowParens` (+965 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **46 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `allowBuilds native-dependency allowlist` and `Evidence pack (PDF + manifest)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `TenantContext` connect `TenantContext` to `TransactionContext`, `audit.ts`, `approvals.ts`, `repositories/organizations.ts`, `repositories/change-orders.ts`, `FileRepository`, `Database`, `db/src/index.ts`, `RequestTemplateRepository`, `policy.ts`, `domain/src/index.ts`, `intake-service.ts`, `sequences.ts`, `DocumentRepository`, `authorize`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `AppError` connect `AppError` to `audit.ts`, `approvals.ts`, `change-orders/service.ts`, `repositories/change-orders.ts`, `password.ts`, `decide.ts`, `db/src/index.ts`, `policy.ts`, `totals.ts`, `plugins/rate-limit.ts`, `intake-service.ts`, `public-view.ts`, `app.ts`, `validation.ts`, `send.ts`, `api/change-orders.ts`, `main.ts`, `domain/src/approvals/otp.ts`, `api.ts`, `domain/src/index.ts`, `integrations/src/index.ts`, `gateways.ts`, `state-machine.ts`, `auth.ts`, `money.ts`, `approvals/assurance.ts`, `authorize`, `token.ts`, `webhook-normalisation.test.ts`, `repositories/organizations.ts`, `whatsapp.ts`, `sequences.ts`, `MessageGateway`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `LocalObjectStore` connect `AppError` to `plugins/rate-limit.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `printWidth`, `singleQuote`, `trailingComma` to the rest of the system?**
  _970 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TransactionContext` be split into smaller, more focused modules?**
  _Cohesion score 0.08246225319396051 - nodes in this community are weakly interconnected._
- **Should `AppError` be split into smaller, more focused modules?**
  _Cohesion score 0.07591836734693877 - nodes in this community are weakly interconnected._