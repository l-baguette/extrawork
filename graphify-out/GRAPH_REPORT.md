# Graph Report - extrawork  (2026-08-21)

## Corpus Check
- 344 files · ~241,705 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3294 nodes · 5305 edges · 251 communities (190 shown, 61 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 126 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c25a98b3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TransactionContext
- LocalObjectStore
- api/files.ts
- domain/src/approvals/otp.ts
- ChangeOrderService
- Database
- schema/index.ts
- JobRunner
- ProjectRepository
- replay.ts
- toDate
- auth.ts
- primitives.ts
- db/package.json
- match.ts
- dependencies
- testkit/package.json
- app.ts
- organizations
- money.ts
- dependencies
- api.ts
- compilerOptions
- inbound-messages.ts
- services.ts
- src/assurance.ts
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
- gateways.ts
- ChromiumPdfRenderer
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
- razorpay.ts
- state-machine.ts
- domain/package.json
- repositories/change-orders.ts
- 0003_append_only_evidence.sql
- common.ts
- observability/package.json
- CI job: Integration, security and golden tests
- Compose service: api
- config/src/index.ts
- decide.ts
- integrations/src/index.ts
- repositories/employees.ts
- Moving off this machine: Supabase + Cloudflare R2
- Bulk Token Revocation on Account Compromise
- Product
- Backup Schedule and Retention Matrix
- token.ts
- config/package.json
- contracts/package.json
- ProviderMessageRef
- dependencies
- events.ts
- src/rate-limit.ts
- exports.ts
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
- Record What You Did
- package.json
- drizzle-orm
- MemoryStorage
- Operational Runbooks Index
- ExtraWork — Project Handoff
- message-delivery-ledger.test.ts
- scripts
- share.ts
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
- zod
- outbox-pump.ts
- fastify-plugin
- @extrawork/domain
- MessageGateway
- policy.ts
- jcs.ts
- api/reports.ts
- api/employees.ts
- @extrawork/application
- next-env.d.ts
- @extrawork/runtime
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
- audit.ts
- format.ts
- CustomerRepository
- idempotency-expiry.test.ts
- intake-service.ts
- replies.ts
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
- workerContext
- phone.ts
- CLAUDE.md
- 0001_core_schema.sql
- PostgresUnitOfWork
- routes/change-orders.ts
- @typescript-eslint/eslint-plugin
- decided-link-retention.test.ts
- @eslint/js
- @extrawork/config
- harden.ts
- @extrawork/files
- @extrawork/observability
- @extrawork/files
- @extrawork/observability
- @playwright/test
- ChangeOrderRepository
- vitest
- password.ts
- google-oauth.ts
- contracts/src/index.ts
- AGENTS.md
- approvals/assurance.ts
- @extrawork/api
- intake-service.test.ts
- routes/projects.ts
- Handler Idempotency
- FixedClock
- @extrawork/integrations
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
- Restore Database and Verify Audit Chains Runbook
- state-machine.test.ts
- whatsapp-template.test.ts
- project-scope-api.test.ts
- @fastify/cors
- intake-parse.test.ts
- signing-date.test.ts
- token.test.ts
- jobs.ts
- numbering.ts
- src/migrate.ts
- reset.ts
- repair-project-totals.ts
- chain.ts
- describe-error.ts
- repositories/index.ts
- @extrawork/config
- domain/src/index.ts
- 0013_critical_integrity_guards.sql
- @extrawork/application

## God Nodes (most connected - your core abstractions)
1. `TransactionContext` - 112 edges
2. `Database` - 88 edges
3. `newId()` - 54 edges
4. `toDate()` - 45 edges
5. `RequestContext` - 36 edges
6. `organizations` - 34 edges
7. `scripts` - 33 edges
8. `IdentityRepository` - 32 edges
9. `ChangeOrderRepository` - 31 edges
10. `toDateOrNull()` - 31 edges

## Surprising Connections (you probably didn't know these)
- `A2 rejected with ASSURANCE_UNAVAILABLE` --semantically_similar_to--> `Not a licensed electronic signature disclaimer`  [INFERRED] [semantically similar]
  docs/IMPLEMENTATION_PLAN.md → README.md
- `allowBuilds native-dependency allowlist` --conceptually_related_to--> `Evidence pack (PDF + manifest)`  [AMBIGUOUS]
  pnpm-workspace.yaml → README.md
- `Launch gates (report §16.3)` --semantically_similar_to--> `Launch gates with owners`  [INFERRED] [semantically similar]
  README.md → docs/IMPLEMENTATION_PLAN.md
- `Evidence manifest and PDF template` --semantically_similar_to--> `Evidence pack (PDF + manifest)`  [INFERRED] [semantically similar]
  docs/IMPLEMENTATION_PLAN.md → README.md
- `CI job: End-to-end (Playwright)` --shares_data_with--> `Shared app-env anchor`  [INFERRED]
  .github/workflows/ci.yml → docker-compose.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CI jobs that close automated launch blockers** — _github_workflows_ci_migrations, _github_workflows_ci_database, _github_workflows_ci_build, _github_workflows_ci_supply_chain, _github_workflows_ci_e2e, readme_launch_gates [EXTRACTED 1.00]
- **Deferred-provider adapter set** — docs_implementation_plan_nativesharegateway, docs_implementation_plan_whatsappcloudgateway, docs_implementation_plan_otp_a1, docs_implementation_plan_a2_esign_rejection, docs_implementation_plan_paymentgateway, docs_implementation_plan_mvp_posture [EXTRACTED 1.00]
- **Evidence Integrity Discipline Shared by All Runbooks** — infra_runbooks_readme_never_edit_evidence_by_hand, infra_runbooks_readme_two_connections, infra_runbooks_readme_verify_after_every_repair, infra_runbooks_readme_record_what_you_did, infra_runbooks_readme_repair_command [EXTRACTED 1.00]
- **Local development dependency stack** — docker_compose_db, docker_compose_minio, docker_compose_minio_init, docker_compose_mailpit, readme_local_dev_options [EXTRACTED 1.00]
- **Post-Restore Verification Sequence** — infra_runbooks_restore_database_stop_writes, infra_runbooks_restore_database_schema_verification_before_data, infra_runbooks_restore_database_audit_chain_verification, infra_runbooks_restore_database_projection_rebuild, infra_runbooks_restore_database_side_effect_reconciliation, infra_runbooks_repair_project_totals_repair_project_totals_runbook [EXTRACTED 1.00]
- **Credential and Access Exposure Response Family** — infra_runbooks_revoke_leaked_token_approval_token_revocation, infra_runbooks_rotate_credentials_rotation_order_of_operations, infra_runbooks_freeze_organization_bulk_token_revocation_on_compromise, infra_runbooks_cross_tenant_disclosure_cross_tenant_disclosure_runbook, infra_runbooks_support_access_customer_granted_time_bound_access [INFERRED 0.85]

## Communities (251 total, 61 thin omitted)

### Community 0 - "TransactionContext"
Cohesion: 0.06
Nodes (9): TransactionContext, newId(), ApprovalRepository, mapDecision(), mapToken(), generateOpaqueToken(), IdentityRepository, mapUser() (+1 more)

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
Cohesion: 0.16
Nodes (7): buildLineItemWrites(), toCalcInputs(), ADR-0005, versionEtag(), ChangeOrderService, CreateChangeOrderHooks, ADR-0005

### Community 5 - "Database"
Cohesion: 0.05
Nodes (19): Database, DELIVERY_COLUMNS, DeliveryRecipientKind, DOC_COLUMNS, DocumentRecord, DocumentRepository, GeneratedDocumentRow, mapDelivery() (+11 more)

### Community 6 - "schema/index.ts"
Cohesion: 0.04
Nodes (55): actorType, approvalTokens, assuranceLevel, auditEvents, authChallenges, baselineVersions, bigintNumeric, bytea (+47 more)

### Community 7 - "JobRunner"
Cohesion: 0.28
Nodes (4): classify(), delay(), JobRunner, truncate()

### Community 9 - "replay.ts"
Cohesion: 0.12
Nodes (11): config, jobKind, [kind, maybeId], limit, topic, uow, replayJob(), OutboxEventInput (+3 more)

### Community 10 - "toDate"
Cohesion: 0.09
Nodes (22): ApprovalTokenRow, DECISION_COLUMNS, DECISION_COLUMNS_D, DecisionRecord, DecisionRow, mapPublicSession(), PUBLIC_SESSION_COLUMNS, PublicSessionRecord (+14 more)

### Community 11 - "auth.ts"
Cohesion: 0.09
Nodes (22): clientIp(), contextPlugin(), ContextPluginOptions, CSRF_COOKIE, fastify, FastifyInstance, FastifyRequest, headerOrganizationId() (+14 more)

### Community 12 - "primitives.ts"
Cohesion: 0.07
Nodes (28): DecisionInput, DecisionInputSchema, DecisionReceiptDto, DecisionReceiptSchema, OtpChallengeSchema, OtpRequestSchema, OtpVerifyResultSchema, OtpVerifySchema (+20 more)

### Community 13 - "db/package.json"
Cohesion: 0.05
Nodes (40): drizzle-kit, dependencies, drizzle-orm, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability, pg (+32 more)

### Community 14 - "match.ts"
Cohesion: 0.36
Nodes (8): normalizeForSearch(), MatchCandidate, MatchOptions, MatchOutcome, matchProject(), scoreCandidate(), STOP_WORDS, tokens()

### Community 15 - "dependencies"
Cohesion: 0.05
Nodes (36): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+28 more)

