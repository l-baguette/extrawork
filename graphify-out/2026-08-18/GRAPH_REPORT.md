# Graph Report - extrawork  (2026-08-18)

## Corpus Check
- 322 files · ~225,373 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3179 nodes · 5043 edges · 241 communities (186 shown, 55 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 122 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c25a98b3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- newId
- LocalObjectStore
- api/files.ts
- domain/src/approvals/otp.ts
- ChangeOrderService
- DocumentRepository
- schema/index.ts
- runner.ts
- TransactionContext
- inbound-intake.test.ts
- exports.ts
- auth.ts
- primitives.ts
- db/package.json
- repositories/index.ts
- dependencies
- testkit/package.json
- app.ts
- organizations
- money.ts
- dependencies
- api.ts
- compilerOptions
- CustomerRepository
- repositories/files.ts
- contracts/src/index.ts
- composer.tsx
- scripts
- RequestContext
- api/projects.ts
- main.ts
- runtime/package.json
- dashboard/page.tsx
- application/package.json
- devDependencies
- api/organizations.ts
- integrations/package.json
- jobs.ts
- common.ts
- files/package.json
- simulator-console.tsx
- ExtraWork — Current Project Handoff
- document.ts
- api/customers.ts
- compilerOptions
- AuthService
- decision-panel.tsx
- 0002_search_and_projections.sql
- email.ts
- Adapter-with-deferred-driver MVP posture
- gateways.ts
- state-machine.ts
- domain/package.json
- toDate
- 0003_append_only_evidence.sql
- toDateOrNull
- observability/package.json
- CI job: Integration, security and golden tests
- Compose service: api
- config/src/index.ts
- decide.ts
- share.ts
- repositories/employees.ts
- Moving off this machine: Supabase + Cloudflare R2
- Record What You Did
- Product
- Restore Database and Verify Audit Chains Runbook
- token.ts
- config/package.json
- contracts/package.json
- ProviderMessageRef
- dependencies
- events.ts
- src/rate-limit.ts
- evidence.ts
- Non-Erasable Decision Record
- api/package.json
- compilerOptions
- Design
- compilerOptions
- rateLimit
- ExtraWork Technical Design Report and Master Build Specification v1.0
- seed.ts
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
- entitlements.ts
- Preserve Evidence Then Contain
- package.json
- services.ts
- Audited Repair Command
- Replay Webhook and Outbox Events Runbook
- ExtraWork — Project Handoff
- integrations/src/index.ts
- scripts
- replies.ts
- Append-only evidence
- Job queue with lease, dead-letter and priorities
- @extrawork/contracts
- logger.ts
- project_integrity_mismatches
- totals.ts
- whatsapp.ts
- .prettierrc.json
- parse-message.ts
- next.config.mjs
- numbering.ts
- workerContext
- fastify-plugin
- Operational Runbooks Index
- @extrawork/domain
- MessageGateway
- policy.ts
- jcs.ts
- api/reports.ts
- api/employees.ts
- r/[token]/page.tsx
- next-env.d.ts
- @extrawork/db
- query-keys.ts
- Money and totals engine
- OrganizationRepository
- plugins/errors.ts
- Decision Write Path Priority
- pdfjs-dist
- @extrawork/contracts
- @types/node
- @typescript-eslint/parser
- dev-lan.sh
- request-templates.ts
- format.ts
- zod
- typescript-eslint
- intake-service.ts
- @extrawork/config
- backup.sh
- restore.sh
- verify-backup.sh
- vitest.workspace.ts
- CI job: Dependency and secret scan
- Constraint Violation Means Real Bad Data
- api/change-orders.ts
- ExtraWork — Product Brief
- messaging.ts
- container.ts
- jobs/webhooks.ts
- devDependencies
- PdfRenderer
- phone.ts
- CLAUDE.md
- change_order_versions
- PostgresUnitOfWork
- routes/change-orders.ts
- routes/employees.ts
- @typescript-eslint/eslint-plugin
- decided-link-retention.test.ts
- @eslint/js
- @extrawork/config
- harden.ts
- @extrawork/files
- outbox.ts
- @extrawork/observability
- @extrawork/files
- @extrawork/observability
- @playwright/test
- Database
- vitest
- password.ts
- google-oauth.ts
- src/errors.ts
- chain.ts
- AGENTS.md
- domain/src/index.ts
- @extrawork/api
- intake-service.test.ts
- routes/projects.ts
- Handler Idempotency
- FixedClock
- @extrawork/integrations
- Cross-Tenant IDOR Threat
- preflight-hosted.mts
- build.ts
- auth_challenges
- employee-api.test.ts
- intake-repositories.test.ts
- whatsapp-inbound-parse.test.ts
- canonical.test.ts
- seed-test-account.mts
- versioning-and-evidence.test.ts
- invariants.test.ts
- signature.ts
- state-machine.test.ts
- whatsapp-template.test.ts
- project-scope-api.test.ts
- @extrawork/runtime
- @fastify/cors
- intake-parse.test.ts
- signing-date.test.ts
- token.test.ts
- src/migrate.ts
- reset.ts
- repair-project-totals.ts
- replay.ts
- describe-error.ts
- signing.ts
- @extrawork/application

## God Nodes (most connected - your core abstractions)
1. `TransactionContext` - 104 edges
2. `Database` - 80 edges
3. `newId()` - 53 edges
4. `toDate()` - 43 edges
5. `RequestContext` - 36 edges
6. `scripts` - 34 edges
7. `organizations` - 34 edges
8. `IdentityRepository` - 31 edges
9. `ChangeOrderRepository` - 30 edges
10. `toDateOrNull()` - 30 edges

## Surprising Connections (you probably didn't know these)
- `A2 rejected with ASSURANCE_UNAVAILABLE` --semantically_similar_to--> `Not a licensed electronic signature disclaimer`  [INFERRED] [semantically similar]
  docs/IMPLEMENTATION_PLAN.md → README.md
- `allowBuilds native-dependency allowlist` --conceptually_related_to--> `Evidence pack (PDF + manifest)`  [AMBIGUOUS]
  pnpm-workspace.yaml → README.md
- `Launch gates (report §16.3)` --semantically_similar_to--> `Launch gates with owners`  [INFERRED] [semantically similar]
  README.md → docs/IMPLEMENTATION_PLAN.md
- `Evidence manifest and PDF template` --semantically_similar_to--> `Evidence pack (PDF + manifest)`  [INFERRED] [semantically similar]
  docs/IMPLEMENTATION_PLAN.md → README.md
- `Decisions Are Never Replayable` --semantically_similar_to--> `Non-Erasable Decision Record`  [INFERRED] [semantically similar]
  infra/runbooks/replay-events.md → infra/runbooks/data-subject-request.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CI jobs that close automated launch blockers** — _github_workflows_ci_migrations, _github_workflows_ci_database, _github_workflows_ci_build, _github_workflows_ci_supply_chain, _github_workflows_ci_e2e, readme_launch_gates [EXTRACTED 1.00]
- **Deferred-provider adapter set** — docs_implementation_plan_nativesharegateway, docs_implementation_plan_whatsappcloudgateway, docs_implementation_plan_otp_a1, docs_implementation_plan_a2_esign_rejection, docs_implementation_plan_paymentgateway, docs_implementation_plan_mvp_posture [EXTRACTED 1.00]
- **Evidence Integrity Discipline Shared by All Runbooks** — infra_runbooks_readme_never_edit_evidence_by_hand, infra_runbooks_readme_two_connections, infra_runbooks_readme_verify_after_every_repair, infra_runbooks_readme_record_what_you_did, infra_runbooks_readme_repair_command [EXTRACTED 1.00]
- **Local development dependency stack** — docker_compose_db, docker_compose_minio, docker_compose_minio_init, docker_compose_mailpit, readme_local_dev_options [EXTRACTED 1.00]
- **Post-Restore Verification Sequence** — infra_runbooks_restore_database_stop_writes, infra_runbooks_restore_database_schema_verification_before_data, infra_runbooks_restore_database_audit_chain_verification, infra_runbooks_restore_database_projection_rebuild, infra_runbooks_restore_database_side_effect_reconciliation, infra_runbooks_repair_project_totals_repair_project_totals_runbook [EXTRACTED 1.00]
- **Credential and Access Exposure Response Family** — infra_runbooks_revoke_leaked_token_approval_token_revocation, infra_runbooks_rotate_credentials_rotation_order_of_operations, infra_runbooks_freeze_organization_bulk_token_revocation_on_compromise, infra_runbooks_cross_tenant_disclosure_cross_tenant_disclosure_runbook, infra_runbooks_support_access_customer_granted_time_bound_access [INFERRED 0.85]

## Communities (241 total, 55 thin omitted)

### Community 0 - "newId"
Cohesion: 0.06
Nodes (22): newId(), ApprovalTokenRow, DECISION_COLUMNS, DECISION_COLUMNS_D, DecisionRecord, DecisionRow, mapPublicSession(), PUBLIC_SESSION_COLUMNS (+14 more)

### Community 1 - "LocalObjectStore"
Cohesion: 0.05
Nodes (24): LocalObjectStore, LocalSignaturePayload, LocalStoreOptions, assertSafeKey(), ObjectMetadata, ObjectStore, PresignedUpload, StorageKeys (+16 more)

### Community 2 - "api/files.ts"
Cohesion: 0.14
Nodes (13): ALLOWED_UPLOAD_MIME_TYPES, AllowedMimeType, CompleteUploadSchema, CreateUploadInput, CreateUploadSchema, FileObjectDto, FileObjectSchema, MAX_FILE_BYTES (+5 more)

### Community 3 - "domain/src/approvals/otp.ts"
Cohesion: 0.16
Nodes (12): GeneratedOtp, generateOtp(), hashOtp(), OTP_DAILY_LIMIT, OTP_DIGITS, OTP_RESEND_COOLDOWN_SECONDS, OTP_WINDOW_LIMIT, OTP_WINDOW_MINUTES (+4 more)

### Community 4 - "ChangeOrderService"
Cohesion: 0.18
Nodes (6): buildLineItemWrites(), toCalcInputs(), ADR-0005, versionEtag(), ChangeOrderService, ADR-0005

### Community 6 - "schema/index.ts"
Cohesion: 0.04
Nodes (55): actorType, approvalTokens, assuranceLevel, auditEvents, authChallenges, baselineVersions, bigintNumeric, bytea (+47 more)

### Community 7 - "runner.ts"
Cohesion: 0.22
Nodes (7): classify(), delay(), JobHandler, JobRunner, RunnerOptions, startLeaseReaper(), truncate()

### Community 8 - "TransactionContext"
Cohesion: 0.08
Nodes (5): TransactionContext, ApprovalRepository, mapDecision(), mapToken(), ProjectRepository

### Community 9 - "inbound-intake.test.ts"
Cohesion: 0.20
Nodes (5): fetchedMediaIds, GOOD_MESSAGE, pdfStub, PHOTO, sent

### Community 10 - "exports.ts"
Cohesion: 0.32
Nodes (7): csvCell(), EXPORT_TEMPLATE_VERSION, ExportPayload, generateExport(), HEADERS, toCsv(), RFC-4180

### Community 11 - "auth.ts"
Cohesion: 0.09
Nodes (23): clientIp(), contextPlugin(), ContextPluginOptions, CSRF_COOKIE, fastify, FastifyInstance, FastifyRequest, headerOrganizationId() (+15 more)

### Community 12 - "primitives.ts"
Cohesion: 0.07
Nodes (29): DecisionInput, DecisionInputSchema, DecisionReceiptDto, DecisionReceiptSchema, OtpChallengeSchema, OtpRequestSchema, OtpVerifyResultSchema, OtpVerifySchema (+21 more)

### Community 13 - "db/package.json"
Cohesion: 0.05
Nodes (40): drizzle-kit, dependencies, drizzle-orm, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, pg (+32 more)

### Community 14 - "repositories/index.ts"
Cohesion: 0.05
Nodes (28): asJson, config, Failure, uow, CreateDatabaseOptions, PgError, beginIdempotent(), hashRequest() (+20 more)

### Community 15 - "dependencies"
Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 16 - "testkit/package.json"
Cohesion: 0.05
Nodes (39): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+31 more)

