# Graph Report - extrawork  (2026-08-18)

## Corpus Check
- 316 files · ~216,489 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3136 nodes · 6659 edges · 192 communities (150 shown, 42 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 125 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0511d253`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TransactionContext
- files/src/index.ts
- chain.ts
- renderer.ts
- change-orders/service.ts
- TenantContext
- schema/index.ts
- runner.ts
- approvals.ts
- Database
- db/src/index.ts
- AppError
- employee-manager.tsx
- db/package.json
- seed.ts
- dependencies
- testkit/package.json
- app.ts
- organizations
- money.ts
- dependencies
- api.ts
- compilerOptions
- reset.ts
- repositories/employees.ts
- plugins/context.ts
- composer.tsx
- scripts
- auth.ts
- api/projects.ts
- main.ts
- runtime/package.json
- dashboard/page.tsx
- application/package.json
- devDependencies
- audit.ts
- integrations/package.json
- replay.ts
- primitives.ts
- files/package.json
- simulator-console.tsx
- ExtraWork — Current Project Handoff
- document.ts
- api/customers.ts
- compilerOptions
- services.ts
- contracts/src/index.ts
- 0002_search_and_projections.sql
- email.ts
- Adapter-with-deferred-driver MVP posture
- razorpay.ts
- domain/src/index.ts
- domain/package.json
- repositories/change-orders.ts
- 0003_append_only_evidence.sql
- api/files.ts
- observability/package.json
- CI job: Integration, security and golden tests
- Compose service: api
- harden.ts
- decide.ts
- messaging.ts
- authorize
- Moving off this machine: Supabase + Cloudflare R2
- Record What You Did
- Product
- Restore Database and Verify Audit Chains Runbook
- DocumentRepository
- config/package.json
- contracts/package.json
- ProviderMessageRef
- dependencies
- build.ts
- src/rate-limit.ts
- evidence.test.ts
- Non-Erasable Decision Record
- api/package.json
- compilerOptions
- Design
- compilerOptions
- @extrawork/db
- ExtraWork Technical Design Report and Master Build Specification v1.0
- webhook-normalisation.test.ts
- e2e/fixtures.ts
- compilerOptions
- app-shell.tsx
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
- jcs.ts
- Audited Repair Command
- Replay Webhook and Outbox Events Runbook
- ExtraWork — Project Handoff
- integrations/src/index.ts
- scripts
- intake-service.ts
- Append-only evidence
- Job queue with lease, dead-letter and priorities
- @extrawork/contracts
- metrics
- project_integrity_mismatches
- Handler Idempotency
- whatsapp.ts
- .prettierrc.json
- parse-message.ts
- next.config.mjs
- sequences.ts
- outbox-pump.ts
- inbound-intake.test.ts
- Operational Runbooks Index
- @extrawork/domain
- MessageGateway
- inbound.ts
- canonicalize
- @fastify/helmet
- api/employees.ts
- zod-to-json-schema
- next-env.d.ts
- @extrawork/db
- query-keys.ts
- Money and totals engine
- api/organizations.ts
- intake-service.test.ts
- Decision Write Path Priority
- pdfjs-dist
- @extrawork/contracts
- @types/node
- @typescript-eslint/parser
- dev-lan.sh
- section63.ts
- format.ts
- zod
- typescript-eslint
- InboundMessageRepository
- send.ts
- backup.sh
- restore.sh
- verify-backup.sh
- vitest.workspace.ts
- CI job: Dependency and secret scan
- Constraint Violation Means Real Bad Data
- api/change-orders.ts
- ExtraWork — Product Brief
- Cross-Tenant IDOR Threat
- config/src/index.ts
- Repositories
- devDependencies
- reminders/reminders.ts
- match.ts
- CLAUDE.md
- @eslint/js
- tenant.ts
- exports.ts
- @extrawork/config
- @typescript-eslint/eslint-plugin
- IntakeService
- @extrawork/application
- @extrawork/config
- drizzle-orm
- @extrawork/files
- fastify
- @extrawork/observability
- @extrawork/files
- @extrawork/observability
- @playwright/test
- vitest
- projects
- AGENTS.md
- @extrawork/api

## God Nodes (most connected - your core abstractions)
1. `TenantContext` - 122 edges
2. `TransactionContext` - 97 edges
3. `Database` - 78 edges
4. `AppError` - 74 edges
5. `newId()` - 56 edges
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

## Communities (192 total, 42 thin omitted)

### Community 0 - "TransactionContext"
Cohesion: 0.08
Nodes (11): TransactionContext, beginIdempotent(), hashRequest(), IdempotencyBeginResult, newId(), generateOpaqueToken(), hashOpaqueToken(), IdentityRepository (+3 more)

### Community 1 - "files/src/index.ts"
Cohesion: 0.06
Nodes (24): ALLOWED_UPLOAD_MIME_TYPES, AllowedMimeType, MAX_FILE_BYTES, LocalObjectStore, LocalSignaturePayload, LocalStoreOptions, assertSafeKey(), ObjectMetadata (+16 more)

### Community 2 - "chain.ts"
Cohesion: 0.29
Nodes (7): canonicalEventBody(), chainEvents(), ChainVerificationResult, computeEventHash(), verifyChain(), verifyChainFrom(), RFC-8785

### Community 3 - "renderer.ts"
Cohesion: 0.17
Nodes (4): ChromiumPdfRenderer, PdfRenderer, UnavailablePdfRenderer, METRIC

### Community 4 - "change-orders/service.ts"
Cohesion: 0.10
Nodes (30): buildLineItemWrites(), etagMatches(), toCalcInputs(), ADR-0005, versionEtag(), ChangeOrderService, ADR-0005, CreateChangeOrderInput (+22 more)

### Community 5 - "TenantContext"
Cohesion: 0.09
Nodes (5): FileRepository, ProjectRepository, ReportingRepository, RequestTemplateRepository, TenantContext

### Community 6 - "schema/index.ts"
Cohesion: 0.04
Nodes (55): actorType, approvalTokens, assuranceLevel, auditEvents, authChallenges, baselineVersions, bigintNumeric, bytea (+47 more)

### Community 7 - "runner.ts"
Cohesion: 0.13
Nodes (21): classify(), delay(), JobRunner, RunnerOptions, startLeaseReaper(), truncate(), DomainEventType, JOB_KINDS (+13 more)

### Community 8 - "approvals.ts"
Cohesion: 0.08
Nodes (15): DecisionType, ApprovalRepository, ApprovalTokenRow, DECISION_COLUMNS, DECISION_COLUMNS_D, DecisionRecord, DecisionRow, mapDecision() (+7 more)

### Community 9 - "Database"
Cohesion: 0.07
Nodes (8): AssuranceLevel, ChangeType, Database, ChangeOrderRepository, mapVersion(), MessageRepository, WebhookInboxRepository, ReminderRepository

### Community 10 - "db/src/index.ts"
Cohesion: 0.08
Nodes (33): CreateDatabaseOptions, PgError, schema, mapPublicSession(), mapSummary(), DOC_COLUMNS, DocumentRecord, GeneratedDocumentRow (+25 more)

### Community 11 - "AppError"
Cohesion: 0.12
Nodes (15): registerErrorHandler(), toAppError(), zodDetails(), AppError, translateDatabaseError(), Action, ACTIONS, hasProjectAccess() (+7 more)

### Community 12 - "employee-manager.tsx"
Cohesion: 0.23
Nodes (11): EmployeeManager(), EMPTY, FormState, messageFor(), ProjectOption, dynamic, NewProjectPage(), projectFormError() (+3 more)

### Community 13 - "db/package.json"
Cohesion: 0.05
Nodes (37): drizzle-kit, dependencies, drizzle-orm, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, pg (+29 more)

### Community 14 - "seed.ts"
Cohesion: 0.17
Nodes (12): asJson, config, container, force, [command, ...args], config, container, decideAs() (+4 more)

### Community 15 - "dependencies"
Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 16 - "testkit/package.json"
Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 17 - "app.ts"
Cohesion: 0.13
Nodes (36): buildApp(), authenticatedSubject(), hashForBucket(), ipSubject(), isAuthenticatedLimit(), publicTokenSubject(), rateLimit(), RateLimitOptions (+28 more)

### Community 18 - "organizations"
Cohesion: 0.17
Nodes (28): approval_tokens, audit_events, change_order_versions, data_subject_requests, decisions, document_sequences, entitlement_counters, generated_documents (+20 more)

### Community 19 - "money.ts"
Cohesion: 0.15
Nodes (7): assertInt64(), currencySymbol(), MINOR_UNITS, minorUnitScale(), Money, normalizeCurrency(), toIntegerBigint()

### Community 20 - "dependencies"
Cohesion: 0.06
Nodes (33): dependencies, @extrawork/contracts, next, react, react-dom, react-hook-form, @tanstack/react-query, zod (+25 more)

### Community 21 - "api.ts"
Cohesion: 0.08
Nodes (32): ChangeActions(), RemindResult, OnboardingPage(), ProfileForm(), TemplateEditor(), dynamic, RegisterForm(), SignInForm() (+24 more)

### Community 22 - "compilerOptions"
Cohesion: 0.06
Nodes (31): metadata, viewport, archivo, splineMono, dist, .next, compilerOptions, allowSyntheticDefaultImports (+23 more)

### Community 23 - "reset.ts"
Cohesion: 0.11
Nodes (17): assertLocalDatabase(), DatabaseTarget, describeTarget(), LOCAL_HOSTS, config, pool, config, databaseName (+9 more)

### Community 24 - "repositories/employees.ts"
Cohesion: 0.15
Nodes (10): EMPLOYEE_COLUMNS, EMPLOYEE_WITH_ASSIGNMENTS_COLUMNS, EmployeeRecord, EmployeeRepository, EmployeeStatus, mapEmployee(), mapEmployeeWithAssignments(), translateUniqueViolation() (+2 more)

### Community 25 - "plugins/context.ts"
Cohesion: 0.14
Nodes (17): clientIp(), contextPlugin(), fastify, FastifyRequest, headerOrganizationId(), isMutation(), PUBLIC_CSRF_COOKIE, PUBLIC_SESSION_COOKIE (+9 more)

### Community 26 - "composer.tsx"
Cohesion: 0.11
Nodes (25): OfflineBanner(), useOnlineStatus(), Composer(), estimateLine(), Props, toApiPayload(), ADR-0005, zodResolver() (+17 more)

### Community 27 - "scripts"
Cohesion: 0.06
Nodes (34): scripts, build, build:packages, build:server, db:harden, db:migrate, db:repair, db:replay (+26 more)

### Community 28 - "auth.ts"
Cohesion: 0.15
Nodes (12): CSRF_COOKIE, SESSION_COOKIE, GoogleCallbackSchema, PasswordSignInSchema, RegisterSchema, RequestSignInSchema, setSessionCookies(), SwitchOrganizationSchema (+4 more)

### Community 29 - "api/projects.ts"
Cohesion: 0.10
Nodes (23): fullProject(), IdParams, ProjectRowLike, projectTotalsDto(), summariseProject(), AddressDto, AddressSchema, BaselineAmendmentSchema (+15 more)

### Community 30 - "main.ts"
Cohesion: 0.14
Nodes (19): scanFile(), ScanPayload, applyRetention(), checkProjectIntegrity(), enqueueDueReminders(), expireRequests(), scheduleRecurringJobs(), container (+11 more)

### Community 31 - "runtime/package.json"
Cohesion: 0.07
Nodes (27): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+19 more)

### Community 32 - "dashboard/page.tsx"
Cohesion: 0.08
Nodes (37): dynamic, DashboardPage(), dynamic, formatDecisionTime(), EmployeesPage(), dynamic, dynamic, dynamic (+29 more)

### Community 33 - "application/package.json"
Cohesion: 0.08
Nodes (25): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations, @extrawork/observability (+17 more)

### Community 34 - "devDependencies"
Cohesion: 0.08
Nodes (25): eslint, eslint-plugin-react-hooks, @extrawork/testkit, fast-check, @next/eslint-plugin-next, devDependencies, eslint, eslint-plugin-react-hooks (+17 more)

### Community 35 - "audit.ts"
Cohesion: 0.28
Nodes (10): ActorType, AuditEventRow, AuditWriter, ChainTail, lockChainTail(), PostgresAuditWriter, toBuffer(), toBufferOrNull() (+2 more)

### Community 36 - "integrations/package.json"
Cohesion: 0.08
Nodes (24): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, nodemailer, devDependencies, @types/nodemailer (+16 more)

### Community 37 - "replay.ts"
Cohesion: 0.07
Nodes (25): collectCodes(), collectMessages(), DescribedError, describeError(), formatCliError(), NodeError, redactUrl(), config (+17 more)

### Community 38 - "primitives.ts"
Cohesion: 0.09
Nodes (22): DecisionInputSchema, DecisionReceiptDto, DecisionReceiptSchema, OtpChallengeSchema, OtpRequestSchema, OtpVerifyResultSchema, OtpVerifySchema, PublicAttachmentSchema (+14 more)

### Community 39 - "files/package.json"
Cohesion: 0.08
Nodes (23): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @extrawork/config, @extrawork/contracts, @extrawork/observability (+15 more)

### Community 40 - "simulator-console.tsx"
Cohesion: 0.25
Nodes (6): dynamic, OutboxRecord, SendResult, SimEmployee, SimulatorConsole(), STATUS_COPY

### Community 41 - "ExtraWork — Current Project Handoff"
Cohesion: 0.05
Nodes (42): 10. Security and evidence invariants, 11. Performance investigation and changes, 12. Local development and testing, 13. Current real WhatsApp implementation gap, 14. Most recent WhatsApp Business decisions, 15. Clear next steps, 16. Open decisions and risks, 17. Repository and documentation notes (+34 more)

### Community 42 - "document.ts"
Cohesion: 0.15
Nodes (18): buildOpenApiDocument(), commonErrors, componentSchemas, errorResponse(), idempotencyHeader, ifMatchHeader, jsonBody(), JsonObject (+10 more)

### Community 43 - "api/customers.ts"
Cohesion: 0.12
Nodes (16): ContactInput, ContactInputSchema, ContactSchema, CreateCustomerSchema, CustomerSchema, DuplicateCandidateDto, DuplicateCandidateSchema, ListCustomersQuerySchema (+8 more)

### Community 44 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, allowJs, incremental, jsx, lib, moduleResolution, noEmit, paths (+13 more)

### Community 45 - "services.ts"
Cohesion: 0.05
Nodes (35): RFC-7914, FileService, AuthenticatedIdentity, AuthProvider, AuthService, signInUrl(), base64url(), GoogleAuthStart (+27 more)

### Community 46 - "contracts/src/index.ts"
Cohesion: 0.11
Nodes (24): DecisionPanel(), messageFor(), Props, Receipt(), satisfies(), Stage, Challenge, OtpStep() (+16 more)

### Community 47 - "0002_search_and_projections.sql"
Cohesion: 0.16
Nodes (18): change_order_versions_touch, change_orders_search_trigger(), change_orders_search_update, change_orders_touch, contacts_touch, customers_search_trigger(), customers_search_update, customers_touch (+10 more)

### Community 48 - "email.ts"
Cohesion: 0.16
Nodes (6): RFC-822, ConsoleEmailDriver, EmailDriver, EmailMessage, FileEmailDriver, SmtpEmailDriver

### Community 49 - "Adapter-with-deferred-driver MVP posture"
Cohesion: 0.12
Nodes (20): A2 rejected with ASSURANCE_UNAVAILABLE, 32-byte approval token, SHA-256 stored, Defect: CHECK constraints made a cancelled draft unrepresentable, Defect: 'code' in the log redaction list, Defect: public session cookie discarded during SSR, Server-side entitlements and lapse read/export mode, Adapter-with-deferred-driver MVP posture, NativeShareGateway (+12 more)

### Community 50 - "razorpay.ts"
Cohesion: 0.15
Nodes (11): CreatePaymentCommand, PaymentOrderRef, mapPaymentStatus(), RazorpayEntity, RazorpayGateway, RazorpayOptions, RazorpayWebhook, constantTimeEqual() (+3 more)

### Community 51 - "domain/src/index.ts"
Cohesion: 0.09
Nodes (22): assertSignedDatePlausible(), calendarDateIn(), SIGNED_DATE_TOLERANCE_DAYS, SignedDateCheck, DECIDED_LINK_RETENTION_DAYS, affectsProjectTotals(), canTransition(), decisionAction() (+14 more)

### Community 52 - "domain/package.json"
Cohesion: 0.11
Nodes (17): decimal.js, libphonenumber-js, dependencies, decimal.js, @extrawork/contracts, libphonenumber-js, exports, @extrawork/contracts (+9 more)

### Community 53 - "repositories/change-orders.ts"
Cohesion: 0.06
Nodes (25): ProjectStatus, VersionStatus, AttachmentRow, ChangeOrderRecord, ChangeOrderRow, ChangeOrderSummaryRecord, ChangeOrderSummaryRow, LineItemRow (+17 more)

### Community 54 - "0003_append_only_evidence.sql"
Cohesion: 0.17
Nodes (16): audit_events_append_only(), audit_events_no_delete, audit_events_no_update, baseline_versions_append_only(), baseline_versions_no_update, decisions_append_only(), decisions_no_delete, decisions_no_update (+8 more)

### Community 55 - "api/files.ts"
Cohesion: 0.09
Nodes (21): CompleteUploadSchema, CreateUploadSchema, FileObjectDto, FileObjectSchema, PresignedUploadSchema, UploadPurpose, UploadPurposeSchema, ApprovedChangeExport (+13 more)

### Community 56 - "observability/package.json"
Cohesion: 0.11
Nodes (17): dependencies, @extrawork/config, pino, pino-pretty, exports, @extrawork/config, main, name (+9 more)

### Community 57 - "CI job: Integration, security and golden tests"
Cohesion: 0.15
Nodes (17): One CI job per launch blocker, CI job: Integration, security and golden tests, CI job: End-to-end (Playwright), Migration idempotency check, CI job: Migration lint, Ephemeral PostgreSQL 16 CI service, CI job: Format, lint, typecheck, CI job: Unit and property tests (+9 more)

### Community 58 - "Compose service: api"
Cohesion: 0.15
Nodes (17): CI placeholder secrets, Compose service: api, Shared app-env anchor, app compose profile, C collation for reproducible index behaviour, Compose service: db (PostgreSQL 16), Compose service: mailpit, Compose service: minio (+9 more)

### Community 59 - "harden.ts"
Cohesion: 0.18
Nodes (6): APPEND_ONLY_TABLES, config, dryRun, FROZEN_TABLES, pool, statements

### Community 60 - "decide.ts"
Cohesion: 0.07
Nodes (40): DecideCommand, DecisionReceipt, DecisionService, DECLARATIONS, OtpChallengeResult, OtpService, PublicApprovalService, summariseAddress() (+32 more)

### Community 61 - "messaging.ts"
Cohesion: 0.20
Nodes (22): firstName(), notifyTeamDecision(), ReceiptPayload, ReminderPayload, RequestMessagePayload, sendDecisionReceipt(), sendReminder(), sendRequestMessage() (+14 more)

### Community 62 - "authorize"
Cohesion: 0.08
Nodes (24): RequestContext, decodeInboundCursor(), EmployeeService, encodeInboundCursor(), ProjectService, CreateCustomerInput, CreateEmployeeInput, UpdateEmployeeInput (+16 more)

### Community 63 - "Moving off this machine: Supabase + Cloudflare R2"
Cohesion: 0.17
Nodes (11): 1. Supabase, 2. Cloudflare R2, 3. Put the values in `.env` yourself, 4. Run the migration, 5. Verify, Before you start, Gotchas found doing this for real, Moving off this machine: Supabase + Cloudflare R2 (+3 more)

### Community 64 - "Record What You Did"
Cohesion: 0.14
Nodes (17): Export Never Gated on Billing Status, export-subject.ts Export CLI, Legal Hold, Organization Account Deletion with 30-Day Grace, Bulk Token Revocation on Account Compromise, Freeze One Organization Runbook, Live Approval Tokens Survive a Freeze, ORGANIZATION_SUSPENDED Status (+9 more)

### Community 65 - "Product"
Cohesion: 0.17
Nodes (11): Accessibility & Inclusion, Brand Commitments, Capabilities and Constraints, Evidence on Hand, Operating Context, Platform, Positioning, Product (+3 more)

### Community 66 - "Restore Database and Verify Audit Chains Runbook"
Cohesion: 0.16
Nodes (15): Backups, Health Checks and Restore Rehearsal Runbook, Backup Freshness Alert, Backup Schedule and Retention Matrix, scripts/backup.sh, Daily Logical Dump, Managed PostgreSQL PITR, Measured RTO Target, Monthly Restore Rehearsal (+7 more)

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
Nodes (13): dependencies, drizzle-orm, @extrawork/integrations, @extrawork/runtime, @fastify/cookie, @fastify/cors, fastify-plugin, drizzle-orm (+5 more)

### Community 72 - "build.ts"
Cohesion: 0.33
Nodes (9): BuildEvidenceOptions, buildEvidenceViewModel(), EvidenceViewModel, formatInTimezone(), readChain(), verifyAggregateChain(), EVIDENCE_TEMPLATE_VERSION, ManifestInput (+1 more)

### Community 73 - "src/rate-limit.ts"
Cohesion: 0.13
Nodes (9): InMemoryRateLimiter, LocalReadRateLimiter, PostgresRateLimiter, RATE_LIMITS, RateLimiter, RateLimitResult, RateLimitRule, resultFor() (+1 more)

### Community 74 - "evidence.test.ts"
Cohesion: 0.15
Nodes (7): digest(), renderEvidenceHtml(), FixedClock, approvedFixture(), clock, today(), viewModel()

### Community 75 - "Non-Erasable Decision Record"
Cohesion: 0.22
Nodes (10): erase-contact.ts Pseudonymisation CLI, Non-Erasable Decision Record, Migration Checksum Guard, Never Edit Evidence By Hand, Verify Schema Before Data, A0 Bearer-Link Assurance Level, Corrective Change to Undo an Approval, Spent Token With Recorded Decision (+2 more)

### Community 76 - "api/package.json"
Cohesion: 0.25
Nodes (7): exports, ./app, main, name, private, type, version

### Community 77 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 78 - "Design"
Cohesion: 0.20
Nodes (9): Accessibility, Boundaries, Colour, Components, Design, Layout, Motion, The world (+1 more)

### Community 79 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 81 - "ExtraWork Technical Design Report and Master Build Specification v1.0"
Cohesion: 0.24
Nodes (10): CI job: Build web, API and worker, OpenAPI drift check, Build order S1–S10, Module map to package, Requirement traceability matrix, ExtraWork Technical Design Report and Master Build Specification v1.0, Workspace package globs (apps/*, packages/*), Enforced dependency direction (+2 more)

### Community 82 - "webhook-normalisation.test.ts"
Cohesion: 0.09
Nodes (22): container, actorContext(), publicContext(), createTestContainer(), truncateAll(), withTestContainer(), addMember(), ChangeOrderFixtureOptions (+14 more)

### Community 83 - "e2e/fixtures.ts"
Cohesion: 0.27
Nodes (6): ApprovalLink, HELPER, ROOT, run, Scenario, seedScenario()

### Community 84 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, declarationMap, module, moduleResolution, noEmit, extends, ./tsconfig.json

### Community 85 - "app-shell.tsx"
Cohesion: 0.11
Nodes (22): MeResponse, AppShell(), NAV, NAV_MANAGE, NAV_SYSTEM, ShellUser, IconBuilding(), IconChevron() (+14 more)

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
Nodes (27): MembershipRole, AuthenticatedSessionContext, AuthenticatedSessionRecord, MembershipRow, SessionRow, UserRecord, UserRow, mapOrganization() (+19 more)

### Community 100 - "Preserve Evidence Then Contain"
Cohesion: 0.15
Nodes (13): Blast Radius Determination, DPDP Data Fiduciary Notification, Preserve Evidence Then Contain, Pseudonymous Log Correlation by requestId, Data Access, Export and Deletion Request Runbook, Erasure Versus Contractual Evidence Tension, Requester Role Triage, PRIVACY_HASH_SECRET (+5 more)

### Community 101 - "package.json"
Cohesion: 0.25
Nodes (7): description, engines, node, name, packageManager, private, version

### Community 102 - "jcs.ts"
Cohesion: 0.31
Nodes (7): CanonicalizationError, ESCAPES, serializeNumber(), serializeString(), serializeValue(), sortKeys(), RFC-8785

### Community 103 - "Audited Repair Command"
Cohesion: 0.33
Nodes (7): extrawork.allow_repair Repair Mode Flag, Audited Repair Command, Two Connections: Runtime vs Maintenance Role, Diagnose Cause Before Rebuild, repair-project-totals.ts Rebuild CLI, Bounded Replay Only, Revocation Is Not Evidence

### Community 104 - "Replay Webhook and Outbox Events Runbook"
Cohesion: 0.29
Nodes (7): Dead-Letter Diagnosis Before Replay, PermanentJobError, Replay Webhook and Outbox Events Runbook, Meta WhatsApp App Secret Rotation, Payment Webhooks Are the Authority for Payment State, Razorpay Webhook Secret Rotation, Add, Switch, Observe, Remove

### Community 105 - "ExtraWork — Project Handoff"
Cohesion: 0.06
Nodes (30): 10. Test inventory, 11. Open questions for the founder, 1. What the product is, 2. Current status in one table, 3. How to get running (5 minutes), 4. Architecture, 5. The product pivot (this is the important part), 6.1 Company field is optional, not required (+22 more)

### Community 106 - "integrations/src/index.ts"
Cohesion: 0.15
Nodes (10): DisabledPaymentGateway, ESignGateway, InboundMediaRef, OutboundTemplate, PaymentGateway, UnavailableESignGateway, createEmailDriver(), createIntegrations() (+2 more)

### Community 107 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, openapi, start, typecheck

### Community 108 - "intake-service.ts"
Cohesion: 0.20
Nodes (16): describe(), InboundWhatsAppMessage, titleFrom(), validate(), describeUnderstood(), FIELD_EXAMPLES, FIELD_LABEL, FORMAT_HINT (+8 more)

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

### Community 114 - "Handler Idempotency"
Cohesion: 0.29
Nodes (8): Object Storage Bucket Versioning, Regenerable Evidence PDFs, claimForGeneration State Guard, Decisions Are Never Replayable, Handler Idempotency, Message dedupe_key Check, replay.ts Audited Replay Command, Side Effect Reconciliation After Rewind

### Community 115 - "whatsapp.ts"
Cohesion: 0.10
Nodes (17): FetchedMedia, InboundMessageEvent, buildCloudApiPayload(), mapDeliveryStatus(), MetaInboundMessage, MetaMediaObject, MetaWebhookPayload, normalizeInboundMessage() (+9 more)

### Community 116 - ".prettierrc.json"
Cohesion: 0.33
Nodes (5): arrowParens, printWidth, semi, singleQuote, trailingComma

### Community 117 - "parse-message.ts"
Cohesion: 0.18
Nodes (17): EMPTY, IntakeField, IntakeValidation, LABELS, looksLikeAmount(), looksLikeDays(), normalizeLabel(), parseAmountToMinor() (+9 more)

### Community 119 - "sequences.ts"
Cohesion: 0.26
Nodes (9): ORG_SCOPE_UUID, allocateNumber(), peekNextNumber(), DEFAULT_FORMATS, formatDocumentNumber(), NumberFormat, SEQUENCE_KINDS, SequenceKind (+1 more)

### Community 120 - "outbox-pump.ts"
Cohesion: 0.16
Nodes (15): registerHealthRoutes(), delay(), EnqueueInput, jobsFor(), OutboxPump, ADR-0003, OUTBOX_TOPICS, OutboxTopic (+7 more)

### Community 121 - "inbound-intake.test.ts"
Cohesion: 0.17
Nodes (8): claimJobs(), fetchedMediaIds, GOOD_MESSAGE, pdfStub, PHOTO, runQueuedWebhookJob(), sent, claimNormalizeJob()

### Community 122 - "Operational Runbooks Index"
Cohesion: 0.22
Nodes (11): Cross-Tenant Disclosure Response Runbook, Concurrent Index Rebuild, Expand-and-Contract Migrations, Failed Migration Recovery Runbook, Fix Forward or Roll Back the Code, Per-Migration Transaction Atomicity, Operational Runbooks Index, Auth Provider JWKS Key Rollover (+3 more)

### Community 124 - "MessageGateway"
Cohesion: 0.13
Nodes (8): MessageGateway, OutboundMessage, ProviderEvent, EmailGateway, NativeShareWhatsAppGateway, SimulatedOutboundRecord, SimulatorOptions, SimulatorWhatsAppGateway

### Community 125 - "inbound.ts"
Cohesion: 0.21
Nodes (15): extensionFor(), handleInboundMessage(), sendReply(), storeInboundMedia(), toInboundMessageEvent(), applyMessageStatus(), looksLikeInboundMessage(), mapMessageStatuses() (+7 more)

### Community 126 - "canonicalize"
Cohesion: 0.19
Nodes (14): canonicalBytes(), canonicalize(), CANONICALIZER_VERSION, JsonValue, buildCanonicalSnapshot(), freezeSnapshot(), FrozenSnapshot, SNAPSHOT_SCHEMA_VERSION (+6 more)

### Community 128 - "api/employees.ts"
Cohesion: 0.09
Nodes (20): CustomerSummarySchema, CreateEmployeeSchema, EmployeeListSchema, EmployeeSchema, EmployeeStatus, EmployeeStatusSchema, InboundMessageDto, InboundMessageListSchema (+12 more)

### Community 135 - "api/organizations.ts"
Cohesion: 0.10
Nodes (19): CreateOrganizationInput, CurrentUserDto, CurrentUserSchema, EntitlementsDto, EntitlementsSchema, GstinSchema, InviteMembershipInput, InviteMembershipSchema (+11 more)

### Community 136 - "intake-service.test.ts"
Cohesion: 0.43
Nodes (7): addEmployee(), GOOD_MESSAGE, nextMessageId(), nextPhone(), raiseAndDecide(), send(), today()

### Community 142 - "dev-lan.sh"
Cohesion: 0.29
Nodes (6): API_HOST, API_PUBLIC_URL, CORS_ALLOWED_ORIGINS, NEXT_PUBLIC_API_URL, dev-lan.sh script, WEB_PUBLIC_URL

### Community 143 - "section63.ts"
Cohesion: 0.40
Nodes (4): Section63Certificate, Section63Input, SECTION_63_AUTHORITY, SECTION_63_SCHEMA_VERSION

### Community 144 - "format.ts"
Cohesion: 0.12
Nodes (25): ChangePage(), dynamic, EventsResponse, dynamic, ProjectPage(), dynamic, ProjectsPage(), ReportsPage() (+17 more)

### Community 148 - "send.ts"
Cohesion: 0.11
Nodes (24): firstName(), SendResult, SendService, SendChangeOrderInput, publishOutbox(), buildApprovalUrl(), generateApprovalToken(), GeneratedToken (+16 more)

### Community 162 - "api/change-orders.ts"
Cohesion: 0.06
Nodes (38): IdParams, ProjectIdParams, summariseEvent(), CancelChangeOrderSchema, ChangeOrderEventsDto, ChangeOrderEventsSchema, ChangeOrderVersionListSchema, CreateChangeOrderSchema (+30 more)

### Community 163 - "ExtraWork — Product Brief"
Cohesion: 0.17
Nodes (11): Business owner or administrator, Core product value, Customer or authorized approver, End-to-end workflow, ExtraWork — Product Brief, Field employee, Later expansion, MVP scope (+3 more)

### Community 164 - "Cross-Tenant IDOR Threat"
Cohesion: 0.50
Nodes (4): Cross-Tenant IDOR Threat, Tenant Authorization Rule, TenantContext Repository Scope, Tenant Isolation Negative Corpus

### Community 165 - "config/src/index.ts"
Cohesion: 0.09
Nodes (29): Clock, systemClock, createAuthProvider(), createServices(), loadEnvFile(), anchorLocalPaths(), assertProductionSafe(), booleanish (+21 more)

### Community 166 - "Repositories"
Cohesion: 0.13
Nodes (14): BuildAppOptions, ContextPluginOptions, FastifyInstance, workerContext, LocalMagicLinkOptions, Services, Env, PostgresUnitOfWork (+6 more)

### Community 167 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, tsx, typescript, tsx, typescript

### Community 168 - "reminders/reminders.ts"
Cohesion: 0.22
Nodes (12): isOpenForDecision(), buildReminderSchedule(), DEFAULT_REMINDER_POLICY, localHourIn(), nextLocalWindow(), ReminderChannel, ReminderContext, ReminderDecision (+4 more)

### Community 169 - "match.ts"
Cohesion: 0.27
Nodes (8): normalizeForSearch(), MatchCandidate, MatchOptions, MatchOutcome, matchProject(), scoreCandidate(), STOP_WORDS, tokens()

### Community 173 - "exports.ts"
Cohesion: 0.16
Nodes (13): EVIDENCE_GENERATOR_VERSION, EvidencePayload, generateEvidence(), truncate(), csvCell(), EXPORT_TEMPLATE_VERSION, ExportPayload, generateExport() (+5 more)

### Community 176 - "IntakeService"
Cohesion: 0.28
Nodes (3): IntakeOutcome, IntakeService, InboundStatus

### Community 192 - "projects"
Cohesion: 0.25
Nodes (12): baseline_versions, change_orders, file_objects, project_integrity_mismatches(), employee_project_assignments, employees, inbound_messages, request_templates (+4 more)

## Ambiguous Edges - Review These
- `allowBuilds native-dependency allowlist` → `Evidence pack (PDF + manifest)`  [AMBIGUOUS]
  pnpm-workspace.yaml · relation: conceptually_related_to

## Knowledge Gaps
- **1012 isolated node(s):** `printWidth`, `singleQuote`, `trailingComma`, `semi`, `arrowParens` (+1007 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `allowBuilds native-dependency allowlist` and `Evidence pack (PDF + manifest)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Database` connect `Database` to `TransactionContext`, `audit.ts`, `DocumentRepository`, `TenantContext`, `Repositories`, `runner.ts`, `build.ts`, `src/rate-limit.ts`, `db/src/index.ts`, `approvals.ts`, `repositories/organizations.ts`, `InboundMessageRepository`, `repositories/change-orders.ts`, `outbox-pump.ts`, `repositories/employees.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `AppError` connect `AppError` to `TransactionContext`, `files/src/index.ts`, `change-orders/service.ts`, `approvals.ts`, `db/src/index.ts`, `app.ts`, `money.ts`, `send.ts`, `api.ts`, `repositories/employees.ts`, `plugins/context.ts`, `auth.ts`, `api/change-orders.ts`, `tenant.ts`, `exports.ts`, `services.ts`, `email.ts`, `razorpay.ts`, `domain/src/index.ts`, `repositories/change-orders.ts`, `decide.ts`, `authorize`, `build.ts`, `webhook-normalisation.test.ts`, `repositories/organizations.ts`, `integrations/src/index.ts`, `intake-service.ts`, `whatsapp.ts`, `parse-message.ts`, `sequences.ts`, `MessageGateway`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `TransactionContext` connect `TransactionContext` to `audit.ts`, `DocumentRepository`, `TenantContext`, `repositories/organizations.ts`, `runner.ts`, `approvals.ts`, `Database`, `db/src/index.ts`, `InboundMessageRepository`, `repositories/change-orders.ts`, `sequences.ts`, `outbox-pump.ts`, `repositories/employees.ts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `printWidth`, `singleQuote`, `trailingComma` to the rest of the system?**
  _1012 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TransactionContext` be split into smaller, more focused modules?**
  _Cohesion score 0.07729468599033816 - nodes in this community are weakly interconnected._
- **Should `files/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._