### Community 16 - "testkit/package.json"
Cohesion: 0.05
Nodes (39): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+31 more)

### Community 17 - "app.ts"
Cohesion: 0.20
Nodes (11): buildApp(), BuildAppOptions, ipSubject(), registerAuthRoutes(), registerHealthRoutes(), registerPublicRoutes(), InboundSchema, registerSimulatorRoutes() (+3 more)

### Community 18 - "organizations"
Cohesion: 0.22
Nodes (19): audit_events, change_orders, data_subject_requests, file_objects, generated_documents, legal_holds, organizations, project_members (+11 more)

### Community 19 - "money.ts"
Cohesion: 0.15
Nodes (7): assertInt64(), currencySymbol(), MINOR_UNITS, minorUnitScale(), Money, normalizeCurrency(), toIntegerBigint()

### Community 20 - "dependencies"
Cohesion: 0.06
Nodes (33): dependencies, @extrawork/contracts, next, react, react-dom, react-hook-form, @tanstack/react-query, zod (+25 more)

### Community 21 - "api.ts"
Cohesion: 0.07
Nodes (33): ChangeActions(), RemindResult, EmployeeManager(), EMPTY, FormState, messageFor(), ProjectOption, NewProjectPage() (+25 more)

### Community 22 - "compilerOptions"
Cohesion: 0.06
Nodes (31): metadata, viewport, development, dist, .next, compilerOptions, allowSyntheticDefaultImports, customConditions (+23 more)