### Community 17 - "app.ts"
Cohesion: 0.21
Nodes (10): buildApp(), BuildAppOptions, ipSubject(), registerHealthRoutes(), registerPublicRoutes(), InboundSchema, registerSimulatorRoutes(), redactedHeaders() (+2 more)

### Community 18 - "organizations"
Cohesion: 0.14
Nodes (27): baseline_versions, change_orders, data_subject_requests, document_sequences, entitlement_counters, file_objects, idempotency_records, job_queue (+19 more)

### Community 19 - "money.ts"
Cohesion: 0.18
Nodes (6): assertInt64(), MINOR_UNITS, minorUnitScale(), Money, normalizeCurrency(), toIntegerBigint()

### Community 20 - "dependencies"
Cohesion: 0.06
Nodes (33): dependencies, @extrawork/contracts, next, react, react-dom, react-hook-form, @tanstack/react-query, zod (+25 more)

### Community 21 - "api.ts"
Cohesion: 0.10
Nodes (21): ChangeActions(), RemindResult, BusinessForm(), RETENTION, TIMEZONES, ProfileForm(), TemplateEditor(), OnboardingPage() (+13 more)

### Community 22 - "compilerOptions"
Cohesion: 0.06
Nodes (33): metadata, viewport, archivo, splineMono, development, dist, .next, compilerOptions (+25 more)

