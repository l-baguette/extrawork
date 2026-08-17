# Graph Report - extrawork (2026-08-15)

## Corpus Check

- 280 files · ~179,887 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 2832 nodes · 6038 edges · 179 communities (140 shown, 39 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 114 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness

- Built from commit: `f66768a5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)

- TransactionContext
- LocalObjectStore
- audit.ts
- OrganizationRepository
- ProjectRepository
- totals.ts
- schema/index.ts
- sequences.ts
- api/employees.ts
- Database
- ChangeOrderRepository
- api.ts
- repositories/change-orders.ts
- db/package.json
- approvals.ts
- dependencies
- testkit/package.json
- app.ts
- organizations
- replies.ts
- dependencies
- employee-manager.tsx
- compilerOptions
- runner.ts
- parse-message.ts
- state-machine.ts
- composer.tsx
- scripts
- domain/src/index.ts
- api/projects.ts
- send.ts
- runtime/package.json
- contracts/src/index.ts
- application/package.json
- devDependencies
- intake-service.ts
- integrations/package.json
- RequestContext
- messaging.ts
- files/package.json
- decision-panel.tsx
- replay.ts
- document.ts
- api/customers.ts
- compilerOptions
- AppError
- format.ts
- 0002_search_and_projections.sql
- email.ts
- Adapter-with-deferred-driver MVP posture
- gateways.ts
- Money
- domain/package.json
- EmployeeRepository
- 0003_append_only_evidence.sql
- main.ts
- observability/package.json
- CI job: Integration, security and golden tests
- Compose service: api
- metrics.ts
- api/organizations.ts
- config/src/index.ts
- authorize
- dashboard/page.tsx
- Record What You Did
- AppContext
- Restore Database and Verify Audit Chains Runbook
- repair-project-totals.ts
- config/package.json
- contracts/package.json
- integrations/src/index.ts
- dependencies
- validation.ts
- src/rate-limit.ts
- application/src/approvals/otp.ts
- Non-Erasable Decision Record
- api/package.json
- compilerOptions
- match.ts
- compilerOptions
- harden.ts
- ExtraWork Technical Design Report and Master Build Specification v1.0
- evidence.test.ts
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
- describe-error.ts
- Bulk Token Revocation on Account Compromise
- Overlapping Key Versions
- ExtraWork — Project Handoff
- cli.ts
- scripts
- Backup Schedule and Retention Matrix
- Append-only evidence
- Job queue with lease, dead-letter and priorities
- Handler Idempotency
- TenantContext
- project_integrity_mismatches
- reminders/reminders.ts
- whatsapp.ts
- .prettierrc.json
- plugins/context.ts
- next.config.mjs
- files/service.ts
- @extrawork/config
- @extrawork/contracts
- token.ts
- @extrawork/domain
- MessageGateway
- verify-chain.ts
- @extrawork/runtime
- @fastify/helmet
- reset.ts
- zod-to-json-schema
- next-env.d.ts
- query-keys.ts
- Money and totals engine
- Operational Runbooks Index
- decide.ts
- Decision Write Path Priority
- @next/eslint-plugin-next
- @extrawork/contracts
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
- primitives.ts
- ExtraWork — Product Brief
- toDate
- ESignGateway
- devDependencies
- @extrawork/api
- @extrawork/domain
- CLAUDE.md
- @extrawork/integrations
- api/change-orders.ts
- pdfjs-dist
- typescript
- @typescript-eslint/eslint-plugin
- @extrawork/db
- fastify-plugin
- fast-check
- @extrawork/files
- fastify

## God Nodes (most connected - your core abstractions)

1. `TenantContext` - 122 edges
2. `TransactionContext` - 93 edges
3. `Database` - 76 edges
4. `AppError` - 71 edges
5. `newId()` - 52 edges
6. `authorize()` - 47 edges
7. `RequestContext` - 46 edges
8. `AppContext` - 45 edges
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

## Communities (179 total, 39 thin omitted)

### Community 0 - "TransactionContext"

Cohesion: 0.10
Nodes (6): TransactionContext, generateOpaqueToken(), hashOpaqueToken(), IdentityRepository, mapUser(), SupportRepository

### Community 1 - "LocalObjectStore"

Cohesion: 0.09
Nodes (10): LocalObjectStore, LocalSignaturePayload, LocalStoreOptions, assertSafeKey(), ObjectMetadata, ObjectStore, PresignedUpload, UploadRequest (+2 more)

### Community 2 - "audit.ts"

Cohesion: 0.07
Nodes (45): BuildEvidenceOptions, buildEvidenceViewModel(), formatInTimezone(), ActorType, AuditEventRow, AuditWriter, ChainTail, lockChainTail() (+37 more)

### Community 3 - "OrganizationRepository"

Cohesion: 0.11
Nodes (8): MembershipRole, MembershipRow, mapOrganization(), OrganizationRepository, requireRow(), assertAllSameTenant(), assertSameTenant(), ActorSpec

### Community 5 - "totals.ts"

Cohesion: 0.13
Nodes (21): CreateChangeOrderInput, UpdateDraftInput, assertAssuranceSelectable(), Blocker, collectSendBlockers(), DraftValidationInput, DraftValidationResult, validateDraft() (+13 more)

### Community 6 - "schema/index.ts"

Cohesion: 0.04
Nodes (54): actorType, approvalTokens, assuranceLevel, auditEvents, authChallenges, baselineVersions, bigintNumeric, bytea (+46 more)

### Community 7 - "sequences.ts"

Cohesion: 0.26
Nodes (9): ORG_SCOPE_UUID, allocateNumber(), peekNextNumber(), DEFAULT_FORMATS, formatDocumentNumber(), NumberFormat, SEQUENCE_KINDS, SequenceKind (+1 more)

### Community 8 - "api/employees.ts"

Cohesion: 0.10
Nodes (24): decorate(), IdParams, isPresent(), registerEmployeeRoutes(), toEmployeeDto(), toTemplateDto(), CreateEmployeeInput, CreateEmployeeSchema (+16 more)

### Community 9 - "Database"

Cohesion: 0.06
Nodes (9): Database, DocumentRepository, mapDocument(), MessageRepository, WebhookInboxRepository, FileRepository, mapFile(), ReminderRepository (+1 more)

### Community 10 - "ChangeOrderRepository"

Cohesion: 0.14
Nodes (3): ChangeOrderRepository, mapChangeOrder(), mapVersion()

### Community 11 - "api.ts"

Cohesion: 0.09
Nodes (21): Challenge, OtpStep(), Props, dynamic, OutboxRecord, SendResult, SimEmployee, SimulatorConsole() (+13 more)

### Community 12 - "repositories/change-orders.ts"

Cohesion: 0.11
Nodes (21): ChangeType, VersionStatus, AttachmentRow, ChangeOrderRecord, ChangeOrderRow, ChangeOrderSummaryRecord, ChangeOrderSummaryRow, LineItemRow (+13 more)

### Community 13 - "db/package.json"

Cohesion: 0.05
Nodes (37): drizzle-kit, dependencies, drizzle-orm, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, pg (+29 more)

### Community 14 - "approvals.ts"

Cohesion: 0.09
Nodes (16): DecisionReceipt, AssuranceLevel, DecisionType, ApprovalRepository, ApprovalTokenRow, DECISION_COLUMNS, DECISION_COLUMNS_D, DecisionRecord (+8 more)

### Community 15 - "dependencies"

Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 16 - "testkit/package.json"

Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 17 - "app.ts"

Cohesion: 0.08
Nodes (39): buildApp(), PUBLIC_CSRF_COOKIE, PUBLIC_SESSION_COOKIE, registerErrorHandler(), toAppError(), zodDetails(), authenticatedSubject(), hashForBucket() (+31 more)

### Community 18 - "organizations"

Cohesion: 0.14
Nodes (39): baseline_versions, approval_tokens, audit_events, change_order_versions, change_orders, data_subject_requests, decisions, document_sequences (+31 more)

### Community 19 - "replies.ts"

Cohesion: 0.15
Nodes (18): IntakeField, ParsedIntake, decisionReply(), describeUnderstood(), FIELD_EXAMPLES, FIELD_LABEL, FORMAT_HINT, helpReply() (+10 more)

### Community 20 - "dependencies"

Cohesion: 0.06
Nodes (33): dependencies, @extrawork/contracts, next, react, react-dom, react-hook-form, @tanstack/react-query, zod (+25 more)

### Community 21 - "employee-manager.tsx"

Cohesion: 0.13
Nodes (19): ChangeActions(), RemindResult, EmployeeManager(), EMPTY, FormState, messageFor(), ProjectOption, OnboardingPage() (+11 more)

### Community 22 - "compilerOptions"

Cohesion: 0.06
Nodes (29): metadata, viewport, dist, .next, compilerOptions, allowSyntheticDefaultImports, declaration, declarationMap (+21 more)

### Community 23 - "runner.ts"

Cohesion: 0.06
Nodes (44): applyMessageStatus(), mapMessageStatuses(), NormalizedStatus, normalizeWebhook(), STATUS_RANK, WebhookPayload, shutdown(), stopLeaseReaper (+36 more)

### Community 24 - "parse-message.ts"

Cohesion: 0.20
Nodes (16): MatchCandidate, EMPTY, IntakeValidation, LABELS, looksLikeAmount(), looksLikeDays(), normalizeLabel(), parseAmountToMinor() (+8 more)

### Community 25 - "state-machine.ts"

Cohesion: 0.16
Nodes (15): assertTransition(), canCreateRevision(), canTransition(), isEditable(), isTerminal(), nextStatus(), OPEN_STATUSES, STATUS_LABEL (+7 more)

### Community 26 - "composer.tsx"

Cohesion: 0.12
Nodes (25): NewProjectPage(), Composer(), estimateLine(), Props, toApiPayload(), ADR-0005, zodResolver(), DraftState (+17 more)

### Community 27 - "scripts"

Cohesion: 0.06
Nodes (31): scripts, build, build:packages, build:server, db:harden, db:migrate, db:repair, db:replay (+23 more)

### Community 28 - "domain/src/index.ts"

Cohesion: 0.07
Nodes (38): CreateDatabaseOptions, PgError, beginIdempotent(), completeIdempotent(), hashRequest(), IdempotencyBeginResult, newId(), schema (+30 more)

### Community 29 - "api/projects.ts"

Cohesion: 0.09
Nodes (27): fullProject(), IdParams, ProjectRowLike, projectTotalsDto(), registerProjectRoutes(), summariseProject(), AddressDto, AddressSchema (+19 more)

### Community 30 - "send.ts"

Cohesion: 0.16
Nodes (14): firstName(), SendResult, SendService, SendChangeOrderInput, DEFAULT_COUNTRY, duplicateScore(), DuplicateSignal, maskedContactLabel() (+6 more)

### Community 31 - "runtime/package.json"

Cohesion: 0.07
Nodes (27): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+19 more)

### Community 32 - "contracts/src/index.ts"

Cohesion: 0.13
Nodes (22): dynamic, dynamic, EmployeesPage(), dynamic, dynamic, dynamic, dynamic, dynamic (+14 more)

### Community 33 - "application/package.json"

Cohesion: 0.08
Nodes (25): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations, @extrawork/observability (+17 more)

### Community 34 - "devDependencies"

Cohesion: 0.08
Nodes (25): eslint, eslint-plugin-react-hooks, @extrawork/testkit, devDependencies, eslint, eslint-plugin-react-hooks, @extrawork/application, @extrawork/config (+17 more)

### Community 35 - "intake-service.ts"

Cohesion: 0.24
Nodes (8): describe(), InboundWhatsAppMessage, IntakeOutcome, IntakeService, titleFrom(), validate(), InboundStatus, notAuthorizedForProjectReply()

### Community 36 - "integrations/package.json"

Cohesion: 0.08
Nodes (24): dependencies, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, nodemailer, devDependencies, @types/nodemailer (+16 more)

### Community 37 - "RequestContext"

Cohesion: 0.14
Nodes (8): ChangeOrderService, RequestContext, ProjectService, BaselineAmendmentInput, CreateProjectInput, ProjectRow, assertAttachmentRemovable(), assertBaselineEditable()

### Community 38 - "messaging.ts"

Cohesion: 0.23
Nodes (16): firstName(), ReceiptPayload, ReminderPayload, RequestMessagePayload, sendDecisionReceipt(), sendReminder(), sendRequestMessage(), requireTenant() (+8 more)

### Community 39 - "files/package.json"

Cohesion: 0.08
Nodes (23): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @extrawork/config, @extrawork/contracts, @extrawork/observability (+15 more)

### Community 40 - "decision-panel.tsx"

Cohesion: 0.11
Nodes (23): DecisionPanel(), messageFor(), Props, Receipt(), satisfies(), Stage, decisionLabel(), dynamic (+15 more)

### Community 41 - "replay.ts"

Cohesion: 0.20
Nodes (8): config, jobKind, [kind, maybeId], limit, topic, uow, replayJob(), replayOutboxEvent()

### Community 42 - "document.ts"

Cohesion: 0.10
Nodes (23): buildOpenApiDocument(), commonErrors, componentSchemas, errorResponse(), idempotencyHeader, ifMatchHeader, jsonBody(), JsonObject (+15 more)

### Community 43 - "api/customers.ts"

Cohesion: 0.11
Nodes (19): IdParams, ContactInput, ContactInputSchema, ContactSchema, CreateCustomerInput, CreateCustomerSchema, CustomerSchema, CustomerSummaryDto (+11 more)

### Community 44 - "compilerOptions"

Cohesion: 0.09
Nodes (21): compilerOptions, allowJs, incremental, jsx, lib, moduleResolution, noEmit, paths (+13 more)

### Community 45 - "AppError"

Cohesion: 0.08
Nodes (21): buildLineItemWrites(), toCalcInputs(), ADR-0005, versionEtag(), ADR-0005, AuthenticatedIdentity, AuthProvider, AuthService (+13 more)

### Community 46 - "format.ts"

Cohesion: 0.23
Nodes (16): ChangePage(), dynamic, EventsResponse, ProjectPage(), ReportsPage(), dynamic, ReceiptPage(), RequestSummary() (+8 more)

### Community 47 - "0002_search_and_projections.sql"

Cohesion: 0.16
Nodes (18): change_order_versions_touch, change_orders_search_trigger(), change_orders_search_update, change_orders_touch, contacts_touch, customers_search_trigger(), customers_search_update, customers_touch (+10 more)

### Community 48 - "email.ts"

Cohesion: 0.14
Nodes (7): RFC-822, ConsoleEmailDriver, EmailDriver, EmailGateway, EmailMessage, FileEmailDriver, SmtpEmailDriver

### Community 49 - "Adapter-with-deferred-driver MVP posture"

Cohesion: 0.12
Nodes (20): A2 rejected with ASSURANCE_UNAVAILABLE, 32-byte approval token, SHA-256 stored, Defect: CHECK constraints made a cancelled draft unrepresentable, Defect: 'code' in the log redaction list, Defect: public session cookie discarded during SSR, Server-side entitlements and lapse read/export mode, Adapter-with-deferred-driver MVP posture, NativeShareGateway (+12 more)

### Community 50 - "gateways.ts"

Cohesion: 0.17
Nodes (8): CreatePaymentCommand, DisabledPaymentGateway, PaymentGateway, PaymentOrderRef, RazorpayEntity, RazorpayGateway, RazorpayOptions, RazorpayWebhook

### Community 51 - "Money"

Cohesion: 0.18
Nodes (4): assertInt64(), Money, normalizeCurrency(), toIntegerBigint()

### Community 52 - "domain/package.json"

Cohesion: 0.11
Nodes (17): decimal.js, libphonenumber-js, dependencies, decimal.js, @extrawork/contracts, libphonenumber-js, exports, @extrawork/contracts (+9 more)

### Community 53 - "EmployeeRepository"

Cohesion: 0.25
Nodes (3): EmployeeRepository, mapEmployee(), translateUniqueViolation()

### Community 54 - "0003_append_only_evidence.sql"

Cohesion: 0.17
Nodes (16): audit_events_append_only(), audit_events_no_delete, audit_events_no_update, baseline_versions_append_only(), baseline_versions_no_update, decisions_append_only(), decisions_no_delete, decisions_no_update (+8 more)

### Community 55 - "main.ts"

Cohesion: 0.06
Nodes (38): EVIDENCE_GENERATOR_VERSION, EvidencePayload, generateEvidence(), truncate(), csvCell(), EXPORT_TEMPLATE_VERSION, ExportPayload, generateExport() (+30 more)

### Community 56 - "observability/package.json"

Cohesion: 0.11
Nodes (17): dependencies, @extrawork/config, pino, pino-pretty, exports, @extrawork/config, main, name (+9 more)

### Community 57 - "CI job: Integration, security and golden tests"

Cohesion: 0.15
Nodes (17): One CI job per launch blocker, CI job: Integration, security and golden tests, CI job: End-to-end (Playwright), Migration idempotency check, CI job: Migration lint, Ephemeral PostgreSQL 16 CI service, CI job: Format, lint, typecheck, CI job: Unit and property tests (+9 more)

### Community 58 - "Compose service: api"

Cohesion: 0.16
Nodes (16): CI placeholder secrets, Compose service: api, Shared app-env anchor, app compose profile, C collation for reproducible index behaviour, Compose service: db (PostgreSQL 16), Compose service: minio, Compose service: minio-init (+8 more)

### Community 59 - "metrics.ts"

Cohesion: 0.29
Nodes (4): labelKey(), Labels, MetricsRegistry, Series

### Community 60 - "api/organizations.ts"

Cohesion: 0.08
Nodes (26): CSRF_COOKIE, SESSION_COOKIE, registerAuthRoutes(), RequestSignInSchema, setSessionCookies(), SwitchOrganizationSchema, VerifySignInSchema, CreateOrganizationInput (+18 more)

### Community 61 - "config/src/index.ts"

Cohesion: 0.18
Nodes (11): loadEnvFile(), anchorLocalPaths(), assertProductionSafe(), booleanish, config(), ConfigError, csv, DEVELOPMENT_PLACEHOLDERS (+3 more)

### Community 62 - "authorize"

Cohesion: 0.22
Nodes (6): decodeInboundCursor(), EmployeeService, encodeInboundCursor(), EmployeeRow, EmployeeWithAssignments, authorize()

### Community 63 - "dashboard/page.tsx"

Cohesion: 0.19
Nodes (11): ChangeTable(), DashboardPage(), dynamic, ProjectsPage(), RequestsPage(), truncate(), LABELS, StatusChip() (+3 more)

### Community 64 - "Record What You Did"

Cohesion: 0.24
Nodes (10): Export Never Gated on Billing Status, export-subject.ts Export CLI, Legal Hold, Organization Account Deletion with 30-Day Grace, Freeze One Organization Runbook, ORGANIZATION_SUSPENDED Status, Reads and Exports Preserved During Freeze, Single-Tenant Blast Radius Check (+2 more)

### Community 65 - "AppContext"

Cohesion: 0.08
Nodes (24): BuildAppOptions, ContextPluginOptions, FastifyInstance, workerContext, PdfRenderer, AppContext, Clock, FixedClock (+16 more)

### Community 66 - "Restore Database and Verify Audit Chains Runbook"

Cohesion: 0.16
Nodes (15): Measured RTO Target, Monthly Restore Rehearsal, Concurrent Index Rebuild, Expand-and-Contract Migrations, Failed Migration Recovery Runbook, Fix Forward or Roll Back the Code, Per-Migration Transaction Atomicity, pnpm db:verify-chain (+7 more)

### Community 67 - "repair-project-totals.ts"

Cohesion: 0.22
Nodes (6): config, dryRun, operator, projectId, reason, uow

### Community 68 - "config/package.json"

Cohesion: 0.14
Nodes (13): dependencies, zod, exports, zod, main, name, private, scripts (+5 more)

### Community 69 - "contracts/package.json"

Cohesion: 0.14
Nodes (13): dependencies, zod, exports, zod, main, name, private, scripts (+5 more)

### Community 70 - "integrations/src/index.ts"

Cohesion: 0.22
Nodes (9): OtpDeliveryCommand, OtpGateway, ProviderMessageRef, createEmailDriver(), createIntegrations(), Integrations, ConsoleOtpGateway, MessageGatewayOtpGateway (+1 more)

### Community 71 - "dependencies"

Cohesion: 0.15
Nodes (13): dependencies, drizzle-orm, @extrawork/application, @extrawork/integrations, @extrawork/runtime, @fastify/cookie, @fastify/cors, drizzle-orm (+5 more)

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

Cohesion: 0.16
Nodes (14): erase-contact.ts Pseudonymisation CLI, Non-Erasable Decision Record, Migration Checksum Guard, Never Edit Evidence By Hand, Audited Repair Command, Bounded Replay Only, Decisions Are Never Replayable, replay.ts Audited Replay Command (+6 more)

### Community 76 - "api/package.json"

Cohesion: 0.25
Nodes (7): exports, ./app, main, name, private, type, version

### Community 77 - "compilerOptions"

Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 78 - "match.ts"

Cohesion: 0.36
Nodes (7): normalizeForSearch(), MatchOptions, MatchOutcome, matchProject(), scoreCandidate(), STOP_WORDS, tokens()

### Community 79 - "compilerOptions"

Cohesion: 0.18
Nodes (10): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+2 more)

### Community 80 - "harden.ts"

Cohesion: 0.18
Nodes (6): APPEND_ONLY_TABLES, config, dryRun, FROZEN_TABLES, pool, statements

### Community 81 - "ExtraWork Technical Design Report and Master Build Specification v1.0"

Cohesion: 0.24
Nodes (10): CI job: Build web, API and worker, OpenAPI drift check, Build order S1–S10, Module map to package, Requirement traceability matrix, ExtraWork Technical Design Report and Master Build Specification v1.0, Workspace package globs (apps/_, packages/_), Enforced dependency direction (+2 more)

### Community 82 - "evidence.test.ts"

Cohesion: 0.08
Nodes (41): localAuthSubject(), EVIDENCE_DISCLAIMER, createPool(), createSilentLogger(), Container, actorContext(), publicContext(), createTestContainer() (+33 more)

### Community 83 - "e2e/fixtures.ts"

Cohesion: 0.27
Nodes (6): ApprovalLink, HELPER, ROOT, run, Scenario, seedScenario()

### Community 84 - "compilerOptions"

Cohesion: 0.22
Nodes (8): compilerOptions, declaration, declarationMap, module, moduleResolution, noEmit, extends, ./tsconfig.json

### Community 85 - "providers.tsx"

Cohesion: 0.27
Nodes (5): AppNav(), LINKS, OfflineBanner(), useOnlineStatus(), Providers()

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

Cohesion: 0.13
Nodes (14): SubscriptionRow, assertQuota(), checkQuota(), Entitlements, entitlementsFor(), FeatureKey, PlanCode, PLANS (+6 more)

### Community 100 - "Preserve Evidence Then Contain"

Cohesion: 0.15
Nodes (13): Blast Radius Determination, DPDP Data Fiduciary Notification, Preserve Evidence Then Contain, Pseudonymous Log Correlation by requestId, Data Access, Export and Deletion Request Runbook, Erasure Versus Contractual Evidence Tension, Requester Role Triage, PRIVACY_HASH_SECRET (+5 more)

### Community 101 - "package.json"

Cohesion: 0.25
Nodes (7): description, engines, node, name, packageManager, private, version

### Community 102 - "describe-error.ts"

Cohesion: 0.39
Nodes (7): collectCodes(), collectMessages(), DescribedError, describeError(), formatCliError(), NodeError, redactUrl()

### Community 103 - "Bulk Token Revocation on Account Compromise"

Cohesion: 0.20
Nodes (10): Bulk Token Revocation on Account Compromise, Live Approval Tokens Survive a Freeze, extrawork.allow_repair Repair Mode Flag, Two Connections: Runtime vs Maintenance Role, Frozen Snapshot Is the Authority on What Was Shown, Approval Token Revocation, Create a New Version as Replacement, One Token, One Version, One Approver (+2 more)

### Community 104 - "Overlapping Key Versions"

Cohesion: 0.20
Nodes (10): Dead-Letter Diagnosis Before Replay, PermanentJobError, Replay Webhook and Outbox Events Runbook, Auth Provider JWKS Key Rollover, Meta WhatsApp App Secret Rotation, Overlapping Key Versions, Payment Webhooks Are the Authority for Payment State, Razorpay Webhook Secret Rotation (+2 more)

### Community 105 - "ExtraWork — Project Handoff"

Cohesion: 0.06
Nodes (30): 10. Test inventory, 11. Open questions for the founder, 1. What the product is, 2. Current status in one table, 3. How to get running (5 minutes), 4. Architecture, 5. The product pivot (this is the important part), 6.1 Company field is optional, not required (+22 more)

### Community 106 - "cli.ts"

Cohesion: 0.40
Nodes (4): asJson, config, container, force

### Community 107 - "scripts"

Cohesion: 0.33
Nodes (6): scripts, build, dev, openapi, start, typecheck

### Community 108 - "Backup Schedule and Retention Matrix"

Cohesion: 0.33
Nodes (7): Backups, Health Checks and Restore Rehearsal Runbook, Backup Freshness Alert, Backup Schedule and Retention Matrix, scripts/backup.sh, Daily Logical Dump, Managed PostgreSQL PITR, scripts/verify-backup.sh Daily Health Check

### Community 109 - "Append-only evidence"

Cohesion: 0.33
Nodes (6): Append-only via denied UPDATE/DELETE privileges, Defect: job handlers read tenant from payload, TenantContext required on every repository, Append-only evidence, db:harden restricted runtime role, Health and metrics endpoints

### Community 110 - "Job queue with lease, dead-letter and priorities"

Cohesion: 0.33
Nodes (6): Defect: outbox pump duplicated atomically enqueued jobs, Idempotency key (scope, subject, key), Job queue with lease, dead-letter and priorities, UnitOfWork atomic domain+audit+outbox commit, Atomic and idempotent decisions, No provider call inside a transaction

### Community 111 - "Handler Idempotency"

Cohesion: 0.40
Nodes (6): Object Storage Bucket Versioning, Regenerable Evidence PDFs, claimForGeneration State Guard, Handler Idempotency, Message dedupe_key Check, Side Effect Reconciliation After Rewind

### Community 112 - "TenantContext"

Cohesion: 0.14
Nodes (6): CustomerRepository, mapContact(), mapCustomer(), ReportingRepository, RequestTemplateRepository, TenantContext

### Community 113 - "project_integrity_mismatches"

Cohesion: 0.40
Nodes (6): INTEGRITY_REVIEW Project State, Nightly Project Integrity Job, project_integrity_mismatches(), Approved Delta Projection Drift, Repair Incorrect Project Totals Runbook, Projection Rebuild After Restore

### Community 114 - "reminders/reminders.ts"

Cohesion: 0.22
Nodes (12): isOpenForDecision(), buildReminderSchedule(), DEFAULT_REMINDER_POLICY, localHourIn(), nextLocalWindow(), ReminderChannel, ReminderContext, ReminderDecision (+4 more)

### Community 115 - "whatsapp.ts"

Cohesion: 0.15
Nodes (12): ProviderEvent, mapDeliveryStatus(), MetaWebhookPayload, payloadFingerprint(), STATUS_RANK, WHATSAPP_TEMPLATES, WhatsAppCloudOptions, mapPaymentStatus() (+4 more)

### Community 116 - ".prettierrc.json"

Cohesion: 0.33
Nodes (5): arrowParens, printWidth, semi, singleQuote, trailingComma

### Community 117 - "plugins/context.ts"

Cohesion: 0.09
Nodes (26): clientIp(), contextPlugin(), fastify, FastifyRequest, headerOrganizationId(), isMutation(), Action, ACTIONS (+18 more)

### Community 119 - "files/service.ts"

Cohesion: 0.31
Nodes (6): FileService, CreateUploadInput, PresignedUploadDto, FileObjectRow, sanitizeFilename(), assertUploadRequestAllowed()

### Community 122 - "token.ts"

Cohesion: 0.20
Nodes (11): buildApprovalUrl(), generateApprovalToken(), GeneratedToken, generateReceiptToken(), hashesEqual(), hashToken(), receiptDisplayId(), resolveExpiry() (+3 more)

### Community 124 - "MessageGateway"

Cohesion: 0.14
Nodes (7): MessageGateway, OutboundMessage, NativeShareWhatsAppGateway, SimulatedOutboundRecord, SimulatorOptions, SimulatorWhatsAppGateway, WhatsAppCloudGateway

### Community 125 - "verify-chain.ts"

Cohesion: 0.33
Nodes (4): asJson, config, Failure, uow

### Community 128 - "reset.ts"

Cohesion: 0.15
Nodes (12): config, pool, config, databaseName, pool, url, loadMigrations(), MigrateOptions (+4 more)

### Community 135 - "Operational Runbooks Index"

Cohesion: 0.33
Nodes (7): Cross-Tenant Disclosure Response Runbook, Cross-Tenant IDOR Threat, Tenant Authorization Rule, TenantContext Repository Scope, Tenant Isolation Negative Corpus, Operational Runbooks Index, Rotate Provider and Webhook Credentials Runbook

### Community 136 - "decide.ts"

Cohesion: 0.10
Nodes (25): DecideCommand, DecisionService, DECLARATIONS, PublicApprovalService, summariseAddress(), etagMatches(), publicDecisionEtag(), PublicRequestContext (+17 more)

### Community 162 - "primitives.ts"

Cohesion: 0.05
Nodes (50): ApproverSchema, AttachmentDto, AuditEventDto, ChangeOrderSummaryDto, ChangeOrderVersionDto, ChangeOrderVersionSchema, DecisionDto, DecisionSchema (+42 more)

### Community 163 - "ExtraWork — Product Brief"

Cohesion: 0.17
Nodes (11): Business owner or administrator, Core product value, Customer or authorized approver, End-to-end workflow, ExtraWork — Product Brief, Field employee, Later expansion, MVP scope (+3 more)

### Community 164 - "toDate"

Cohesion: 0.15
Nodes (12): mapPublicSession(), mapToken(), mapSummary(), InboundMessageRepository, mapInbound(), mapProject(), mapTemplate(), normalizePostgresTimestamp() (+4 more)

### Community 167 - "devDependencies"

Cohesion: 0.40
Nodes (5): devDependencies, tsx, typescript, tsx, typescript

### Community 172 - "api/change-orders.ts"

Cohesion: 0.10
Nodes (25): IdParams, ProjectIdParams, registerChangeOrderRoutes(), summariseEvent(), parseLockVersion(), summaryDto(), CancelChangeOrderSchema, ChangeOrderEventsDto (+17 more)

## Ambiguous Edges - Review These

- `allowBuilds native-dependency allowlist` → `Evidence pack (PDF + manifest)` [AMBIGUOUS]
  pnpm-workspace.yaml · relation: conceptually_related_to

## Knowledge Gaps

- **893 isolated node(s):** `printWidth`, `singleQuote`, `trailingComma`, `semi`, `arrowParens` (+888 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **39 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `allowBuilds native-dependency allowlist` and `Evidence pack (PDF + manifest)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `AppError` connect `AppError` to `LocalObjectStore`, `audit.ts`, `OrganizationRepository`, `totals.ts`, `sequences.ts`, `decide.ts`, `api.ts`, `repositories/change-orders.ts`, `approvals.ts`, `app.ts`, `replies.ts`, `parse-message.ts`, `state-machine.ts`, `domain/src/index.ts`, `send.ts`, `intake-service.ts`, `api/change-orders.ts`, `email.ts`, `gateways.ts`, `main.ts`, `api/organizations.ts`, `validation.ts`, `application/src/approvals/otp.ts`, `evidence.test.ts`, `entitlements.ts`, `whatsapp.ts`, `plugins/context.ts`, `files/service.ts`, `token.ts`, `MessageGateway`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `TenantContext` connect `TenantContext` to `TransactionContext`, `AppContext`, `audit.ts`, `intake-service.ts`, `toDate`, `RequestContext`, `OrganizationRepository`, `entitlements.ts`, `ProjectRepository`, `Database`, `ChangeOrderRepository`, `sequences.ts`, `repositories/change-orders.ts`, `AppError`, `approvals.ts`, `EmployeeRepository`, `domain/src/index.ts`, `authorize`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `projects` connect `organizations` to `schema/index.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `printWidth`, `singleQuote`, `trailingComma` to the rest of the system?**
  _893 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TransactionContext` be split into smaller, more focused modules?**
  _Cohesion score 0.0967741935483871 - nodes in this community are weakly interconnected._
- **Should `LocalObjectStore` be split into smaller, more focused modules?**
  _Cohesion score 0.08943089430894309 - nodes in this community are weakly interconnected._