### Community 23 - "inbound-messages.ts"
Cohesion: 0.08
Nodes (16): INBOUND_COLUMNS_ALIASED, INBOUND_COLUMNS_BARE, InboundMessageRepository, InboundMessageRow, InboundRecord, InboundStatus, mapInbound(), mapTemplate() (+8 more)

### Community 24 - "services.ts"
Cohesion: 0.30
Nodes (6): OtpChallengeResult, SendResult, AppContext, systemClock, createAuthProvider(), createServices()

### Community 25 - "src/assurance.ts"
Cohesion: 0.18
Nodes (9): APPROVAL_DECLARATION, ASSURANCE_COPY, assuranceCopy, DECLINE_DECLARATION, EVIDENCE_DISCLAIMER, RANK, REVISION_DECLARATION, TERMS_VERSION (+1 more)

### Community 26 - "composer.tsx"
Cohesion: 0.13
Nodes (24): useOnlineStatus(), Composer(), estimateLine(), Props, toApiPayload(), ADR-0005, zodResolver(), DraftState (+16 more)

### Community 27 - "scripts"
Cohesion: 0.06
Nodes (33): scripts, build, build:packages, build:server, db:harden, db:migrate, db:repair, db:replay (+25 more)

### Community 28 - "RequestContext"
Cohesion: 0.11
Nodes (6): RequestContext, decodeInboundCursor(), EmployeeService, encodeInboundCursor(), FileService, ProjectService

### Community 29 - "api/projects.ts"
Cohesion: 0.08
Nodes (25): ChangeOrderSummarySchema, AddressDto, AddressSchema, BaselineAmendmentInput, BaselineAmendmentSchema, BaselineInput, BaselineInputSchema, ChangeRegisterDto (+17 more)