### Community 23 - "CustomerRepository"
Cohesion: 0.15
Nodes (3): CustomerRepository, mapContact(), mapCustomer()

### Community 24 - "repositories/files.ts"
Cohesion: 0.16
Nodes (5): FILE_COLUMNS, FileObjectRow, FileRecord, FileRepository, mapFile()

### Community 25 - "contracts/src/index.ts"
Cohesion: 0.13
Nodes (12): APPROVAL_DECLARATION, ASSURANCE_COPY, assuranceCopy, DECLINE_DECLARATION, EVIDENCE_DISCLAIMER, RANK, REVISION_DECLARATION, TERMS_VERSION (+4 more)

### Community 26 - "composer.tsx"
Cohesion: 0.13
Nodes (22): useOnlineStatus(), Composer(), estimateLine(), Props, toApiPayload(), ADR-0005, zodResolver(), DraftState (+14 more)

### Community 27 - "scripts"
Cohesion: 0.06
Nodes (34): scripts, build, build:packages, build:server, db:harden, db:migrate, db:repair, db:replay (+26 more)

### Community 28 - "RequestContext"
Cohesion: 0.11
Nodes (6): RequestContext, decodeInboundCursor(), EmployeeService, encodeInboundCursor(), FileService, ProjectService

### Community 29 - "api/projects.ts"
Cohesion: 0.08
Nodes (25): AddressDto, AddressSchema, BaselineAmendmentInput, BaselineAmendmentSchema, BaselineInput, BaselineInputSchema, ChangeRegisterDto, ChangeRegisterSchema (+17 more)

### Community 30 - "main.ts"
Cohesion: 0.18
Nodes (13): applyRetention(), checkProjectIntegrity(), enqueueDueReminders(), expireRequests(), scheduleRecurringJobs(), container, ctx, handlers (+5 more)

### Community 31 - "runtime/package.json"
Cohesion: 0.07
Nodes (27): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+19 more)

### Community 32 - "dashboard/page.tsx"
Cohesion: 0.07
Nodes (39): dynamic, EventsResponse, dynamic, DashboardPage(), dynamic, formatDecisionTime(), dynamic, EmployeesPage() (+31 more)

### Community 33 - "application/package.json"
Cohesion: 0.08
Nodes (25): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations, @extrawork/observability (+17 more)

### Community 34 - "devDependencies"
Cohesion: 0.08
Nodes (25): eslint, eslint-plugin-react-hooks, @extrawork/testkit, fast-check, @next/eslint-plugin-next, devDependencies, drizzle-orm, eslint (+17 more)

### Community 35 - "api/organizations.ts"
Cohesion: 0.09
Nodes (22): CreateOrganizationInput, CreateOrganizationSchema, CurrentUserDto, CurrentUserSchema, EntitlementsDto, EntitlementsSchema, GstinSchema, InviteMembershipInput (+14 more)

### Community 36 - "integrations/package.json"
Cohesion: 0.08
Nodes (24): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, nodemailer, devDependencies, @types/nodemailer (+16 more)

### Community 37 - "jobs.ts"
Cohesion: 0.18
Nodes (7): enqueueJob(), EnqueueJobInput, failJob(), JobRow, queueDepth, truncateError(), ADR-0003

