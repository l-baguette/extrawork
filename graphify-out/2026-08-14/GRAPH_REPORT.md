# Graph Report - extrawork (2026-08-14)

## Corpus Check

- 270 files · ~170,339 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 2775 nodes · 5868 edges · 179 communities (141 shown, 38 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 111 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness

- Built from commit: `f66768a5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)

- identity.ts
- LocalObjectStore
- build.ts
- AppError
- TenantContext
- totals.ts
- schema/index.ts
- sequences.ts
- routes/employees.ts
- Database
- api/reports.ts
- chain.ts
- repositories/organizations.ts
- db/package.json
- TransactionContext
- dependencies
- testkit/package.json
- app.ts
- organizations
- replies.ts
- dependencies
- api.ts
- compilerOptions
- runner.ts
- versioning-and-evidence.test.ts
- state-machine.ts
- composer.tsx
- scripts
- client.ts
- api/projects.ts
- send.ts
- runtime/package.json
- contracts/src/index.ts
- application/package.json
- devDependencies
- evidence.test.ts
- integrations/package.json
- ProjectService
- main.ts
- files/package.json
- decision-panel.tsx
- repair-project-totals.ts
- document.ts
- primitives.ts
- compilerOptions
- domain/src/index.ts
- format.ts
- 0002_search_and_projections.sql
- email.ts
- Adapter-with-deferred-driver MVP posture
- razorpay.ts
- outbox-pump.ts
- domain/package.json
- repositories/projects.ts
- 0003_append_only_evidence.sql
- signature.ts
- observability/package.json
- CI job: Integration, security and golden tests
- Compose service: api
- MetricsRegistry
- api/organizations.ts
- config/src/index.ts
- RequestContext
- plugins/context.ts
- Record What You Did
- db/src/index.ts
- Restore Database and Verify Audit Chains Runbook
- Operational Runbooks Index
- config/package.json
- contracts/package.json
- gateways.ts
- dependencies
- validation.ts
- src/rate-limit.ts
- application/src/approvals/otp.ts
- Non-Erasable Decision Record
- api/package.json
- compilerOptions
- evidence.ts
- compilerOptions
- harden.ts
- ExtraWork Technical Design Report and Master Build Specification v1.0
- src/database.ts
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
- entitlements.ts
- Preserve Evidence Then Contain
- package.json
- ChromiumPdfRenderer
- Audited Repair Command
- Replay Webhook and Outbox Events Runbook
- ExtraWork — Project Handoff
- runtime/src/index.ts
- scripts
- token-and-files.test.ts
- Append-only evidence
- Job queue with lease, dead-letter and priorities
- Handler Idempotency
- repositories/change-orders.ts
- project_integrity_mismatches
- reminders/reminders.ts
- whatsapp.ts
- .prettierrc.json
- policy.ts
- next.config.mjs
- authorize
- @extrawork/config
- @extrawork/contracts
- jcs.ts
- @extrawork/domain
- @extrawork/integrations
- api/files.ts
- snapshot.ts
- @fastify/helmet
- describe-error.ts
- zod-to-json-schema
- next-env.d.ts
- query-keys.ts
- Money and totals engine
- Cross-Tenant IDOR Threat
- decide.ts
- Decision Write Path Priority
- @next/eslint-plugin-next
- @extrawork/contracts
- DisabledPaymentGateway
- @extrawork/application
- @extrawork/runtime
- @extrawork/observability
- tsx
- zod
- typescript-eslint
- @eslint/js
- vitest
- backup.sh
- restore.sh
- verify-backup.sh
- vitest.workspace.ts
- CI job: Dependency and secret scan
- Constraint Violation Means Real Bad Data
- api/change-orders.ts
- ExtraWork — Product Brief
- toDate
- dashboard/page.tsx
- integrations/src/index.ts
- devDependencies
- @extrawork/api
- @extrawork/domain
- CLAUDE.md
- @extrawork/integrations
- change-orders/service.ts
- pdfjs-dist
- typescript
- @typescript-eslint/eslint-plugin
- Container
- fastify-plugin
- fast-check

## God Nodes (most connected - your core abstractions)

1. `TenantContext` - 117 edges
2. `TransactionContext` - 92 edges
3. `Database` - 76 edges
4. `AppError` - 68 edges
5. `newId()` - 52 edges
6. `authorize()` - 47 edges
7. `RequestContext` - 44 edges
8. `AppContext` - 42 edges
9. `toDate()` - 41 edges
10. `Repositories` - 37 edges

## Surprising Connections (you probably didn't know these)

- `A2 rejected with ASSURANCE_UNAVAILABLE` --semantically_similar_to--> `Not a licensed electronic signature disclaimer` [INFERRED] [semantically similar]
  docs/IMPLEMENTATION_PLAN.md → README.md
- `allowBuilds native-dependency allowlist` --conceptually_related_to--> `Evidence pack (PDF + manifest)` [AMBIGUOUS]
  pnpm-workspace.yaml → README.md
- `Launch gates (report §16.3)` --semantically_similar_to--> `Launch gates with owners` [INFERRED] [semantically similar]
  README.md → docs/IMPLEMENTATION_PLAN.md
- `Evidence manifest and PDF template` --semantically_similar_to--> `Evidence pack (PDF + manifest)` [INFERRED] [semantically similar]
  docs/IMPLEMENTATION_PLAN.md → README.md
- `Props` --references--> `AssuranceLevel` [EXTRACTED]
  apps/web/src/app/r/[token]/otp-step.tsx → packages/contracts/src/primitives.ts

## Import Cycles

- None detected.

## Hyperedges (group relationships)

- **CI jobs that close automated launch blockers** — \_github_workflows_ci_migrations, \_github_workflows_ci_database, \_github_workflows_ci_build, \_github_workflows_ci_supply_chain, \_github_workflows_ci_e2e, readme_launch_gates [EXTRACTED 1.00]
- **Deferred-provider adapter set** — docs_implementation_plan_nativesharegateway, docs_implementation_plan_whatsappcloudgateway, docs_implementation_plan_otp_a1, docs_implementation_plan_a2_esign_rejection, docs_implementation_plan_paymentgateway, docs_implementation_plan_mvp_posture [EXTRACTED 1.00]
- **Evidence Integrity Discipline Shared by All Runbooks** — infra_runbooks_readme_never_edit_evidence_by_hand, infra_runbooks_readme_two_connections, infra_runbooks_readme_verify_after_every_repair, infra_runbooks_readme_record_what_you_did, infra_runbooks_readme_repair_command [EXTRACTED 1.00]
- **Local development dependency stack** — docker_compose_db, docker_compose_minio, docker_compose_minio_init, docker_compose_mailpit, readme_local_dev_options [EXTRACTED 1.00]
- **Post-Restore Verification Sequence** — infra_runbooks_restore_database_stop_writes, infra_runbooks_restore_database_schema_verification_before_data, infra_runbooks_restore_database_audit_chain_verification, infra_runbooks_restore_database_projection_rebuild, infra_runbooks_restore_database_side_effect_reconciliation, infra_runbooks_repair_project_totals_repair_project_totals_runbook [EXTRACTED 1.00]
- **Credential and Access Exposure Response Family** — infra_runbooks_revoke_leaked_token_approval_token_revocation, infra_runbooks_rotate_credentials_rotation_order_of_operations, infra_runbooks_freeze_organization_bulk_token_revocation_on_compromise, infra_runbooks_cross_tenant_disclosure_cross_tenant_disclosure_runbook, infra_runbooks_support_access_customer_granted_time_bound_access [INFERRED 0.85]

## Communities (179 total, 38 thin omitted)

### Community 0 - "identity.ts"

Cohesion: 0.11
Nodes (7): generateOpaqueToken(), hashOpaqueToken(), IdentityRepository, mapUser(), SessionRow, UserRecord, UserRow

### Community 1 - "LocalObjectStore"

Cohesion: 0.15
Nodes (3): LocalObjectStore, assertSafeKey(), S3ObjectStore

### Community 2 - "build.ts"

Cohesion: 0.21
Nodes (15): BuildEvidenceOptions, buildEvidenceViewModel(), EvidenceViewModel, formatInTimezone(), readChain(), verifyAggregateChain(), canonicalize(), JsonValue (+7 more)

### Community 3 - "AppError"

Cohesion: 0.12
Nodes (10): AppError, assertAllSameTenant(), assertSameTenant(), LocalSignaturePayload, LocalStoreOptions, ObjectMetadata, ObjectStore, PresignedUpload (+2 more)

### Community 4 - "TenantContext"

Cohesion: 0.18
Nodes (8): EMPLOYEE_COLUMNS, EmployeeRecord, EmployeeRepository, EmployeeStatus, mapEmployee(), translateUniqueViolation(), RequestTemplateRepository, TenantContext

### Community 5 - "totals.ts"

Cohesion: 0.19
Nodes (14): Blocker, DraftValidationInput, DraftValidationResult, parseQuantity(), addDays(), calculateLine(), calculateVersionTotals(), IntegrityCheckResult (+6 more)

### Community 6 - "schema/index.ts"

Cohesion: 0.04
Nodes (54): actorType, approvalTokens, assuranceLevel, auditEvents, authChallenges, baselineVersions, bigintNumeric, bytea (+46 more)

### Community 7 - "sequences.ts"

Cohesion: 0.26
Nodes (9): ORG_SCOPE_UUID, allocateNumber(), peekNextNumber(), DEFAULT_FORMATS, formatDocumentNumber(), NumberFormat, SEQUENCE_KINDS, SequenceKind (+1 more)

### Community 8 - "routes/employees.ts"

Cohesion: 0.21
Nodes (12): decorate(), IdParams, isPresent(), registerEmployeeRoutes(), toEmployeeDto(), toTemplateDto(), CreateEmployeeSchema, InboundMessageDto (+4 more)

### Community 9 - "Database"

Cohesion: 0.06
Nodes (12): Database, mapChangeOrder(), DOC_COLUMNS, DocumentRecord, DocumentRepository, GeneratedDocumentRow, mapDocument(), MessageRepository (+4 more)

### Community 10 - "api/reports.ts"

Cohesion: 0.15
Nodes (12): ApprovedChangeExport, ApprovedChangeExportSchema, CreateEvidencePackSchema, ExportJobDto, ExportJobSchema, ExtraWorkReportDto, ExtraWorkReportRow, ExtraWorkReportRowSchema (+4 more)

### Community 11 - "chain.ts"

Cohesion: 0.26
Nodes (8): canonicalEventBody(), chainEvents(), ChainVerificationResult, computeEventHash(), verifyChain(), verifyChainFrom(), CANONICALIZER_VERSION, RFC-8785

### Community 12 - "repositories/organizations.ts"

Cohesion: 0.10
Nodes (14): MembershipRole, MembershipRow, mapOrganization(), ORG_COLUMNS, OrganizationRecord, OrganizationRepository, OrganizationRow, SubscriptionRow (+6 more)

### Community 13 - "db/package.json"

Cohesion: 0.05
Nodes (37): drizzle-kit, drizzle-orm, dependencies, drizzle-orm, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability (+29 more)

### Community 14 - "TransactionContext"

Cohesion: 0.06
Nodes (22): AssuranceLevel, ChangeType, DecisionType, TransactionContext, newId(), ApprovalRepository, ApprovalTokenRow, DECISION_COLUMNS (+14 more)

### Community 15 - "dependencies"

Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 16 - "testkit/package.json"

Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 17 - "app.ts"

Cohesion: 0.11
Nodes (29): buildApp(), registerErrorHandler(), toAppError(), zodDetails(), authenticatedSubject(), hashForBucket(), ipSubject(), publicTokenSubject() (+21 more)

### Community 18 - "organizations"

Cohesion: 0.14
Nodes (39): baseline_versions, approval_tokens, audit_events, change_order_versions, change_orders, data_subject_requests, decisions, document_sequences (+31 more)

### Community 19 - "replies.ts"

Cohesion: 0.05
Nodes (39): normalizeForSearch(), MatchCandidate, MatchOptions, MatchOutcome, matchProject(), scoreCandidate(), STOP_WORDS, tokens() (+31 more)

### Community 20 - "dependencies"

Cohesion: 0.06
Nodes (33): dependencies, @extrawork/contracts, next, react, react-dom, react-hook-form, @tanstack/react-query, zod (+25 more)

### Community 21 - "api.ts"

Cohesion: 0.10
Nodes (28): ChangeActions(), RemindResult, EmployeeManager(), EMPTY, FormState, messageFor(), ProjectOption, OnboardingPage() (+20 more)

### Community 22 - "compilerOptions"

Cohesion: 0.06
Nodes (29): metadata, viewport, dist, .next, compilerOptions, allowSyntheticDefaultImports, declaration, declarationMap (+21 more)

### Community 23 - "runner.ts"

Cohesion: 0.12
Nodes (23): classify(), delay(), JobHandler, JobRunner, RunnerOptions, startLeaseReaper(), truncate(), DomainEventType (+15 more)

### Community 24 - "versioning-and-evidence.test.ts"

Cohesion: 0.22
Nodes (12): actorContext(), ActorSpec, publicContext(), addMember(), ChangeOrderFixtureOptions, createDraftChangeOrder(), createSentChangeOrder(), createTenant() (+4 more)

### Community 25 - "state-machine.ts"

Cohesion: 0.16
Nodes (15): affectsProjectTotals(), canTransition(), decisionAction(), isEditable(), isTerminal(), nextStatus(), OPEN_STATUSES, STATUS_LABEL (+7 more)

### Community 26 - "composer.tsx"

Cohesion: 0.12
Nodes (24): OfflineBanner(), useOnlineStatus(), Composer(), estimateLine(), Props, toApiPayload(), ADR-0005, zodResolver() (+16 more)

### Community 27 - "scripts"

Cohesion: 0.06
Nodes (31): scripts, build, build:packages, build:server, db:harden, db:migrate, db:repair, db:replay (+23 more)

### Community 28 - "client.ts"

Cohesion: 0.11
Nodes (17): ActorType, CreateDatabaseOptions, PgError, AuditEventRow, AuditWriter, ChainTail, lockChainTail(), PostgresAuditWriter (+9 more)

### Community 29 - "api/projects.ts"

Cohesion: 0.09
Nodes (27): fullProject(), IdParams, ProjectRowLike, projectTotalsDto(), registerProjectRoutes(), summariseProject(), AddressDto, AddressSchema (+19 more)

### Community 30 - "send.ts"

Cohesion: 0.12
Nodes (26): firstName(), SendResult, SendService, SendChangeOrderInput, publishOutbox(), resolveExpiry(), assertTransition(), collectSendBlockers() (+18 more)

### Community 31 - "runtime/package.json"

Cohesion: 0.07
Nodes (27): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+19 more)

### Community 32 - "contracts/src/index.ts"

Cohesion: 0.12
Nodes (23): dynamic, dynamic, EmployeesPage(), dynamic, dynamic, dynamic, dynamic, STATUS_LABELS (+15 more)

### Community 33 - "application/package.json"

Cohesion: 0.08
Nodes (25): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations, @extrawork/observability (+17 more)

### Community 34 - "devDependencies"

Cohesion: 0.08
Nodes (25): eslint, eslint-plugin-react-hooks, @extrawork/testkit, devDependencies, eslint, eslint-plugin-react-hooks, @extrawork/application, @extrawork/config (+17 more)

### Community 35 - "evidence.test.ts"

Cohesion: 0.18
Nodes (4): FixedClock, approvedFixture(), clock, viewModel()

### Community 36 - "integrations/package.json"

Cohesion: 0.08
Nodes (24): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, nodemailer, devDependencies, @types/nodemailer (+16 more)

### Community 37 - "ProjectService"

Cohesion: 0.27
Nodes (3): ProjectService, ProjectRow, assertBaselineEditable()

### Community 38 - "main.ts"

Cohesion: 0.09
Nodes (37): csvCell(), EXPORT_TEMPLATE_VERSION, ExportPayload, generateExport(), HEADERS, toCsv(), scanFile(), ScanPayload (+29 more)

### Community 39 - "files/package.json"

Cohesion: 0.08
Nodes (23): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @extrawork/config, @extrawork/contracts, @extrawork/observability (+15 more)

### Community 40 - "decision-panel.tsx"

Cohesion: 0.09
Nodes (27): DecisionPanel(), messageFor(), Props, Receipt(), satisfies(), Stage, Challenge, OtpStep() (+19 more)

### Community 41 - "repair-project-totals.ts"

Cohesion: 0.22
Nodes (6): config, dryRun, operator, projectId, reason, uow

### Community 42 - "document.ts"

Cohesion: 0.09
Nodes (24): buildOpenApiDocument(), commonErrors, componentSchemas, errorResponse(), idempotencyHeader, ifMatchHeader, jsonBody(), JsonObject (+16 more)

### Community 43 - "primitives.ts"

Cohesion: 0.07
Nodes (40): IdParams, ContactInput, ContactInputSchema, ContactSchema, CreateCustomerInput, CreateCustomerSchema, CustomerSchema, CustomerSummaryDto (+32 more)

### Community 44 - "compilerOptions"

Cohesion: 0.09
Nodes (21): compilerOptions, allowJs, incremental, jsx, lib, moduleResolution, noEmit, paths (+13 more)

### Community 45 - "domain/src/index.ts"

Cohesion: 0.09
Nodes (17): FileService, AuthenticatedIdentity, AuthProvider, AuthService, signInUrl(), displayNameFromEmail(), Jwk, localAuthSubject() (+9 more)

### Community 46 - "format.ts"

Cohesion: 0.16
Nodes (20): ChangePage(), dynamic, EventsResponse, dynamic, ProjectPage(), ReportsPage(), dynamic, ReceiptPage() (+12 more)

### Community 47 - "0002_search_and_projections.sql"

Cohesion: 0.16
Nodes (18): change_order_versions_touch, change_orders_search_trigger(), change_orders_search_update, change_orders_touch, contacts_touch, customers_search_trigger(), customers_search_update, customers_touch (+10 more)

### Community 48 - "email.ts"

Cohesion: 0.15
Nodes (7): RFC-822, ConsoleEmailDriver, EmailDriver, EmailGateway, EmailMessage, FileEmailDriver, SmtpEmailDriver

### Community 49 - "Adapter-with-deferred-driver MVP posture"

Cohesion: 0.12
Nodes (20): A2 rejected with ASSURANCE_UNAVAILABLE, 32-byte approval token, SHA-256 stored, Defect: CHECK constraints made a cancelled draft unrepresentable, Defect: 'code' in the log redaction list, Defect: public session cookie discarded during SSR, Server-side entitlements and lapse read/export mode, Adapter-with-deferred-driver MVP posture, NativeShareGateway (+12 more)

### Community 50 - "razorpay.ts"

Cohesion: 0.17
Nodes (8): CreatePaymentCommand, PaymentGateway, PaymentOrderRef, mapPaymentStatus(), RazorpayEntity, RazorpayGateway, RazorpayOptions, RazorpayWebhook

### Community 51 - "outbox-pump.ts"

Cohesion: 0.11
Nodes (20): delay(), EnqueueInput, jobsFor(), OutboxPump, ADR-0003, OutboxTopic, config, jobKind (+12 more)

### Community 52 - "domain/package.json"

Cohesion: 0.11
Nodes (17): decimal.js, libphonenumber-js, dependencies, decimal.js, @extrawork/contracts, libphonenumber-js, exports, @extrawork/contracts (+9 more)

### Community 53 - "repositories/projects.ts"

Cohesion: 0.12
Nodes (6): ProjectStatus, requireRow(), mapProject(), PROJECT_COLUMNS, ProjectRecord, ProjectRepository

### Community 54 - "0003_append_only_evidence.sql"

Cohesion: 0.17
Nodes (16): audit_events_append_only(), audit_events_no_delete, audit_events_no_update, baseline_versions_append_only(), baseline_versions_no_update, decisions_append_only(), decisions_no_delete, decisions_no_update (+8 more)

### Community 55 - "signature.ts"

Cohesion: 0.43
Nodes (4): constantTimeEqual(), resolveMetaChallenge(), verifyMetaSignature(), verifyRazorpaySignature()

### Community 56 - "observability/package.json"

Cohesion: 0.11
Nodes (17): dependencies, @extrawork/config, pino, pino-pretty, exports, @extrawork/config, main, name (+9 more)

### Community 57 - "CI job: Integration, security and golden tests"

Cohesion: 0.15
Nodes (17): One CI job per launch blocker, CI job: Integration, security and golden tests, CI job: End-to-end (Playwright), Migration idempotency check, CI job: Migration lint, Ephemeral PostgreSQL 16 CI service, CI job: Format, lint, typecheck, CI job: Unit and property tests (+9 more)

### Community 58 - "Compose service: api"

Cohesion: 0.16
Nodes (16): CI placeholder secrets, Compose service: api, Shared app-env anchor, app compose profile, C collation for reproducible index behaviour, Compose service: db (PostgreSQL 16), Compose service: minio, Compose service: minio-init (+8 more)

### Community 60 - "api/organizations.ts"

Cohesion: 0.11
Nodes (17): CreateOrganizationInput, CurrentUserDto, CurrentUserSchema, EntitlementsDto, EntitlementsSchema, GstinSchema, InviteMembershipInput, MembershipDto (+9 more)

### Community 61 - "config/src/index.ts"

Cohesion: 0.13
Nodes (13): loadEnvFile(), assertProductionSafe(), booleanish, config(), ConfigError, csv, DEVELOPMENT_PLACEHOLDERS, EnvSchema (+5 more)

### Community 62 - "RequestContext"

Cohesion: 0.14
Nodes (14): RequestContext, decodeInboundCursor(), EmployeeService, encodeInboundCursor(), CreateEmployeeInput, UpdateEmployeeInput, UpdateRequestTemplateInput, CustomerRow (+6 more)

### Community 63 - "plugins/context.ts"

Cohesion: 0.11
Nodes (23): clientIp(), contextPlugin(), CSRF_COOKIE, fastify, FastifyRequest, headerOrganizationId(), isMutation(), PUBLIC_CSRF_COOKIE (+15 more)

### Community 64 - "Record What You Did"

Cohesion: 0.14
Nodes (17): Export Never Gated on Billing Status, export-subject.ts Export CLI, Legal Hold, Organization Account Deletion with 30-Day Grace, Bulk Token Revocation on Account Compromise, Freeze One Organization Runbook, Live Approval Tokens Survive a Freeze, ORGANIZATION_SUSPENDED Status (+9 more)

### Community 65 - "db/src/index.ts"

Cohesion: 0.10
Nodes (28): BuildAppOptions, ContextPluginOptions, FastifyInstance, workerContext, AppContext, Clock, systemClock, LocalMagicLinkOptions (+20 more)

### Community 66 - "Restore Database and Verify Audit Chains Runbook"

Cohesion: 0.16
Nodes (15): Backups, Health Checks and Restore Rehearsal Runbook, Backup Freshness Alert, Backup Schedule and Retention Matrix, scripts/backup.sh, Daily Logical Dump, Managed PostgreSQL PITR, Measured RTO Target, Monthly Restore Rehearsal (+7 more)

### Community 67 - "Operational Runbooks Index"

Cohesion: 0.22
Nodes (11): Cross-Tenant Disclosure Response Runbook, Concurrent Index Rebuild, Expand-and-Contract Migrations, Failed Migration Recovery Runbook, Fix Forward or Roll Back the Code, Per-Migration Transaction Atomicity, Operational Runbooks Index, Auth Provider JWKS Key Rollover (+3 more)

### Community 68 - "config/package.json"

Cohesion: 0.14
Nodes (13): dependencies, zod, exports, zod, main, name, private, scripts (+5 more)

### Community 69 - "contracts/package.json"

Cohesion: 0.14
Nodes (13): dependencies, zod, exports, zod, main, name, private, scripts (+5 more)

### Community 70 - "gateways.ts"

Cohesion: 0.27
Nodes (6): OtpDeliveryCommand, OtpGateway, ProviderMessageRef, ConsoleOtpGateway, MessageGatewayOtpGateway, UnavailableOtpGateway

### Community 71 - "dependencies"

Cohesion: 0.15
Nodes (13): dependencies, @extrawork/db, @extrawork/files, @extrawork/runtime, fastify, @fastify/cookie, @fastify/cors, @extrawork/db (+5 more)

### Community 72 - "validation.ts"

Cohesion: 0.14
Nodes (13): ALLOWED_UPLOAD_MIME_TYPES, AllowedMimeType, MAX_FILE_BYTES, ClamAvScanner, EICAR, FileProcessResult, ScanResult, ScanVerdict (+5 more)

### Community 73 - "src/rate-limit.ts"

Cohesion: 0.19
Nodes (6): PostgresRateLimiter, RATE_LIMITS, RateLimiter, RateLimitResult, RateLimitRule, windowStart()

### Community 74 - "application/src/approvals/otp.ts"

Cohesion: 0.14
Nodes (16): OtpChallengeResult, OtpService, assertAssuranceAvailable(), assertOtpSendAllowed(), GeneratedOtp, generateOtp(), hashOtp(), OTP_DAILY_LIMIT (+8 more)

### Community 75 - "Non-Erasable Decision Record"

Cohesion: 0.22
Nodes (10): erase-contact.ts Pseudonymisation CLI, Non-Erasable Decision Record, Migration Checksum Guard, Never Edit Evidence By Hand, Verify Schema Before Data, A0 Bearer-Link Assurance Level, Corrective Change to Undo an Approval, Spent Token With Recorded Decision (+2 more)

### Community 76 - "api/package.json"

Cohesion: 0.25
Nodes (7): exports, ./app, main, name, private, type, version

### Community 77 - "compilerOptions"

Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 78 - "evidence.ts"

Cohesion: 0.14
Nodes (14): EVIDENCE_GENERATOR_VERSION, EvidencePayload, generateEvidence(), truncate(), applyMessageStatus(), mapMessageStatuses(), NormalizedStatus, normalizeWebhook() (+6 more)

### Community 79 - "compilerOptions"

Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 80 - "harden.ts"

Cohesion: 0.18
Nodes (6): APPEND_ONLY_TABLES, config, dryRun, FROZEN_TABLES, pool, statements

### Community 81 - "ExtraWork Technical Design Report and Master Build Specification v1.0"

Cohesion: 0.24
Nodes (10): CI job: Build web, API and worker, OpenAPI drift check, Build order S1–S10, Module map to package, Requirement traceability matrix, ExtraWork Technical Design Report and Master Build Specification v1.0, Workspace package globs (apps/_, packages/_), Enforced dependency direction (+2 more)

### Community 82 - "src/database.ts"

Cohesion: 0.31
Nodes (8): createPool(), createSilentLogger(), createTestContainer(), ensureMigrated(), PRESERVED_TABLES, TEST_DATABASE_URL, truncateAll(), withTestContainer()

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

Cohesion: 0.24
Nodes (10): Compose service: mailpit, Private versioned bucket policy, Audit hash chain, Canonical JSON (JCS) + SHA-256 digest, Defect: manifest digest computed over its own wrapper, Defect: public decision ETag from lock_version, Evidence manifest and PDF template, Evidence pack (PDF + manifest) (+2 more)

### Community 88 - "application/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 89 - "config/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 90 - "contracts/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 91 - "db/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 92 - "domain/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 93 - "files/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 94 - "integrations/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 95 - "observability/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 96 - "runtime/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 97 - "testkit/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 98 - "ui/tsconfig.json"

Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, extends, include, src/\*_/_.ts, ../../tsconfig.base.json

### Community 99 - "entitlements.ts"

Cohesion: 0.24
Nodes (7): assertQuota(), checkQuota(), FeatureKey, PLANS, QuotaCheck, QuotaKey, quotaMessage()

### Community 100 - "Preserve Evidence Then Contain"

Cohesion: 0.15
Nodes (13): Blast Radius Determination, DPDP Data Fiduciary Notification, Preserve Evidence Then Contain, Pseudonymous Log Correlation by requestId, Data Access, Export and Deletion Request Runbook, Erasure Versus Contractual Evidence Tension, Requester Role Triage, PRIVACY_HASH_SECRET (+5 more)

### Community 101 - "package.json"

Cohesion: 0.25
Nodes (7): description, engines, node, name, packageManager, private, version

### Community 102 - "ChromiumPdfRenderer"

Cohesion: 0.18
Nodes (3): ChromiumPdfRenderer, PdfRenderer, UnavailablePdfRenderer

### Community 103 - "Audited Repair Command"

Cohesion: 0.33
Nodes (7): extrawork.allow_repair Repair Mode Flag, Audited Repair Command, Two Connections: Runtime vs Maintenance Role, Diagnose Cause Before Rebuild, repair-project-totals.ts Rebuild CLI, Bounded Replay Only, Revocation Is Not Evidence

### Community 104 - "Replay Webhook and Outbox Events Runbook"

Cohesion: 0.29
Nodes (7): Dead-Letter Diagnosis Before Replay, PermanentJobError, Replay Webhook and Outbox Events Runbook, Meta WhatsApp App Secret Rotation, Payment Webhooks Are the Authority for Payment State, Razorpay Webhook Secret Rotation, Add, Switch, Observe, Remove

### Community 105 - "ExtraWork — Project Handoff"

Cohesion: 0.06
Nodes (30): 10. Test inventory, 11. Open questions for the founder, 1. What the product is, 2. Current status in one table, 3. How to get running (5 minutes), 4. Architecture, 5. The product pivot (this is the important part), 6.1 Company field is optional, not required (+22 more)

### Community 106 - "runtime/src/index.ts"

Cohesion: 0.17
Nodes (11): asJson, config, container, force, [command, ...args], config, container, decideAs() (+3 more)

### Community 107 - "scripts"

Cohesion: 0.33
Nodes (6): scripts, build, dev, openapi, start, typecheck

### Community 108 - "token-and-files.test.ts"

Cohesion: 0.31
Nodes (5): createLogger(), LoggerContext, redact(), REDACTED_KEYS, redactString()

### Community 109 - "Append-only evidence"

Cohesion: 0.33
Nodes (6): Append-only via denied UPDATE/DELETE privileges, Defect: job handlers read tenant from payload, TenantContext required on every repository, Append-only evidence, db:harden restricted runtime role, Health and metrics endpoints

### Community 110 - "Job queue with lease, dead-letter and priorities"

Cohesion: 0.33
Nodes (6): Defect: outbox pump duplicated atomically enqueued jobs, Idempotency key (scope, subject, key), Job queue with lease, dead-letter and priorities, UnitOfWork atomic domain+audit+outbox commit, Atomic and idempotent decisions, No provider call inside a transaction

### Community 111 - "Handler Idempotency"

Cohesion: 0.29
Nodes (8): Object Storage Bucket Versioning, Regenerable Evidence PDFs, claimForGeneration State Guard, Decisions Are Never Replayable, Handler Idempotency, Message dedupe_key Check, replay.ts Audited Replay Command, Side Effect Reconciliation After Rewind

### Community 112 - "repositories/change-orders.ts"

Cohesion: 0.07
Nodes (23): VersionStatus, AttachmentRow, ChangeOrderRecord, ChangeOrderRow, ChangeOrderSummaryRecord, ChangeOrderSummaryRow, LineItemRow, mapSummary() (+15 more)

### Community 113 - "project_integrity_mismatches"

Cohesion: 0.40
Nodes (6): INTEGRITY_REVIEW Project State, Nightly Project Integrity Job, project_integrity_mismatches(), Approved Delta Projection Drift, Repair Incorrect Project Totals Runbook, Projection Rebuild After Restore

### Community 114 - "reminders/reminders.ts"

Cohesion: 0.22
Nodes (12): isOpenForDecision(), buildReminderSchedule(), DEFAULT_REMINDER_POLICY, localHourIn(), nextLocalWindow(), ReminderChannel, ReminderContext, ReminderDecision (+4 more)

### Community 115 - "whatsapp.ts"

Cohesion: 0.13
Nodes (11): MessageGateway, OutboundMessage, ProviderEvent, mapDeliveryStatus(), MetaWebhookPayload, NativeShareWhatsAppGateway, payloadFingerprint(), STATUS_RANK (+3 more)

### Community 116 - ".prettierrc.json"

Cohesion: 0.33
Nodes (5): arrowParens, printWidth, semi, singleQuote, trailingComma

### Community 117 - "policy.ts"

Cohesion: 0.18
Nodes (11): Action, ACTIONS, Actor, hasProjectAccess(), isAllowed(), ORG_WIDE_ROLES, READ_ONLY_SAFE_ACTIONS, REAUTH_REQUIRED_ACTIONS (+3 more)

### Community 119 - "authorize"

Cohesion: 0.26
Nodes (4): ChangeOrderService, FileObjectRow, authorize(), assertAttachmentRemovable()

### Community 122 - "jcs.ts"

Cohesion: 0.31
Nodes (7): CanonicalizationError, ESCAPES, serializeNumber(), serializeString(), serializeValue(), sortKeys(), RFC-8785

### Community 125 - "api/files.ts"

Cohesion: 0.25
Nodes (7): CompleteUploadSchema, CreateUploadSchema, FileObjectDto, FileObjectSchema, PresignedUploadSchema, UploadPurpose, UploadPurposeSchema

### Community 126 - "snapshot.ts"

Cohesion: 0.32
Nodes (6): canonicalBytes(), buildCanonicalSnapshot(), freezeSnapshot(), SNAPSHOT_SCHEMA_VERSION, SnapshotInput, verifySnapshotDigest()

### Community 128 - "describe-error.ts"

Cohesion: 0.12
Nodes (19): collectCodes(), collectMessages(), DescribedError, describeError(), formatCliError(), NodeError, redactUrl(), config (+11 more)

### Community 135 - "Cross-Tenant IDOR Threat"

Cohesion: 0.50
Nodes (4): Cross-Tenant IDOR Threat, Tenant Authorization Rule, TenantContext Repository Scope, Tenant Isolation Negative Corpus

### Community 136 - "decide.ts"

Cohesion: 0.07
Nodes (36): DecideCommand, DecisionReceipt, DecisionService, DECLARATIONS, PublicApprovalService, summariseAddress(), publicDecisionEtag(), PublicRequestContext (+28 more)

### Community 162 - "api/change-orders.ts"

Cohesion: 0.05
Nodes (46): IdParams, ProjectIdParams, registerChangeOrderRoutes(), summariseEvent(), parseLockVersion(), summaryDto(), CancelChangeOrderSchema, ChangeOrderEventsDto (+38 more)

### Community 163 - "ExtraWork — Product Brief"

Cohesion: 0.17
Nodes (11): Business owner or administrator, Core product value, Customer or authorized approver, End-to-end workflow, ExtraWork — Product Brief, Field employee, Later expansion, MVP scope (+3 more)

### Community 164 - "toDate"

Cohesion: 0.09
Nodes (21): mapPublicSession(), mapToken(), FILE_COLUMNS, FileRecord, mapFile(), INBOUND_COLUMNS_BARE, InboundMessageRepository, InboundRecord (+13 more)

### Community 165 - "dashboard/page.tsx"

Cohesion: 0.31
Nodes (8): ChangeTable(), DashboardPage(), dynamic, ProjectsPage(), RequestsPage(), truncate(), formatMoneyCompact(), formatRelative()

### Community 166 - "integrations/src/index.ts"

Cohesion: 0.27
Nodes (5): ESignGateway, UnavailableESignGateway, createEmailDriver(), createIntegrations(), Integrations

### Community 167 - "devDependencies"

Cohesion: 0.40
Nodes (5): devDependencies, tsx, typescript, tsx, typescript

### Community 172 - "change-orders/service.ts"

Cohesion: 0.17
Nodes (15): buildLineItemWrites(), etagMatches(), toCalcInputs(), ADR-0005, versionEtag(), ADR-0005, CreateChangeOrderInput, UpdateDraftInput (+7 more)

### Community 176 - "Container"

Cohesion: 0.19
Nodes (7): PostgresUnitOfWork, Container, TestContainerOptions, addEmployee(), nextMessageId(), nextPhone(), record()

## Ambiguous Edges - Review These

- `allowBuilds native-dependency allowlist` → `Evidence pack (PDF + manifest)` [AMBIGUOUS]
  pnpm-workspace.yaml · relation: conceptually_related_to

## Knowledge Gaps

- **881 isolated node(s):** `printWidth`, `singleQuote`, `trailingComma`, `semi`, `arrowParens` (+876 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **38 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `allowBuilds native-dependency allowlist` and `Evidence pack (PDF + manifest)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `TenantContext` connect `TenantContext` to `db/src/index.ts`, `AppError`, `toDate`, `ProjectService`, `sequences.ts`, `Database`, `repositories/organizations.ts`, `domain/src/index.ts`, `TransactionContext`, `repositories/change-orders.ts`, `repositories/projects.ts`, `client.ts`, `RequestContext`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `AppError` connect `AppError` to `identity.ts`, `build.ts`, `TenantContext`, `totals.ts`, `sequences.ts`, `decide.ts`, `repositories/organizations.ts`, `TransactionContext`, `app.ts`, `replies.ts`, `api.ts`, `versioning-and-evidence.test.ts`, `state-machine.ts`, `client.ts`, `send.ts`, `api/change-orders.ts`, `toDate`, `change-orders/service.ts`, `domain/src/index.ts`, `email.ts`, `razorpay.ts`, `repositories/projects.ts`, `signature.ts`, `RequestContext`, `plugins/context.ts`, `gateways.ts`, `validation.ts`, `application/src/approvals/otp.ts`, `evidence.ts`, `entitlements.ts`, `token-and-files.test.ts`, `repositories/change-orders.ts`, `whatsapp.ts`, `policy.ts`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `projects` connect `organizations` to `schema/index.ts`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `printWidth`, `singleQuote`, `trailingComma` to the rest of the system?**
  _881 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `identity.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1076923076923077 - nodes in this community are weakly interconnected._
- **Should `AppError` be split into smaller, more focused modules?**
  _Cohesion score 0.11692307692307692 - nodes in this community are weakly interconnected._