### Community 30 - "main.ts"
Cohesion: 0.16
Nodes (16): applyRetention(), checkProjectIntegrity(), enqueueDueReminders(), expireRequests(), scheduleRecurringJobs(), container, ctx, handlers (+8 more)

### Community 31 - "runtime/package.json"
Cohesion: 0.07
Nodes (27): dependencies, @extrawork/application, @extrawork/config, @extrawork/contracts, @extrawork/db, @extrawork/domain, @extrawork/files, @extrawork/integrations (+19 more)

### Community 32 - "dashboard/page.tsx"
Cohesion: 0.10
Nodes (34): dynamic, DashboardPage(), dynamic, formatDecisionTime(), dynamic, EmployeesPage(), dynamic, dynamic (+26 more)

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

### Community 37 - "gateways.ts"
Cohesion: 0.14
Nodes (8): DisabledPaymentGateway, ESignGateway, InboundMediaRef, InboundMessageEvent, OutboundTemplate, PaymentGateway, UnavailableESignGateway, Integrations

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
Cohesion: 0.08
Nodes (11): AuthenticatedIdentity, AuthProvider, AuthService, signInUrl(), displayNameFromEmail(), Jwk, localAuthSubject(), LocalMagicLinkOptions (+3 more)

### Community 46 - "decision-panel.tsx"
Cohesion: 0.11
Nodes (20): DecisionPanel(), messageFor(), Props, Receipt(), satisfies(), Stage, Challenge, OtpStep() (+12 more)

### Community 47 - "0002_search_and_projections.sql"
Cohesion: 0.16
Nodes (18): change_order_versions_touch, change_orders_search_trigger(), change_orders_search_update, change_orders_touch, contacts_touch, customers_search_trigger(), customers_search_update, customers_touch (+10 more)

### Community 48 - "email.ts"
Cohesion: 0.14
Nodes (8): RFC-822, ConsoleEmailDriver, EmailDriver, EmailGateway, EmailMessage, emailMessageId(), FileEmailDriver, SmtpEmailDriver

### Community 49 - "Adapter-with-deferred-driver MVP posture"
Cohesion: 0.12
Nodes (20): A2 rejected with ASSURANCE_UNAVAILABLE, 32-byte approval token, SHA-256 stored, Defect: CHECK constraints made a cancelled draft unrepresentable, Defect: 'code' in the log redaction list, Defect: public session cookie discarded during SSR, Server-side entitlements and lapse read/export mode, Adapter-with-deferred-driver MVP posture, NativeShareGateway (+12 more)

### Community 50 - "razorpay.ts"
Cohesion: 0.14
Nodes (13): CreatePaymentCommand, PaymentOrderRef, mapPaymentStatus(), NormalizedRazorpayPaymentEvent, normalizeRazorpayPaymentEvent(), RazorpayEntity, RazorpayGateway, RazorpayOptions (+5 more)

### Community 51 - "state-machine.ts"
Cohesion: 0.08
Nodes (19): isOpenForDecision(), OPEN_STATUSES, STATUS_LABEL, TERMINAL_STATUSES, TRANSITIONS, VERSION_ACTIONS, VersionAction, buildReminderSchedule() (+11 more)

### Community 52 - "domain/package.json"
Cohesion: 0.11
Nodes (17): decimal.js, libphonenumber-js, dependencies, decimal.js, @extrawork/contracts, libphonenumber-js, exports, @extrawork/contracts (+9 more)

### Community 53 - "repositories/change-orders.ts"
Cohesion: 0.07
Nodes (31): AttachmentRow, ChangeOrderRecord, ChangeOrderRow, ChangeOrderSummaryRecord, ChangeOrderSummaryRow, LineItemRow, LineItemWrite, mapSummary() (+23 more)

### Community 54 - "0003_append_only_evidence.sql"
Cohesion: 0.15
Nodes (16): audit_events_append_only(), audit_events_no_delete, audit_events_no_update, baseline_versions_append_only(), baseline_versions_no_update, decisions_append_only(), decisions_no_delete, decisions_no_update (+8 more)

### Community 55 - "common.ts"
Cohesion: 0.09
Nodes (22): ApproverSchema, AttachmentDto, AttachmentSchema, AuditEventDto, AuditEventSchema, ChangeOrderDto, ChangeOrderSchema, ChangeOrderSummaryDto (+14 more)

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

### Community 61 - "integrations/src/index.ts"
Cohesion: 0.70
Nodes (4): createEmailDriver(), createIntegrations(), createOtpGateway(), createWhatsAppGateway()