### Community 38 - "common.ts"
Cohesion: 0.09
Nodes (21): ApproverSchema, AttachmentDto, AttachmentSchema, AuditEventDto, AuditEventSchema, ChangeOrderDto, ChangeOrderSchema, ChangeOrderSummaryDto (+13 more)

### Community 39 - "files/package.json"
Cohesion: 0.08
Nodes (23): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @extrawork/config, @extrawork/contracts, @extrawork/observability (+15 more)

### Community 40 - "simulator-console.tsx"
Cohesion: 0.24
Nodes (7): dynamic, OutboxRecord, SendResult, SimEmployee, SimulatorConsole(), STATUS_COPY, browserApiUrl()

### Community 41 - "ExtraWork — Current Project Handoff"
Cohesion: 0.05
Nodes (42): 10. Security and evidence invariants, 11. Performance investigation and changes, 12. Local development and testing, 13. Current real WhatsApp implementation gap, 14. Most recent WhatsApp Business decisions, 15. Clear next steps, 16. Open decisions and risks, 17. Repository and documentation notes (+34 more)

### Community 42 - "document.ts"
Cohesion: 0.18
Nodes (15): buildOpenApiDocument(), commonErrors, componentSchemas, errorResponse(), idempotencyHeader, ifMatchHeader, jsonBody(), JsonObject (+7 more)

### Community 43 - "api/customers.ts"
Cohesion: 0.09
Nodes (21): ContactDto, ContactInput, ContactInputSchema, ContactSchema, CreateCustomerInput, CreateCustomerSchema, CustomerDto, CustomerSchema (+13 more)

### Community 44 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, allowJs, incremental, jsx, lib, moduleResolution, noEmit, paths (+13 more)

### Community 45 - "AuthService"
Cohesion: 0.09
Nodes (11): AuthenticatedIdentity, AuthProvider, AuthService, signInUrl(), displayNameFromEmail(), Jwk, localAuthSubject(), LocalMagicLinkOptions (+3 more)

### Community 46 - "decision-panel.tsx"
Cohesion: 0.17
Nodes (14): DecisionPanel(), messageFor(), Props, Receipt(), satisfies(), Stage, Challenge, OtpStep() (+6 more)

### Community 47 - "0002_search_and_projections.sql"
Cohesion: 0.16
Nodes (18): change_order_versions_touch, change_orders_search_trigger(), change_orders_search_update, change_orders_touch, contacts_touch, customers_search_trigger(), customers_search_update, customers_touch (+10 more)

### Community 48 - "email.ts"
Cohesion: 0.18
Nodes (6): RFC-822, ConsoleEmailDriver, EmailDriver, EmailMessage, FileEmailDriver, SmtpEmailDriver

### Community 49 - "Adapter-with-deferred-driver MVP posture"
Cohesion: 0.12
Nodes (20): A2 rejected with ASSURANCE_UNAVAILABLE, 32-byte approval token, SHA-256 stored, Defect: CHECK constraints made a cancelled draft unrepresentable, Defect: 'code' in the log redaction list, Defect: public session cookie discarded during SSR, Server-side entitlements and lapse read/export mode, Adapter-with-deferred-driver MVP posture, NativeShareGateway (+12 more)

### Community 50 - "gateways.ts"
Cohesion: 0.13
Nodes (12): CreatePaymentCommand, DisabledPaymentGateway, InboundMediaRef, InboundMessageEvent, OutboundTemplate, PaymentGateway, PaymentOrderRef, mapPaymentStatus() (+4 more)

### Community 51 - "state-machine.ts"
Cohesion: 0.08
Nodes (19): isOpenForDecision(), OPEN_STATUSES, STATUS_LABEL, TERMINAL_STATUSES, TRANSITIONS, VERSION_ACTIONS, VersionAction, buildReminderSchedule() (+11 more)

### Community 52 - "domain/package.json"
Cohesion: 0.11
Nodes (17): decimal.js, libphonenumber-js, dependencies, decimal.js, @extrawork/contracts, libphonenumber-js, exports, @extrawork/contracts (+9 more)

### Community 53 - "toDate"
Cohesion: 0.08
Nodes (28): AttachmentRow, ChangeOrderRecord, ChangeOrderRow, ChangeOrderSummaryRecord, ChangeOrderSummaryRow, LineItemRow, LineItemWrite, mapChangeOrder() (+20 more)

### Community 54 - "0003_append_only_evidence.sql"
Cohesion: 0.17
Nodes (16): audit_events_append_only(), audit_events_no_delete, audit_events_no_update, baseline_versions_append_only(), baseline_versions_no_update, decisions_append_only(), decisions_no_delete, decisions_no_update (+8 more)

### Community 55 - "toDateOrNull"
Cohesion: 0.09
Nodes (18): DOC_COLUMNS, DocumentRecord, GeneratedDocumentRow, MessageRow, WebhookEventRow, INBOUND_COLUMNS_ALIASED, INBOUND_COLUMNS_BARE, InboundMessageRepository (+10 more)

### Community 56 - "observability/package.json"
Cohesion: 0.11
Nodes (17): dependencies, @extrawork/config, pino, pino-pretty, exports, @extrawork/config, main, name (+9 more)

### Community 57 - "CI job: Integration, security and golden tests"
Cohesion: 0.15
Nodes (17): One CI job per launch blocker, CI job: Integration, security and golden tests, CI job: End-to-end (Playwright), Migration idempotency check, CI job: Migration lint, Ephemeral PostgreSQL 16 CI service, CI job: Format, lint, typecheck, CI job: Unit and property tests (+9 more)

### Community 58 - "Compose service: api"
Cohesion: 0.15
Nodes (17): CI placeholder secrets, Compose service: api, Shared app-env anchor, app compose profile, C collation for reproducible index behaviour, Compose service: db (PostgreSQL 16), Compose service: mailpit, Compose service: minio (+9 more)

### Community 59 - "config/src/index.ts"
Cohesion: 0.17
Nodes (12): loadEnvFile(), anchorLocalPaths(), assertProductionSafe(), booleanish, config(), ConfigError, csv, DEVELOPMENT_PLACEHOLDERS (+4 more)

### Community 60 - "decide.ts"
Cohesion: 0.13
Nodes (12): DecideCommand, DecisionReceipt, DecisionService, DECLARATIONS, OtpService, PublicApprovalService, ResolvedPublicRequest, summariseAddress() (+4 more)

### Community 61 - "share.ts"
Cohesion: 0.21
Nodes (9): buildDecisionReceiptMessage(), buildDecisionReceiptTemplateParameters(), buildReminderMessage(), buildRequestMessage(), buildRequestTemplateParameters(), DecisionReceiptMessageInput, formatLocalDate(), ShareMessageInput (+1 more)

### Community 62 - "repositories/employees.ts"
Cohesion: 0.13
Nodes (12): EMPLOYEE_COLUMNS, EMPLOYEE_WITH_ASSIGNMENTS_COLUMNS, EmployeeRecord, EmployeeRepository, EmployeeRow, EmployeeStatus, EmployeeWithAssignments, mapEmployee() (+4 more)

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

### Community 67 - "token.ts"
Cohesion: 0.11
Nodes (15): approvalLinkAad(), ApprovalLinkCipherContext, approvalLinkKey(), assertApprovalLinkSecret(), DECIDED_LINK_RETENTION_DAYS, decryptApprovalUrl(), encryptApprovalUrl(), generateApprovalToken() (+7 more)

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
Cohesion: 0.13
Nodes (15): dependencies, drizzle-orm, @extrawork/db, @extrawork/integrations, fastify, @fastify/cookie, @fastify/helmet, zod-to-json-schema (+7 more)

### Community 72 - "events.ts"
Cohesion: 0.18
Nodes (9): DOMAIN_EVENTS, DomainEventType, JOB_KINDS, JOB_PRIORITY, JobKind, MAX_JOB_ATTEMPTS, OUTBOX_TOPICS, OutboxTopic (+1 more)

### Community 73 - "src/rate-limit.ts"
Cohesion: 0.13
Nodes (10): InMemoryRateLimiter, LocalReadRateLimiter, PostgresRateLimiter, RATE_LIMITS, RateLimiter, RateLimitName, RateLimitResult, RateLimitRule (+2 more)

### Community 74 - "evidence.ts"
Cohesion: 0.16
Nodes (9): EVIDENCE_GENERATOR_VERSION, EvidencePayload, generateEvidence(), truncate(), digest(), renderEvidenceHtml(), approvedFixture(), clock (+1 more)

### Community 75 - "Non-Erasable Decision Record"
Cohesion: 0.22
Nodes (10): erase-contact.ts Pseudonymisation CLI, Non-Erasable Decision Record, Migration Checksum Guard, Never Edit Evidence By Hand, Verify Schema Before Data, A0 Bearer-Link Assurance Level, Corrective Change to Undo an Approval, Spent Token With Recorded Decision (+2 more)

### Community 76 - "api/package.json"
Cohesion: 0.20
Nodes (9): default, development, exports, ./app, main, name, private, type (+1 more)

### Community 77 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 78 - "Design"
Cohesion: 0.20
Nodes (9): Accessibility, Boundaries, Colour, Components, Design, Layout, Motion, The world (+1 more)

### Community 79 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 80 - "rateLimit"
Cohesion: 0.31
Nodes (10): authenticatedSubject(), hashForBucket(), isAuthenticatedLimit(), publicTokenSubject(), rateLimit(), RateLimitOptions, registerFileRoutes(), registerOrganizationRoutes() (+2 more)