### Community 62 - "repositories/employees.ts"
Cohesion: 0.13
Nodes (12): EMPLOYEE_COLUMNS, EMPLOYEE_WITH_ASSIGNMENTS_COLUMNS, EmployeeRecord, EmployeeRepository, EmployeeRow, EmployeeStatus, EmployeeWithAssignments, mapEmployee() (+4 more)

### Community 63 - "Moving off this machine: Supabase + Cloudflare R2"
Cohesion: 0.17
Nodes (11): 1. Supabase, 2. Cloudflare R2, 3. Put the values in `.env` yourself, 4. Run the migration, 5. Verify, Before you start, Gotchas found doing this for real, Moving off this machine: Supabase + Cloudflare R2 (+3 more)

### Community 64 - "Bulk Token Revocation on Account Compromise"
Cohesion: 0.20
Nodes (10): Bulk Token Revocation on Account Compromise, Live Approval Tokens Survive a Freeze, extrawork.allow_repair Repair Mode Flag, Two Connections: Runtime vs Maintenance Role, Frozen Snapshot Is the Authority on What Was Shown, Approval Token Revocation, Create a New Version as Replacement, One Token, One Version, One Approver (+2 more)

### Community 65 - "Product"
Cohesion: 0.17
Nodes (11): Accessibility & Inclusion, Brand Commitments, Capabilities and Constraints, Evidence on Hand, Operating Context, Platform, Positioning, Product (+3 more)

### Community 66 - "Backup Schedule and Retention Matrix"
Cohesion: 0.29
Nodes (8): Backups, Health Checks and Restore Rehearsal Runbook, Backup Freshness Alert, Backup Schedule and Retention Matrix, scripts/backup.sh, Daily Logical Dump, Managed PostgreSQL PITR, scripts/verify-backup.sh Daily Health Check, Restore to a New Instance for Forensics

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
Nodes (15): dependencies, @extrawork/db, @extrawork/integrations, @extrawork/runtime, fastify, @fastify/cookie, @fastify/helmet, zod-to-json-schema (+7 more)

### Community 72 - "events.ts"
Cohesion: 0.18
Nodes (9): DOMAIN_EVENTS, DomainEventType, JOB_KINDS, JOB_PRIORITY, JobKind, MAX_JOB_ATTEMPTS, OUTBOX_TOPICS, OutboxTopic (+1 more)

### Community 73 - "src/rate-limit.ts"
Cohesion: 0.13
Nodes (10): InMemoryRateLimiter, LocalReadRateLimiter, PostgresRateLimiter, RATE_LIMITS, RateLimiter, RateLimitName, RateLimitResult, RateLimitRule (+2 more)

### Community 74 - "exports.ts"
Cohesion: 0.10
Nodes (19): csvCell(), EXPORT_TEMPLATE_VERSION, ExportPayload, generateAccountingCsv(), GeneratedExport, generateProjectEvidencePack(), HEADERS, PROJECT_EVIDENCE_PACK_GENERATOR_VERSION (+11 more)

### Community 75 - "Non-Erasable Decision Record"
Cohesion: 0.14
Nodes (16): Data Access, Export and Deletion Request Runbook, erase-contact.ts Pseudonymisation CLI, Erasure Versus Contractual Evidence Tension, Non-Erasable Decision Record, Migration Checksum Guard, Never Edit Evidence By Hand, Audited Repair Command, Bounded Replay Only (+8 more)

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
Cohesion: 0.20
Nodes (16): authenticatedSubject(), hashForBucket(), isAuthenticatedLimit(), publicTokenSubject(), rateLimit(), RateLimitOptions, decorate(), IdParams (+8 more)

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
Cohesion: 0.09
Nodes (25): MeResponse, AppShell(), NAV, NAV_MANAGE, NAV_SYSTEM, ShellUser, IconBuilding(), IconChevron() (+17 more)

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

### Community 100 - "Record What You Did"
Cohesion: 0.11
Nodes (21): Blast Radius Determination, DPDP Data Fiduciary Notification, Preserve Evidence Then Contain, Pseudonymous Log Correlation by requestId, Export Never Gated on Billing Status, export-subject.ts Export CLI, Legal Hold, Organization Account Deletion with 30-Day Grace (+13 more)

### Community 101 - "package.json"
Cohesion: 0.25
Nodes (7): description, engines, node, name, packageManager, private, version

### Community 104 - "Operational Runbooks Index"
Cohesion: 0.13
Nodes (17): Cross-Tenant Disclosure Response Runbook, Cross-Tenant IDOR Threat, Tenant Authorization Rule, TenantContext Repository Scope, Tenant Isolation Negative Corpus, Operational Runbooks Index, Dead-Letter Diagnosis Before Replay, PermanentJobError (+9 more)

### Community 105 - "ExtraWork — Project Handoff"
Cohesion: 0.06
Nodes (30): 10. Test inventory, 11. Open questions for the founder, 1. What the product is, 2. Current status in one table, 3. How to get running (5 minutes), 4. Architecture, 5. The product pivot (this is the important part), 6.1 Company field is optional, not required (+22 more)

### Community 106 - "message-delivery-ledger.test.ts"
Cohesion: 0.47
Nodes (3): approveChange(), job(), planCustomerReceipt()

### Community 107 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, openapi, start, typecheck

### Community 108 - "share.ts"
Cohesion: 0.23
Nodes (11): buildDecisionReceiptMessage(), buildDecisionReceiptTemplateParameters(), buildReminderMessage(), buildReminderTemplateParameters(), buildRequestMessage(), buildRequestTemplateParameters(), DecisionReceiptMessageInput, formatLocalDate() (+3 more)

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
Cohesion: 0.13
Nodes (16): Blocker, DraftValidationInput, DraftValidationResult, validateDraft(), parseQuantity(), roundHalfUpToBigint(), calculateLine(), calculateRevisedContractTotal() (+8 more)

### Community 115 - "whatsapp.ts"
Cohesion: 0.13
Nodes (15): FetchedMedia, buildCloudApiPayload(), mapDeliveryStatus(), MetaInboundMessage, MetaMediaObject, MetaWebhookPayload, normalizeInboundMessage(), parseMetaInboundMessage() (+7 more)

### Community 116 - ".prettierrc.json"
Cohesion: 0.33
Nodes (5): arrowParens, printWidth, semi, singleQuote, trailingComma

### Community 117 - "parse-message.ts"
Cohesion: 0.24
Nodes (12): EMPTY, IntakeValidation, LABELS, looksLikeAmount(), looksLikeDays(), normalizeLabel(), parseAmountToMinor(), parseCommaSeparated() (+4 more)

### Community 120 - "outbox-pump.ts"
Cohesion: 0.22
Nodes (5): delay(), EnqueueInput, jobsFor(), OutboxPump, ADR-0003

### Community 124 - "MessageGateway"
Cohesion: 0.16
Nodes (7): MessageGateway, OutboundMessage, ProviderEvent, NativeShareWhatsAppGateway, SimulatedOutboundRecord, SimulatorOptions, SimulatorWhatsAppGateway

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

### Community 136 - "plugins/errors.ts"
Cohesion: 0.60
Nodes (3): registerErrorHandler(), toAppError(), zodDetails()

### Community 142 - "dev-lan.sh"
Cohesion: 0.29
Nodes (6): API_HOST, API_PUBLIC_URL, CORS_ALLOWED_ORIGINS, NEXT_PUBLIC_API_URL, dev-lan.sh script, WEB_PUBLIC_URL

### Community 143 - "audit.ts"
Cohesion: 0.16
Nodes (14): asJson, config, Failure, uow, AuditEventRow, ChainTail, listAggregatesForOrganization(), lockChainTail() (+6 more)

### Community 144 - "format.ts"
Cohesion: 0.14
Nodes (21): ChangePage(), dynamic, EventsResponse, dynamic, ProjectPage(), ReportsPage(), dynamic, ReceiptPage() (+13 more)

### Community 145 - "CustomerRepository"
Cohesion: 0.15
Nodes (3): CustomerRepository, mapContact(), mapCustomer()

### Community 147 - "intake-service.ts"
Cohesion: 0.15
Nodes (8): firstName(), SendService, describe(), InboundWhatsAppMessage, IntakeOutcome, IntakeService, titleFrom(), validate()

### Community 148 - "replies.ts"
Cohesion: 0.15
Nodes (11): IntakeField, ParsedIntake, decisionReply(), describeUnderstood(), FIELD_EXAMPLES, FIELD_LABEL, FORMAT_HINT, incompleteReply() (+3 more)