### Community 81 - "ExtraWork Technical Design Report and Master Build Specification v1.0"
Cohesion: 0.24
Nodes (10): CI job: Build web, API and worker, OpenAPI drift check, Build order S1–S10, Module map to package, Requirement traceability matrix, ExtraWork Technical Design Report and Master Build Specification v1.0, Workspace package globs (apps/*, packages/*), Enforced dependency direction (+2 more)

### Community 82 - "seed.ts"
Cohesion: 0.08
Nodes (29): actorContext(), ActorSpec, publicContext(), createTestContainer(), ensureMigrated(), PRESERVED_TABLES, TEST_DATABASE_URL, TestContainerOptions (+21 more)

### Community 83 - "e2e/fixtures.ts"
Cohesion: 0.27
Nodes (6): ApprovalLink, HELPER, ROOT, run, Scenario, seedScenario()

### Community 84 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, declarationMap, module, moduleResolution, noEmit, extends, ./tsconfig.json

### Community 85 - "app-shell.tsx"
Cohesion: 0.10
Nodes (24): MeResponse, AccountMenu(), AppShell(), NAV, NAV_MANAGE, NAV_SYSTEM, ShellUser, IconBuilding() (+16 more)

### Community 86 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, declarationMap, module, moduleResolution, noEmit, extends, ./tsconfig.json

### Community 87 - "Evidence pack (PDF + manifest)"
Cohesion: 0.28
Nodes (9): Private versioned bucket policy, Audit hash chain, Canonical JSON (JCS) + SHA-256 digest, Defect: manifest digest computed over its own wrapper, Defect: public decision ETag from lock_version, Evidence manifest and PDF template, Evidence pack (PDF + manifest), A sent version is frozen (+1 more)

### Community 88 - "application/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 89 - "config/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 90 - "contracts/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 91 - "db/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 92 - "domain/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 93 - "files/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 94 - "integrations/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 95 - "observability/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 96 - "runtime/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 97 - "testkit/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 98 - "ui/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 99 - "entitlements.ts"
Cohesion: 0.13
Nodes (12): assertQuota(), checkQuota(), Entitlements, FeatureKey, PlanCode, PLANS, QuotaCheck, QuotaKey (+4 more)

### Community 100 - "Preserve Evidence Then Contain"
Cohesion: 0.15
Nodes (13): Blast Radius Determination, DPDP Data Fiduciary Notification, Preserve Evidence Then Contain, Pseudonymous Log Correlation by requestId, Data Access, Export and Deletion Request Runbook, Erasure Versus Contractual Evidence Tension, Requester Role Triage, PRIVACY_HASH_SECRET (+5 more)

### Community 101 - "package.json"
Cohesion: 0.25
Nodes (7): description, engines, node, name, packageManager, private, version

### Community 102 - "services.ts"
Cohesion: 0.30
Nodes (6): OtpChallengeResult, SendResult, AppContext, systemClock, createAuthProvider(), createServices()

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
Cohesion: 0.24
Nodes (7): ESignGateway, UnavailableESignGateway, createEmailDriver(), createIntegrations(), createOtpGateway(), createWhatsAppGateway(), Integrations

### Community 107 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, openapi, start, typecheck

### Community 108 - "replies.ts"
Cohesion: 0.18
Nodes (11): decisionReply(), describeUnderstood(), FIELD_EXAMPLES, FIELD_LABEL, FORMAT_HINT, incompleteReply(), overCeilingReply(), sentToCustomerReply() (+3 more)

### Community 109 - "Append-only evidence"
Cohesion: 0.33
Nodes (6): Append-only via denied UPDATE/DELETE privileges, Defect: job handlers read tenant from payload, TenantContext required on every repository, Append-only evidence, db:harden restricted runtime role, Health and metrics endpoints

### Community 110 - "Job queue with lease, dead-letter and priorities"
Cohesion: 0.33
Nodes (6): Defect: outbox pump duplicated atomically enqueued jobs, Idempotency key (scope, subject, key), Job queue with lease, dead-letter and priorities, UnitOfWork atomic domain+audit+outbox commit, Atomic and idempotent decisions, No provider call inside a transaction

### Community 112 - "logger.ts"
Cohesion: 0.11
Nodes (11): createLogger(), LoggerContext, labelKey(), Labels, METRIC, metrics, MetricsRegistry, Series (+3 more)

### Community 113 - "project_integrity_mismatches"
Cohesion: 0.40
Nodes (6): INTEGRITY_REVIEW Project State, Nightly Project Integrity Job, project_integrity_mismatches(), Approved Delta Projection Drift, Repair Incorrect Project Totals Runbook, Projection Rebuild After Restore

### Community 114 - "totals.ts"
Cohesion: 0.12
Nodes (15): Blocker, DraftValidationInput, DraftValidationResult, validateDraft(), parseQuantity(), calculateLine(), calculateRevisedContractTotal(), calculateVersionTotals() (+7 more)

### Community 115 - "whatsapp.ts"
Cohesion: 0.13
Nodes (14): FetchedMedia, buildCloudApiPayload(), mapDeliveryStatus(), MetaInboundMessage, MetaMediaObject, MetaWebhookPayload, normalizeInboundMessage(), parseMetaInboundMessage() (+6 more)

### Community 116 - ".prettierrc.json"
Cohesion: 0.33
Nodes (5): arrowParens, printWidth, semi, singleQuote, trailingComma

### Community 117 - "parse-message.ts"
Cohesion: 0.19
Nodes (15): EMPTY, IntakeField, IntakeValidation, LABELS, looksLikeAmount(), looksLikeDays(), normalizeLabel(), parseAmountToMinor() (+7 more)

### Community 119 - "numbering.ts"
Cohesion: 0.25
Nodes (4): DEFAULT_FORMATS, NumberFormat, SEQUENCE_KINDS, SequenceKind

### Community 120 - "workerContext"
Cohesion: 0.18
Nodes (7): workerContext, delay(), EnqueueInput, jobsFor(), OutboxPump, ADR-0003, pdfStub

### Community 122 - "Operational Runbooks Index"
Cohesion: 0.22
Nodes (11): Cross-Tenant Disclosure Response Runbook, Concurrent Index Rebuild, Expand-and-Contract Migrations, Failed Migration Recovery Runbook, Fix Forward or Roll Back the Code, Per-Migration Transaction Atomicity, Operational Runbooks Index, Auth Provider JWKS Key Rollover (+3 more)

### Community 124 - "MessageGateway"
Cohesion: 0.13
Nodes (8): MessageGateway, OutboundMessage, ProviderEvent, EmailGateway, NativeShareWhatsAppGateway, SimulatedOutboundRecord, SimulatorOptions, SimulatorWhatsAppGateway

### Community 125 - "policy.ts"
Cohesion: 0.15
Nodes (12): Action, ACTIONS, Actor, authorize(), hasProjectAccess(), isAllowed(), ORG_WIDE_ROLES, READ_ONLY_SAFE_ACTIONS (+4 more)

### Community 126 - "jcs.ts"
Cohesion: 0.12
Nodes (23): canonicalBytes(), CanonicalizationError, canonicalize(), CANONICALIZER_VERSION, ESCAPES, JsonValue, serializeNumber(), serializeString() (+15 more)

### Community 127 - "api/reports.ts"
Cohesion: 0.14
Nodes (13): ApprovedChangeExport, ApprovedChangeExportSchema, CreateEvidencePackSchema, ExportJobDto, ExportJobSchema, ExtraWorkReportDto, ExtraWorkReportRow, ExtraWorkReportRowSchema (+5 more)

### Community 128 - "api/employees.ts"
Cohesion: 0.08
Nodes (23): CreateEmployeeInput, CreateEmployeeSchema, EmployeeDto, EmployeeListSchema, EmployeeSchema, EmployeeStatus, EmployeeStatusSchema, InboundMessageDto (+15 more)

### Community 129 - "r/[token]/page.tsx"
Cohesion: 0.25
Nodes (9): decisionLabel(), dynamic, loadRequest(), LoadResult, PageProps, PublicApprovalPage(), describe(), Described (+1 more)

### Community 135 - "OrganizationRepository"
Cohesion: 0.10
Nodes (7): mapOrganization(), ORG_COLUMNS, OrganizationRecord, OrganizationRepository, OrganizationRow, requireRow(), SubscriptionRow

### Community 136 - "plugins/errors.ts"
Cohesion: 0.60
Nodes (3): registerErrorHandler(), toAppError(), zodDetails()

### Community 142 - "dev-lan.sh"
Cohesion: 0.29
Nodes (6): API_HOST, API_PUBLIC_URL, CORS_ALLOWED_ORIGINS, NEXT_PUBLIC_API_URL, dev-lan.sh script, WEB_PUBLIC_URL

### Community 143 - "request-templates.ts"
Cohesion: 0.23
Nodes (6): mapTemplate(), RequestTemplateRepository, RequestTemplateRow, TEMPLATE_COLUMNS, TemplateRecord, TemplateSnapshot

### Community 144 - "format.ts"
Cohesion: 0.14
Nodes (25): ChangePage(), EmployeeManager(), EMPTY, FormState, messageFor(), ProjectOption, NewProjectPage(), projectFormError() (+17 more)

### Community 147 - "intake-service.ts"
Cohesion: 0.16
Nodes (8): firstName(), SendService, describe(), InboundWhatsAppMessage, IntakeOutcome, IntakeService, titleFrom(), validate()

### Community 162 - "api/change-orders.ts"
Cohesion: 0.08
Nodes (23): CancelChangeOrderSchema, ChangeOrderEventsDto, ChangeOrderEventsSchema, ChangeOrderVersionListSchema, CreateChangeOrderInput, CreateChangeOrderSchema, CreateRevisionSchema, EvidenceDocumentDto (+15 more)

### Community 163 - "ExtraWork — Product Brief"
Cohesion: 0.17
Nodes (11): Business owner or administrator, Core product value, Customer or authorized approver, End-to-end workflow, ExtraWork — Product Brief, Field employee, Later expansion, MVP scope (+3 more)

### Community 164 - "messaging.ts"
Cohesion: 0.16
Nodes (14): scanFile(), ScanPayload, firstName(), notifyTeamDecision(), ReceiptPayload, ReminderPayload, RequestMessagePayload, sendDecisionReceipt() (+6 more)

### Community 165 - "container.ts"
Cohesion: 0.40
Nodes (3): Container, ContainerOptions, createContainer()

### Community 166 - "jobs/webhooks.ts"
Cohesion: 0.21
Nodes (14): extensionFor(), handleInboundMessage(), sendReply(), storeInboundMedia(), toInboundMessageEvent(), applyMessageStatus(), looksLikeInboundMessage(), mapMessageStatuses() (+6 more)

### Community 167 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, tsx, typescript, tsx, typescript

### Community 168 - "PdfRenderer"
Cohesion: 0.12
Nodes (4): ChromiumPdfRenderer, PdfRenderer, UnavailablePdfRenderer, pdfStub

### Community 169 - "phone.ts"
Cohesion: 0.15
Nodes (17): DEFAULT_COUNTRY, DuplicateSignal, maskedContactLabel(), maskEmail(), maskPhone(), normalizeEmail(), normalizeForSearch(), normalizePhone() (+9 more)

### Community 171 - "change_order_versions"
Cohesion: 0.25
Nodes (14): approval_tokens, audit_events, change_order_versions, decisions, generated_documents, line_items, otp_challenges, payment_intents (+6 more)

### Community 173 - "routes/change-orders.ts"
Cohesion: 0.31
Nodes (8): IdParams, ProjectIdParams, registerChangeOrderRoutes(), summariseEvent(), IdParams, parseLockVersion(), registerCustomerRoutes(), summaryDto()

### Community 174 - "routes/employees.ts"
Cohesion: 0.53
Nodes (5): decorate(), IdParams, registerEmployeeRoutes(), toEmployeeDto(), toTemplateDto()

### Community 179 - "harden.ts"
Cohesion: 0.18
Nodes (6): APPEND_ONLY_TABLES, config, dryRun, FROZEN_TABLES, pool, statements

### Community 181 - "outbox.ts"
Cohesion: 0.22
Nodes (4): OutboxEventInput, OutboxRow, publishOutbox(), replayOutboxEvent()

### Community 188 - "Database"
Cohesion: 0.08
Nodes (6): Database, ChangeOrderRepository, mapVersion(), MessageRepository, WebhookInboxRepository, ReminderRepository

### Community 190 - "password.ts"
Cohesion: 0.28
Nodes (6): RFC-7914, hashPassword(), MIN_PASSWORD_LENGTH, OBVIOUS, scrypt(), verifyPassword()

### Community 191 - "google-oauth.ts"
Cohesion: 0.25
Nodes (5): base64url(), GoogleAuthStart, GoogleOAuthOptions, GoogleOAuthProvider, GoogleProfile

### Community 192 - "src/errors.ts"
Cohesion: 0.22
Nodes (5): AppError, ERROR_CODES, ERROR_MESSAGES, ErrorCode, ErrorEnvelope

### Community 193 - "chain.ts"
Cohesion: 0.36
Nodes (8): AuditEventInput, canonicalEventBody(), ChainedAuditEvent, chainEvents(), ChainVerificationResult, computeEventHash(), verifyChain(), verifyChainFrom()

### Community 195 - "domain/src/index.ts"
Cohesion: 0.11
Nodes (9): AssuranceCapabilities, PublicSessionAssurance, Section63Certificate, Section63Input, SECTION_63_AUTHORITY, SECTION_63_SCHEMA_VERSION, assertAllSameTenant(), assertSameTenant() (+1 more)

### Community 197 - "intake-service.test.ts"
Cohesion: 0.43
Nodes (7): addEmployee(), GOOD_MESSAGE, nextMessageId(), nextPhone(), raiseAndDecide(), send(), today()

### Community 198 - "routes/projects.ts"
Cohesion: 0.48
Nodes (6): fullProject(), IdParams, ProjectRowLike, projectTotalsDto(), registerProjectRoutes(), summariseProject()

### Community 199 - "Handler Idempotency"
Cohesion: 0.29
Nodes (8): Object Storage Bucket Versioning, Regenerable Evidence PDFs, claimForGeneration State Guard, Decisions Are Never Replayable, Handler Idempotency, Message dedupe_key Check, replay.ts Audited Replay Command, Side Effect Reconciliation After Rewind

### Community 202 - "Cross-Tenant IDOR Threat"
Cohesion: 0.50
Nodes (4): Cross-Tenant IDOR Threat, Tenant Authorization Rule, TenantContext Repository Scope, Tenant Isolation Negative Corpus

### Community 203 - "preflight-hosted.mts"
Cohesion: 0.47
Nodes (5): main(), record(), redact(), Result, results

### Community 205 - "build.ts"
Cohesion: 0.50
Nodes (4): BuildEvidenceOptions, buildEvidenceViewModel(), EvidenceViewModel, formatInTimezone()

### Community 210 - "intake-repositories.test.ts"
Cohesion: 0.70
Nodes (4): addEmployee(), nextMessageId(), nextPhone(), record()

### Community 217 - "signature.ts"
Cohesion: 0.43
Nodes (4): constantTimeEqual(), resolveMetaChallenge(), verifyMetaSignature(), verifyRazorpaySignature()

### Community 234 - "src/migrate.ts"
Cohesion: 0.22
Nodes (8): config, pool, loadMigrations(), MigrateOptions, MigrateResult, MigrationFile, MIGRATIONS_DIR, runMigrations()

### Community 235 - "reset.ts"
Cohesion: 0.24
Nodes (8): assertLocalDatabase(), DatabaseTarget, describeTarget(), LOCAL_HOSTS, config, databaseName, pool, url

### Community 237 - "repair-project-totals.ts"
Cohesion: 0.17
Nodes (9): config, dryRun, operator, projectId, reason, uow, createPool(), createUnitOfWork() (+1 more)

### Community 238 - "replay.ts"
Cohesion: 0.22
Nodes (7): config, jobKind, [kind, maybeId], limit, topic, uow, replayJob()

### Community 239 - "describe-error.ts"
Cohesion: 0.39
Nodes (7): collectCodes(), collectMessages(), DescribedError, describeError(), formatCliError(), NodeError, redactUrl()

### Community 240 - "signing.ts"
Cohesion: 0.50
Nodes (4): assertSignedDatePlausible(), calendarDateIn(), SIGNED_DATE_TOLERANCE_DAYS, SignedDateCheck

## Ambiguous Edges - Review These
- `allowBuilds native-dependency allowlist` → `Evidence pack (PDF + manifest)`  [AMBIGUOUS]
  pnpm-workspace.yaml · relation: conceptually_related_to

## Knowledge Gaps
- **1208 isolated node(s):** `printWidth`, `singleQuote`, `trailingComma`, `semi`, `arrowParens` (+1203 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **55 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `allowBuilds native-dependency allowlist` and `Evidence pack (PDF + manifest)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `TransactionContext` connect `TransactionContext` to `newId`, `jobs.ts`, `DocumentRepository`, `OrganizationRepository`, `repositories/index.ts`, `request-templates.ts`, `toDate`, `outbox.ts`, `CustomerRepository`, `toDateOrNull`, `repositories/files.ts`, `Database`, `repositories/employees.ts`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `Database` connect `Database` to `newId`, `jobs.ts`, `DocumentRepository`, `OrganizationRepository`, `TransactionContext`, `src/rate-limit.ts`, `repositories/index.ts`, `request-templates.ts`, `outbox.ts`, `toDate`, `CustomerRepository`, `toDateOrNull`, `repositories/files.ts`, `repositories/employees.ts`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Why does `IdentityRepository` connect `newId` to `toDate`, `repositories/index.ts`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `printWidth`, `singleQuote`, `trailingComma` to the rest of the system?**
  _1208 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `newId` be split into smaller, more focused modules?**
  _Cohesion score 0.05660377358490566 - nodes in this community are weakly interconnected._
- **Should `LocalObjectStore` be split into smaller, more focused modules?**
  _Cohesion score 0.05115089514066496 - nodes in this community are weakly interconnected._