### Community 162 - "api/change-orders.ts"
Cohesion: 0.08
Nodes (23): CancelChangeOrderSchema, ChangeOrderEventsDto, ChangeOrderEventsSchema, ChangeOrderVersionListSchema, CreateChangeOrderInput, CreateChangeOrderSchema, CreateRevisionSchema, EvidenceDocumentDto (+15 more)

### Community 163 - "ExtraWork — Product Brief"
Cohesion: 0.17
Nodes (11): Business owner or administrator, Core product value, Customer or authorized approver, End-to-end workflow, ExtraWork — Product Brief, Field employee, Later expansion, MVP scope (+3 more)

### Community 164 - "messaging.ts"
Cohesion: 0.16
Nodes (27): EVIDENCE_GENERATOR_VERSION, generateEvidence(), truncate(), generateExport(), parseExportPayload(), scanFile(), deliveryErrorCode(), firstName() (+19 more)

### Community 165 - "container.ts"
Cohesion: 0.40
Nodes (3): Container, ContainerOptions, createContainer()

### Community 166 - "jobs/webhooks.ts"
Cohesion: 0.14
Nodes (15): extensionFor(), handleInboundMessage(), sendReply(), storeInboundMedia(), toInboundMessageEvent(), applyMessageStatus(), looksLikeInboundMessage(), mapMessageStatuses() (+7 more)

### Community 167 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, tsx, typescript, tsx, typescript

### Community 168 - "workerContext"
Cohesion: 0.07
Nodes (14): workerContext, PdfRenderer, UnavailablePdfRenderer, fetchedMediaIds, GOOD_MESSAGE, pdfStub, PHOTO, runQueuedWebhookJob() (+6 more)

### Community 169 - "phone.ts"
Cohesion: 0.25
Nodes (9): DEFAULT_COUNTRY, DuplicateSignal, maskedContactLabel(), maskEmail(), maskPhone(), normalizeEmail(), normalizePhone(), tryNormalizeEmail() (+1 more)

### Community 171 - "0001_core_schema.sql"
Cohesion: 0.15
Nodes (23): approval_tokens, change_order_versions, decisions, document_sequences, entitlement_counters, idempotency_records, job_queue, line_items (+15 more)

### Community 173 - "routes/change-orders.ts"
Cohesion: 0.31
Nodes (8): IdParams, ProjectIdParams, registerChangeOrderRoutes(), summariseEvent(), IdParams, parseLockVersion(), registerCustomerRoutes(), summaryDto()

### Community 179 - "harden.ts"
Cohesion: 0.18
Nodes (6): APPEND_ONLY_TABLES, config, dryRun, FROZEN_TABLES, pool, statements

### Community 188 - "ChangeOrderRepository"
Cohesion: 0.12
Nodes (3): ChangeOrderRepository, mapChangeOrder(), mapVersion()

### Community 190 - "password.ts"
Cohesion: 0.28
Nodes (6): RFC-7914, hashPassword(), MIN_PASSWORD_LENGTH, OBVIOUS, scrypt(), verifyPassword()

### Community 191 - "google-oauth.ts"
Cohesion: 0.25
Nodes (5): base64url(), GoogleAuthStart, GoogleOAuthOptions, GoogleOAuthProvider, GoogleProfile

### Community 192 - "contracts/src/index.ts"
Cohesion: 0.16
Nodes (9): AppError, ERROR_CODES, ERROR_MESSAGES, ErrorCode, ErrorEnvelope, foldLatinAccents(), HONORIFICS, signerNameMatches() (+1 more)

### Community 197 - "intake-service.test.ts"
Cohesion: 0.43
Nodes (7): addEmployee(), GOOD_MESSAGE, nextMessageId(), nextPhone(), raiseAndDecide(), send(), today()

### Community 198 - "routes/projects.ts"
Cohesion: 0.48
Nodes (6): fullProject(), IdParams, ProjectRowLike, projectTotalsDto(), registerProjectRoutes(), summariseProject()

### Community 199 - "Handler Idempotency"
Cohesion: 0.40
Nodes (6): Object Storage Bucket Versioning, Regenerable Evidence PDFs, claimForGeneration State Guard, Handler Idempotency, Message dedupe_key Check, Side Effect Reconciliation After Rewind

### Community 203 - "preflight-hosted.mts"
Cohesion: 0.47
Nodes (5): main(), record(), redact(), Result, results

### Community 205 - "build.ts"
Cohesion: 0.50
Nodes (4): BuildEvidenceOptions, buildEvidenceViewModel(), EvidenceViewModel, formatInTimezone()

### Community 210 - "intake-repositories.test.ts"
Cohesion: 0.70
Nodes (4): addEmployee(), nextMessageId(), nextPhone(), record()

### Community 217 - "Restore Database and Verify Audit Chains Runbook"
Cohesion: 0.18
Nodes (14): Measured RTO Target, Monthly Restore Rehearsal, Concurrent Index Rebuild, Expand-and-Contract Migrations, Failed Migration Recovery Runbook, Fix Forward or Roll Back the Code, Per-Migration Transaction Atomicity, pnpm db:verify-chain (+6 more)

### Community 239 - "jobs.ts"
Cohesion: 0.18
Nodes (7): enqueueJob(), EnqueueJobInput, failJob(), JobRow, queueDepth, truncateError(), ADR-0003

### Community 240 - "numbering.ts"
Cohesion: 0.25
Nodes (4): DEFAULT_FORMATS, NumberFormat, SEQUENCE_KINDS, SequenceKind

### Community 241 - "src/migrate.ts"
Cohesion: 0.22
Nodes (8): config, pool, loadMigrations(), MigrateOptions, MigrateResult, MigrationFile, MIGRATIONS_DIR, runMigrations()

### Community 243 - "reset.ts"
Cohesion: 0.24
Nodes (8): assertLocalDatabase(), DatabaseTarget, describeTarget(), LOCAL_HOSTS, config, databaseName, pool, url

### Community 244 - "repair-project-totals.ts"
Cohesion: 0.22
Nodes (6): config, dryRun, operator, projectId, reason, uow

### Community 245 - "chain.ts"
Cohesion: 0.36
Nodes (8): AuditEventInput, canonicalEventBody(), ChainedAuditEvent, chainEvents(), ChainVerificationResult, computeEventHash(), verifyChain(), verifyChainFrom()

### Community 246 - "describe-error.ts"
Cohesion: 0.39
Nodes (7): collectCodes(), collectMessages(), DescribedError, describeError(), formatCliError(), NodeError, redactUrl()

### Community 247 - "repositories/index.ts"
Cohesion: 0.06
Nodes (26): CreateDatabaseOptions, createPool(), createUnitOfWork(), PgError, sslConfig(), beginIdempotent(), hashRequest(), IdempotencyBeginResult (+18 more)

### Community 249 - "domain/src/index.ts"
Cohesion: 0.13
Nodes (11): assertSignedDatePlausible(), calendarDateIn(), SIGNED_DATE_TOLERANCE_DAYS, SignedDateCheck, Section63Certificate, Section63Input, SECTION_63_AUTHORITY, SECTION_63_SCHEMA_VERSION (+3 more)

## Ambiguous Edges - Review These
- `allowBuilds native-dependency allowlist` → `Evidence pack (PDF + manifest)`  [AMBIGUOUS]
  pnpm-workspace.yaml · relation: conceptually_related_to

## Knowledge Gaps
- **1222 isolated node(s):** `printWidth`, `singleQuote`, `trailingComma`, `semi`, `arrowParens` (+1217 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **61 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `allowBuilds native-dependency allowlist` and `Evidence pack (PDF + manifest)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `AppError` connect `contracts/src/index.ts` to `decide.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `toAppError()` connect `plugins/errors.ts` to `decide.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `TransactionContext` connect `TransactionContext` to `Database`, `OrganizationRepository`, `ProjectRepository`, `replay.ts`, `toDate`, `audit.ts`, `jobs.ts`, `CustomerRepository`, `inbound-messages.ts`, `repositories/change-orders.ts`, `repositories/index.ts`, `ChangeOrderRepository`, `repositories/employees.ts`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `printWidth`, `singleQuote`, `trailingComma` to the rest of the system?**
  _1222 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TransactionContext` be split into smaller, more focused modules?**
  _Cohesion score 0.06412583182093164 - nodes in this community are weakly interconnected._
- **Should `LocalObjectStore` be split into smaller, more focused modules?**
  _Cohesion score 0.05010351966873706 - nodes in this community are weakly interconnected._