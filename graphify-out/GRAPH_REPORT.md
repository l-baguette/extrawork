# Graph Report - extrawork  (2026-09-07)

## Corpus Check
- 310 files · ~301,019 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3503 nodes · 5562 edges · 265 communities (222 shown, 43 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 112 edges (avg confidence: 0.75)
- Token cost: 0 input · 438,689 output

## Community Hubs (Navigation)
- Database Core & IDs
- File Storage & Object Store
- Document Repository
- Database Schema Definitions
- Dashboard Pages (Contractor App)
- Resume Bridge Manifest (unrelated capture)
- Resume Bridge Manifest (unrelated capture)
- Resume Bridge Manifest (unrelated capture)
- Resume Bridge Manifest (unrelated capture)
- Approval Repository & Transactions
- Idempotency Handling
- Change & Project Action Pages
- Root package.json Metadata
- Test Harness Context
- Worker Context & PDF Renderer
- Worker Evidence & Export Jobs
- Auth Service Core
- Change Detail & Dashboard UI
- Lint & Dev Tooling Config
- Migration 0001: Core Schema
- Public Approval Contracts
- App Shell Navigation UI
- Audit Writer & Payments Repo
- Change Order Repository
- Change-Order Composer UI
- Employee Service (Application Layer)
- App/Worker Package Dependencies
- API Context & CSRF Plugins
- Public Approval Decision UI
- Canonical JSON (JCS) Engine
- Worker Inbound Message Handling
- Observability: Logging & Metrics
- DB Package Build Config
- Project Contracts (Schemas)
- API/Worker Domain Dependencies
- Design System Documentation
- Change Order API Contracts
- Rate Limiter
- Employee API Contracts
- Approval Link Token Crypto
- Payment Gateway Abstraction
- Change-Order Decision Use Case
- Shared Contract Schemas
- Organization API Contracts
- Migration 0002: Search & Projections
- Audit Chain Verification CLI
- Change Order Validation Rules
- Top-Level App Structure
- Customer Contact API Contracts
- Employee Repository
- Core DB Tables
- Rate Limit Subject Resolution
- S3 File Storage Dependencies
- Send/Reminder Service
- Customer Repository
- WhatsApp Cloud API Integration
- Handoff: Audit & Integrity Migrations
- Line Item Calculation Logic
- Migration 0003: Append-Only Evidence
- Organization Repository
- Phone Number Normalization
- Money / Currency Engine
- TypeScript Compiler Config
- Worker Maintenance Jobs
- Email Delivery Driver
- API App Bootstrap
- OpenAPI Document Generation
- CLAUDE.md Project Guidance
- Project Status & Invariants (Handoff)
- Message Gateway Abstraction
- API TS Build Config
- Project Repository
- Authorization Policy Engine
- Billing Entitlements
- Web App Dependencies
- Evidence PDF Template
- HANDOFF.md Overview Sections
- Hosted Migration Runbook
- OTP & Send Result Types
- Env Config Loading & Safety
- Intake Replies
- Messaging Share
- Api Package
- Workflows Ci
- Docs HANDOFF 2026 08 17
- Docs HANDOFF 2026 08 21
- Repositories Inbound Messages
- Change Orders State Machine
- Jobs Exports
- Runbooks Freeze Organization
- Config Package
- Contracts Package
- Api Files
- Api Reports
- Src Errors
- Approvals Otp
- Reminders Reminders
- Intake Parse Message
- Integrations Package
- Db Package
- CLAUDE
- (app) Layout
- Src Outbox Pump
- CLAUDE
- Runbooks Backup And Restore
- Repositories Request Templates
- Src Otp
- Integrations Package
- Trusted Read Resume 02 Document Text
- Docs Extrawork Product Brief
- Docs HANDOFF 2026 08 17
- Runbooks Data Subject Request
- Src Assurance
- Src Jobs
- Evidence Section63
- Src Gateways
- Application Package
- Src Events
- Cli Harden
- Src Migrate
- Domain Package
- Observability Package
- Runtime Package
- Testkit Package
- Api Package
- Observability Package
- Domain Package
- Api Package
- Routes Change Orders
- Web DESIGN
- Web Package
- Worker Package
- Worker Tsconfig
- Docker Compose
- Migrations 0005 Whatsapp Intake
- Cli Guards
- Src Client
- E2e Fixtures
- Tsconfig.base
- Simulator Simulator Console
- Web Tsconfig
- Src Runner
- Identity Password
- Docs HANDOFF 2026 08 21
- Runbooks Rotate Credentials
- Identity Google Oauth
- Cli Repair Project Totals
- Cli Replay
- Audit Chain
- Web Tsconfig
- Cli Describe Error
- Approvals Assurance
- Numbering Numbering
- Ui Tsconfig
- Integration Intake Service.test
- Routes Projects
- Employees Employee Manager
- Pdf Renderer
- Docs HANDOFF
- Docs HANDOFF
- Runbooks Cross Tenant Disclosure
- Src Context
- Application Tsconfig
- Config Tsconfig
- Contracts Tsconfig
- Db Tsconfig
- Domain Tsconfig
- Files Tsconfig
- Webhooks Signature
- Integrations Tsconfig
- Observability Tsconfig
- Runtime Tsconfig
- Testkit Tsconfig
- Scripts Dev Lan
- Unit Draft Store.test
- Api Package
- Api Tsconfig
- Web Next.config
- Web Package
- Runbooks Replay Events
- Src Container
- .prettierrc
- Scripts Preflight Hosted
- Integration Message Delivery Ledger.test
- Plugins Errors
- Api Tsconfig
- Docs Extrawork Product Brief
- Worker Package
- Runbooks Failed Migration
- Evidence Build
- Approvals Signing
- Testkit Package
- Integration Employee Api.test
- Integration Intake Repositories.test
- Unit Whatsapp Inbound Parse.test
- AGENTS
- Web PRODUCT
- Web Tsconfig
- Unit Canonical.test
- Migrations 0013 Critical Integrity Guards
- Docs Extrawork Product Brief
- Runbooks Replay Events
- Runbooks Revoke Leaked Token
- Scripts Seed Test Account
- Integration Project Scope Api.test
- Integration Versioning And Evidence.test
- Property Invariants.test
- Unit Decided Link Retention.test
- Unit State Machine.test
- Unit Token.test
- Unit Whatsapp Template.test
- Web Next Env.d
- Lib Query Keys
- Docs Extrawork Startup Overview
- README
- Tsconfig.base
- Tsconfig.base
- Scripts Backup
- Scripts Restore
- Scripts Verify Backup
- Integration Idempotency Expiry.test
- Unit Intake Parse.test
- Unit Signing Date.test
- Vitest.workspace
- Web DESIGN
- Community 236
- Runbooks Failed Migration
- Community 243
- Community 245
- Community 250
- Pnpm Workspace
- Pnpm Workspace
- Community 264

## God Nodes (most connected - your core abstractions)
1. `TransactionContext` - 112 edges
2. `Database` - 88 edges
3. `newId()` - 54 edges
4. `RequestContext` - 36 edges
5. `scripts` - 33 edges
6. `IdentityRepository` - 32 edges
7. `ChangeOrderRepository` - 31 edges
8. `organizations` - 29 edges
9. `formatMoney()` - 27 edges
10. `api()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `migrations job (idempotency check)` --semantically_similar_to--> `db service (Postgres 16)`  [INFERRED] [semantically similar]
  .github/workflows/ci.yml → docker-compose.yml
- `Graphify Query Workflow (AGENTS.md)` --semantically_similar_to--> `Graphify Query Workflow (CLAUDE.md)`  [INFERRED] [semantically similar]
  AGENTS.md → CLAUDE.md
- `Money Is Never a Float (ADR-005)` --semantically_similar_to--> `Operating Context (paise, baseline lock)`  [INFERRED] [semantically similar]
  README.md → apps/web/PRODUCT.md
- `End-to-End Workflow` --semantically_similar_to--> `The Core Journey`  [INFERRED] [semantically similar]
  docs/ExtraWork_Product_Brief.md → README.md
- `Business Owner/Administrator (Product Brief)` --semantically_similar_to--> `Business Owner/Administrator Persona`  [INFERRED] [semantically similar]
  docs/ExtraWork_Product_Brief.md → apps/web/PRODUCT.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CI Database Test Gates (integration/security/golden)** — github_workflows_ci_yml_database_job, claude_md_test_integration, claude_md_test_security, claude_md_test_golden [EXTRACTED 1.00]
- **Local Development Stack (db/minio/mailpit under CLAUDE.md commands)** — docker_compose_yml_db_service, docker_compose_yml_minio_service, docker_compose_yml_mailpit_service, claude [INFERRED 0.85]
- **Money, Snapshot, Decision and Evidence Invariants** — claude_md_money_invariant, claude_md_frozen_snapshot_invariant, claude_md_atomic_decisions_invariant, claude_md_append_only_evidence_invariant [EXTRACTED 1.00]
- **Three-Party Usage Model (Owner, Employee, Customer)** — apps_web_product_md_business_owner, docs_extrawork_product_brief_md_field_employee, docs_extrawork_product_brief_md_customer_approver [INFERRED 0.75]
- **Evidence Integrity Mechanisms** — readme_frozen_version, readme_atomic_idempotent_decisions, readme_append_only_evidence, readme_transactional_outbox [EXTRACTED 0.90]
- **Reinforcement Schedule Design Language** — apps_web_design_md_colour_system, apps_web_design_md_typography, apps_web_design_md_coded_states [EXTRACTED 0.85]
- **WhatsApp Intake Pipeline** — docs_handoff_md_whatsapp_intake_flow, docs_handoff_md_intake_parser, docs_handoff_md_intake_match, docs_handoff_md_intake_service, docs_handoff_md_migration_0005_whatsapp_intake [EXTRACTED 0.90]
- **Assurance Level Framework (A0/A1/A2)** — docs_handoff_md_assurance_a0, docs_handoff_md_assurance_a1, docs_handoff_md_assurance_a2, docs_handoff_md_assurance_copy_file [EXTRACTED 0.90]
- **Critical Remediation Migrations** — docs_handoff_2026_08_21_md_migration_0013_critical_integrity_guards, docs_handoff_2026_08_21_md_migration_0014_remove_repair_bypass, docs_handoff_2026_08_21_md_migration_0015_provider_message_identity, docs_handoff_2026_08_21_md_audit_remediation [EXTRACTED 0.90]
- **Employee WhatsApp Intake Flow** — docs_handoff_2026_08_17_md_employee_whatsapp_simulator, docs_handoff_2026_08_17_md_employee_message_parser, docs_handoff_2026_08_17_md_apps_worker [EXTRACTED 1.00]
- **Meta WhatsApp Production Readiness** — docs_handoff_2026_08_17_md_cloud_api_implementation_gap, docs_handoff_2026_08_17_md_engineering_required_steps, docs_handoff_2026_08_17_md_production_meta_assets_steps, docs_handoff_2026_08_17_md_waba_ownership_decision [INFERRED 0.85]
- **Hosted Infrastructure Migration** — docs_handoff_2026_08_17_md_supabase_postgresql, docs_handoff_2026_08_17_md_cloudflare_r2, docs_handoff_2026_08_17_md_public_deployment [INFERRED 0.80]
- **Resume Document Revision History** — bridge_trusted_read_resume_document_text_headstart_template, bridge_trusted_read_resume_02_document_text_vedant_resume_v1, bridge_trusted_read_resume_03_document_text_vedant_resume_v2, bridge_trusted_read_resume_04_document_text_vedant_resume_v3 [EXTRACTED 1.00]
- **Evidence Integrity Verification Workflow** — infra_runbooks_readme_index, infra_runbooks_restore_database_index, infra_runbooks_repair_project_totals_index, infra_runbooks_backup_and_restore_index [INFERRED 0.85]
- **Secret Rotation Overlap Pattern** — infra_runbooks_rotate_credentials_whatsapp_app_secret, infra_runbooks_rotate_credentials_razorpay_webhook_secret, infra_runbooks_rotate_credentials_session_secret, infra_runbooks_rotate_credentials_overlap_rationale [EXTRACTED 1.00]

## Communities (265 total, 43 thin omitted)

### Community 0 - "Database Core & IDs"
Cohesion: 0.04
Nodes (58): ORG_SCOPE_UUID, schema, AttachmentRow, ChangeOrderRecord, ChangeOrderRow, ChangeOrderSummaryRecord, ChangeOrderSummaryRow, LineItemRow (+50 more)

### Community 1 - "File Storage & Object Store"
Cohesion: 0.05
Nodes (24): LocalObjectStore, LocalSignaturePayload, LocalStoreOptions, assertSafeKey(), ObjectMetadata, ObjectStore, PresignedUpload, StorageKeys (+16 more)

### Community 2 - "Document Repository"
Cohesion: 0.05
Nodes (12): Database, DocumentRepository, mapDelivery(), mapDocument(), MessageRepository, WebhookInboxRepository, FILE_COLUMNS, FileObjectRow (+4 more)

### Community 3 - "Database Schema Definitions"
Cohesion: 0.04
Nodes (52): actorType, approvalTokens, assuranceLevel, auditEvents, authChallenges, baselineVersions, bigintNumeric, bytea (+44 more)

### Community 4 - "Dashboard Pages (Contractor App)"
Cohesion: 0.10
Nodes (28): dynamic, dynamic, dynamic, dynamic, dynamic, dynamic, dynamic, OUTCOMES (+20 more)

### Community 5 - "Resume Bridge Manifest (unrelated capture)"
Cohesion: 0.04
Nodes (46): bridgeVersion, bytes, path, sha256, controlAwareness, affectedParagraphCount, authoritativeDropdownCount, hasProtectedControls (+38 more)

### Community 6 - "Resume Bridge Manifest (unrelated capture)"
Cohesion: 0.04
Nodes (46): bridgeVersion, bytes, path, sha256, controlAwareness, affectedParagraphCount, authoritativeDropdownCount, hasProtectedControls (+38 more)

### Community 7 - "Resume Bridge Manifest (unrelated capture)"
Cohesion: 0.04
Nodes (46): bridgeVersion, bytes, path, sha256, controlAwareness, affectedParagraphCount, authoritativeDropdownCount, hasProtectedControls (+38 more)

### Community 8 - "Resume Bridge Manifest (unrelated capture)"
Cohesion: 0.04
Nodes (46): bridgeVersion, bytes, path, sha256, controlAwareness, affectedParagraphCount, authoritativeDropdownCount, hasProtectedControls (+38 more)

### Community 9 - "Approval Repository & Transactions"
Cohesion: 0.07
Nodes (6): TransactionContext, ApprovalRepository, mapDecision(), mapToken(), IdentityRepository, mapUser()

### Community 10 - "Idempotency Handling"
Cohesion: 0.06
Nodes (28): beginIdempotent(), hashRequest(), IdempotencyBeginResult, newId(), OutboxEventInput, OutboxRow, publishOutbox(), replayOutboxEvent() (+20 more)

### Community 11 - "Change & Project Action Pages"
Cohesion: 0.09
Nodes (25): ChangeActions(), RemindResult, ProjectTeam(), NewProjectPage(), projectFormError(), BusinessForm(), RETENTION, TIMEZONES (+17 more)

### Community 12 - "Root package.json Metadata"
Cohesion: 0.05
Nodes (40): description, engines, node, name, packageManager, private, scripts, build (+32 more)

### Community 13 - "Test Harness Context"
Cohesion: 0.08
Nodes (27): actorContext(), ActorSpec, publicContext(), createTestContainer(), ensureMigrated(), PRESERVED_TABLES, TEST_DATABASE_URL, TestContainerOptions (+19 more)

### Community 14 - "Worker Context & PDF Renderer"
Cohesion: 0.09
Nodes (9): workerContext, PdfRenderer, UnavailablePdfRenderer, pdfStub, pdfStub, pdfStub, pdfStub, pdfStub (+1 more)

### Community 15 - "Worker Evidence & Export Jobs"
Cohesion: 0.16
Nodes (26): EVIDENCE_GENERATOR_VERSION, generateEvidence(), truncate(), parseExportPayload(), scanFile(), deliveryErrorCode(), firstName(), notifyTeamDecision() (+18 more)

### Community 16 - "Auth Service Core"
Cohesion: 0.08
Nodes (11): AuthenticatedIdentity, AuthProvider, AuthService, signInUrl(), displayNameFromEmail(), Jwk, localAuthSubject(), LocalMagicLinkOptions (+3 more)

### Community 17 - "Change Detail & Dashboard UI"
Cohesion: 0.14
Nodes (28): ChangePage(), dynamic, EventsResponse, DashboardPage(), formatDecisionTime(), buildContractHtml(), Change, DownloadContract() (+20 more)

### Community 18 - "Lint & Dev Tooling Config"
Cohesion: 0.06
Nodes (33): eslint, @eslint/js, eslint-plugin-react-hooks, @extrawork/api, @extrawork/testkit, fast-check, @next/eslint-plugin-next, devDependencies (+25 more)

### Community 19 - "Migration 0001: Core Schema"
Cohesion: 0.12
Nodes (31): approval_tokens, audit_events, change_orders, data_subject_requests, decisions, document_sequences, entitlement_counters, file_objects (+23 more)

### Community 20 - "Public Approval Contracts"
Cohesion: 0.07
Nodes (28): DecisionInput, DecisionInputSchema, DecisionReceiptDto, DecisionReceiptSchema, OtpChallengeSchema, OtpRequestSchema, OtpVerifyResultSchema, OtpVerifySchema (+20 more)

### Community 21 - "App Shell Navigation UI"
Cohesion: 0.10
Nodes (22): AccountMenu(), NAV, NAV_MANAGE, NAV_SYSTEM, IconBuilding(), IconChevron(), IconClose(), IconCustomers() (+14 more)

### Community 22 - "Audit Writer & Payments Repo"
Cohesion: 0.09
Nodes (12): AuditWriter, Repositories, mapPaymentIntent(), PaymentIntentRecord, PaymentIntentRow, PaymentIntentStatus, PaymentRepository, DashboardData (+4 more)

### Community 23 - "Change Order Repository"
Cohesion: 0.12
Nodes (3): ChangeOrderRepository, mapChangeOrder(), mapVersion()

### Community 24 - "Change-Order Composer UI"
Cohesion: 0.13
Nodes (23): Composer(), estimateLine(), Props, toApiPayload(), ADR-0005, zodResolver(), DraftState, persist() (+15 more)

### Community 25 - "Employee Service (Application Layer)"
Cohesion: 0.11
Nodes (6): RequestContext, decodeInboundCursor(), EmployeeService, encodeInboundCursor(), FileService, ProjectService

### Community 26 - "App/Worker Package Dependencies"
Cohesion: 0.08
Nodes (28): @extrawork/application, @extrawork/db, @extrawork/runtime, dependencies, @extrawork/application, @extrawork/config, @extrawork/db, @extrawork/observability (+20 more)

### Community 27 - "API Context & CSRF Plugins"
Cohesion: 0.09
Nodes (22): clientIp(), contextPlugin(), ContextPluginOptions, CSRF_COOKIE, fastify, FastifyInstance, FastifyRequest, headerOrganizationId() (+14 more)

### Community 28 - "Public Approval Decision UI"
Cohesion: 0.10
Nodes (23): DecisionPanel(), messageFor(), Props, Receipt(), satisfies(), Stage, Challenge, OtpStep() (+15 more)

### Community 29 - "Canonical JSON (JCS) Engine"
Cohesion: 0.11
Nodes (20): canonicalBytes(), CanonicalizationError, canonicalize(), CANONICALIZER_VERSION, ESCAPES, JsonValue, serializeNumber(), serializeString() (+12 more)

### Community 30 - "Worker Inbound Message Handling"
Cohesion: 0.11
Nodes (20): extensionFor(), handleInboundMessage(), sendReply(), storeInboundMedia(), toInboundMessageEvent(), applyMessageStatus(), looksLikeInboundMessage(), mapMessageStatuses() (+12 more)

### Community 31 - "Observability: Logging & Metrics"
Cohesion: 0.11
Nodes (11): createLogger(), LoggerContext, labelKey(), Labels, METRIC, metrics, MetricsRegistry, Series (+3 more)

### Community 32 - "DB Package Build Config"
Cohesion: 0.08
Nodes (25): drizzle-kit, devDependencies, drizzle-kit, @types/pg, exports, ./schema, main, name (+17 more)

### Community 33 - "Project Contracts (Schemas)"
Cohesion: 0.08
Nodes (25): ChangeOrderSummarySchema, AddressDto, AddressSchema, BaselineAmendmentInput, BaselineAmendmentSchema, BaselineInput, BaselineInputSchema, ChangeRegisterDto (+17 more)

### Community 34 - "API/Worker Domain Dependencies"
Cohesion: 0.09
Nodes (25): @extrawork/domain, @extrawork/files, @extrawork/integrations, @extrawork/domain, @extrawork/files, @extrawork/integrations, @extrawork/domain, @extrawork/files (+17 more)

### Community 35 - "Design System Documentation"
Cohesion: 0.08
Nodes (24): Design Accessibility Requirements, Design Scope Boundaries (/r/*, /sign-in, /register, /simulator excluded), Coded Status States (A/W/D/N), Ink/Paper Colour System, Schedule/Figures/Panel Components, Rail + Sheet Layout Shell, Reinforcement Schedule Design Metaphor, Three Governing Rules (Rules Not Shadows, Colour As Code, Square Cells) (+16 more)

### Community 36 - "Change Order API Contracts"
Cohesion: 0.08
Nodes (23): CancelChangeOrderSchema, ChangeOrderEventsDto, ChangeOrderEventsSchema, ChangeOrderVersionListSchema, CreateChangeOrderInput, CreateChangeOrderSchema, CreateRevisionSchema, EvidenceDocumentDto (+15 more)

### Community 37 - "Rate Limiter"
Cohesion: 0.13
Nodes (10): InMemoryRateLimiter, LocalReadRateLimiter, PostgresRateLimiter, RATE_LIMITS, RateLimiter, RateLimitName, RateLimitResult, RateLimitRule (+2 more)

### Community 38 - "Employee API Contracts"
Cohesion: 0.08
Nodes (23): CreateEmployeeInput, CreateEmployeeSchema, EmployeeDto, EmployeeListSchema, EmployeeSchema, EmployeeStatus, EmployeeStatusSchema, InboundMessageDto (+15 more)

### Community 39 - "Approval Link Token Crypto"
Cohesion: 0.11
Nodes (15): approvalLinkAad(), ApprovalLinkCipherContext, approvalLinkKey(), assertApprovalLinkSecret(), DECIDED_LINK_RETENTION_DAYS, decryptApprovalUrl(), encryptApprovalUrl(), generateApprovalToken() (+7 more)

### Community 40 - "Payment Gateway Abstraction"
Cohesion: 0.12
Nodes (14): CreatePaymentCommand, DisabledPaymentGateway, InboundMediaRef, InboundMessageEvent, OutboundTemplate, PaymentGateway, PaymentOrderRef, mapPaymentStatus() (+6 more)

### Community 41 - "Change-Order Decision Use Case"
Cohesion: 0.13
Nodes (12): DecideCommand, DecisionReceipt, DecisionService, DECLARATIONS, OtpService, PublicApprovalService, ResolvedPublicRequest, summariseAddress() (+4 more)

### Community 42 - "Shared Contract Schemas"
Cohesion: 0.09
Nodes (22): ApproverSchema, AttachmentDto, AttachmentSchema, AuditEventDto, AuditEventSchema, ChangeOrderDto, ChangeOrderSchema, ChangeOrderSummaryDto (+14 more)

### Community 43 - "Organization API Contracts"
Cohesion: 0.09
Nodes (22): CreateOrganizationInput, CreateOrganizationSchema, CurrentUserDto, CurrentUserSchema, EntitlementsDto, EntitlementsSchema, GstinSchema, InviteMembershipInput (+14 more)

### Community 44 - "Migration 0002: Search & Projections"
Cohesion: 0.14
Nodes (20): change_order_versions_touch, change_orders_search_trigger(), change_orders_search_update, change_orders_touch, contacts_touch, customers_search_trigger(), customers_search_update, customers_touch (+12 more)

### Community 45 - "Audit Chain Verification CLI"
Cohesion: 0.13
Nodes (17): asJson, config, Failure, uow, CreateDatabaseOptions, createPool(), createUnitOfWork(), PgError (+9 more)

### Community 46 - "Change Order Validation Rules"
Cohesion: 0.13
Nodes (16): Blocker, DraftValidationInput, DraftValidationResult, validateDraft(), parseQuantity(), roundHalfUpToBigint(), calculateLine(), calculateRevisedContractTotal() (+8 more)

### Community 47 - "Top-Level App Structure"
Cohesion: 0.13
Nodes (22): apps/api, apps/web, apps/worker, Authentication, Baseline Commit 0110419, Cloudflare R2, ExtraWork, Google OAuth Sign-in (+14 more)

### Community 48 - "Customer Contact API Contracts"
Cohesion: 0.09
Nodes (21): ContactDto, ContactInput, ContactInputSchema, ContactSchema, CreateCustomerInput, CreateCustomerSchema, CustomerDto, CustomerSchema (+13 more)

### Community 49 - "Employee Repository"
Cohesion: 0.15
Nodes (10): EMPLOYEE_COLUMNS, EMPLOYEE_WITH_ASSIGNMENTS_COLUMNS, EmployeeRecord, EmployeeRepository, EmployeeRow, EmployeeStatus, EmployeeWithAssignments, mapEmployee() (+2 more)

### Community 50 - "Core DB Tables"
Cohesion: 0.16
Nodes (21): approval_tokens, audit_events, baseline_versions, generated_documents, legal_holds, line_items, message_events, otp_challenges (+13 more)

### Community 51 - "Rate Limit Subject Resolution"
Cohesion: 0.20
Nodes (16): authenticatedSubject(), hashForBucket(), isAuthenticatedLimit(), publicTokenSubject(), rateLimit(), RateLimitOptions, decorate(), IdParams (+8 more)

### Community 52 - "S3 File Storage Dependencies"
Cohesion: 0.10
Nodes (20): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @extrawork/config, @extrawork/contracts, @extrawork/observability (+12 more)

### Community 53 - "Send/Reminder Service"
Cohesion: 0.15
Nodes (8): firstName(), SendService, describe(), InboundWhatsAppMessage, IntakeOutcome, IntakeService, titleFrom(), validate()

### Community 54 - "Customer Repository"
Cohesion: 0.15
Nodes (3): CustomerRepository, mapContact(), mapCustomer()

### Community 55 - "WhatsApp Cloud API Integration"
Cohesion: 0.13
Nodes (15): FetchedMedia, buildCloudApiPayload(), mapDeliveryStatus(), MetaInboundMessage, MetaMediaObject, MetaWebhookPayload, normalizeInboundMessage(), parseMetaInboundMessage() (+7 more)

### Community 56 - "Handoff: Audit & Integrity Migrations"
Cohesion: 0.13
Nodes (17): Severity-Ranked Audit and Remediation, Migration 0013 Critical Integrity Guards, Migration 0014 Remove Repair Bypass, Migration 0015 Provider Message Identity, Remediation Final Verify (535/535), Uncommitted Remediation Worktree, Assurance Level A0, Assurance Level A1 (+9 more)

### Community 57 - "Line Item Calculation Logic"
Cohesion: 0.16
Nodes (7): buildLineItemWrites(), toCalcInputs(), ADR-0005, versionEtag(), ChangeOrderService, CreateChangeOrderHooks, ADR-0005

### Community 58 - "Migration 0003: Append-Only Evidence"
Cohesion: 0.15
Nodes (17): change_order_versions, audit_events_append_only(), audit_events_no_delete, audit_events_no_update, baseline_versions_append_only(), baseline_versions_no_update, decisions_append_only(), decisions_no_delete (+9 more)

### Community 60 - "Phone Number Normalization"
Cohesion: 0.15
Nodes (17): DEFAULT_COUNTRY, DuplicateSignal, maskedContactLabel(), maskEmail(), maskPhone(), normalizeEmail(), normalizeForSearch(), normalizePhone() (+9 more)

### Community 61 - "Money / Currency Engine"
Cohesion: 0.15
Nodes (7): assertInt64(), currencySymbol(), MINOR_UNITS, minorUnitScale(), Money, normalizeCurrency(), toIntegerBigint()

### Community 62 - "TypeScript Compiler Config"
Cohesion: 0.10
Nodes (20): compilerOptions, allowSyntheticDefaultImports, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules (+12 more)

### Community 63 - "Worker Maintenance Jobs"
Cohesion: 0.16
Nodes (16): applyRetention(), checkProjectIntegrity(), enqueueDueReminders(), expireRequests(), scheduleRecurringJobs(), container, ctx, handlers (+8 more)

### Community 64 - "Email Delivery Driver"
Cohesion: 0.14
Nodes (8): RFC-822, ConsoleEmailDriver, EmailDriver, EmailGateway, EmailMessage, emailMessageId(), FileEmailDriver, SmtpEmailDriver

### Community 65 - "API App Bootstrap"
Cohesion: 0.20
Nodes (11): buildApp(), BuildAppOptions, ipSubject(), registerAuthRoutes(), registerHealthRoutes(), registerPublicRoutes(), InboundSchema, registerSimulatorRoutes() (+3 more)

### Community 66 - "OpenAPI Document Generation"
Cohesion: 0.18
Nodes (15): buildOpenApiDocument(), commonErrors, componentSchemas, errorResponse(), idempotencyHeader, ifMatchHeader, jsonBody(), JsonObject (+7 more)

### Community 67 - "CLAUDE.md Project Guidance"
Cohesion: 0.14
Nodes (17): graphify, Evidence is append-only, Boot-time config/secret validation, pnpm db:harden, pnpm db:repair, ExtraWork product concept, docs/HANDOFF*.md handoffs, docs/IMPLEMENTATION_PLAN.md (+9 more)

### Community 68 - "Project Status & Invariants (Handoff)"
Cohesion: 0.14
Nodes (18): Current Stage (535/535 Tests, 4 Launch Blockers), Validated vs Hypothesis Assessment, Decisions Atomic and Idempotent, Evidence Is Append-Only, Sent Version Is Frozen, Money Never a Float, No Provider Call Inside a Transaction, Tenant Scoping Mandatory (+10 more)

### Community 69 - "Message Gateway Abstraction"
Cohesion: 0.16
Nodes (7): MessageGateway, OutboundMessage, ProviderEvent, NativeShareWhatsAppGateway, SimulatedOutboundRecord, SimulatorOptions, SimulatorWhatsAppGateway

### Community 70 - "API TS Build Config"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, declarationMap, module, moduleResolution, noEmit, extends, ./tsconfig.json (+7 more)

### Community 72 - "Authorization Policy Engine"
Cohesion: 0.15
Nodes (12): Action, ACTIONS, Actor, authorize(), hasProjectAccess(), isAllowed(), ORG_WIDE_ROLES, READ_ONLY_SAFE_ACTIONS (+4 more)

### Community 73 - "Billing Entitlements"
Cohesion: 0.13
Nodes (12): assertQuota(), checkQuota(), Entitlements, FeatureKey, PlanCode, PLANS, QuotaCheck, QuotaKey (+4 more)

### Community 74 - "Web App Dependencies"
Cohesion: 0.12
Nodes (16): dependencies, @extrawork/contracts, next, react, react-dom, react-hook-form, @tanstack/react-query, zod (+8 more)

### Community 75 - "Evidence PDF Template"
Cohesion: 0.18
Nodes (8): digest(), extractElementContents(), ProjectEvidencePackViewModel, renderEvidenceHtml(), renderProjectEvidencePackHtml(), approvedFixture(), clock, today()

### Community 76 - "HANDOFF.md Overview Sections"
Cohesion: 0.12
Nodes (16): 10. Test inventory, 11. Open questions for the founder, 1. What the product is, 2. Current status in one table, 3. How to get running (5 minutes), 4. Architecture, 5. The product pivot (this is the important part), 7. What was built for the pivot (this session) (+8 more)

### Community 77 - "Hosted Migration Runbook"
Cohesion: 0.12
Nodes (15): 1. Supabase, 2. Cloudflare R2, 3. Put the values in `.env` yourself, 4. Run the migration, 5. Verify, Before you start, Cloudflare R2 object storage target, Gotchas found doing this for real (+7 more)

### Community 78 - "OTP & Send Result Types"
Cohesion: 0.30
Nodes (6): OtpChallengeResult, SendResult, AppContext, systemClock, createAuthProvider(), createServices()

### Community 79 - "Env Config Loading & Safety"
Cohesion: 0.16
Nodes (12): loadEnvFile(), anchorLocalPaths(), assertProductionSafe(), booleanish, config(), ConfigError, csv, DEVELOPMENT_PLACEHOLDERS (+4 more)

### Community 80 - "Intake Replies"
Cohesion: 0.15
Nodes (11): IntakeField, ParsedIntake, decisionReply(), describeUnderstood(), FIELD_EXAMPLES, FIELD_LABEL, FORMAT_HINT, incompleteReply() (+3 more)

### Community 81 - "Messaging Share"
Cohesion: 0.23
Nodes (11): buildDecisionReceiptMessage(), buildDecisionReceiptTemplateParameters(), buildReminderMessage(), buildReminderTemplateParameters(), buildRequestMessage(), buildRequestTemplateParameters(), DecisionReceiptMessageInput, formatLocalDate() (+3 more)

### Community 82 - "Api Package"
Cohesion: 0.13
Nodes (15): dependencies, fastify, @fastify/cookie, @fastify/cors, @fastify/helmet, fastify-plugin, zod, zod-to-json-schema (+7 more)

### Community 83 - "Workflows Ci"
Cohesion: 0.15
Nodes (15): Decisions are atomic and idempotent, pnpm db:migrate, pnpm openapi, pnpm test:e2e, pnpm test:golden, pnpm test:security, CI Pipeline (ci.yml), build job (web/api/worker + OpenAPI drift) (+7 more)

### Community 84 - "Docs HANDOFF 2026 08 17"
Cohesion: 0.16
Nodes (15): Agreed Product Sequence, Customer Approval Page, Customer Request Message Copy, Employee Message Parser, Employee WhatsApp Simulator, packages/application, packages/domain, Pilot Acceptance Test (+7 more)

### Community 85 - "Docs HANDOFF 2026 08 21"
Cohesion: 0.15
Nodes (15): apps/api, apps/worker, Customer WhatsApp Transcript PDF (Missing), packages/application, packages/domain, packages/files, packages/integrations, packages/runtime (+7 more)

### Community 87 - "Change Orders State Machine"
Cohesion: 0.13
Nodes (6): OPEN_STATUSES, STATUS_LABEL, TERMINAL_STATUSES, TRANSITIONS, VERSION_ACTIONS, VersionAction

### Community 88 - "Jobs Exports"
Cohesion: 0.19
Nodes (12): csvCell(), EXPORT_TEMPLATE_VERSION, ExportPayload, generateAccountingCsv(), GeneratedExport, generateExport(), generateProjectEvidencePack(), HEADERS (+4 more)

### Community 89 - "Runbooks Freeze Organization"
Cohesion: 0.15
Nodes (14): Blast Radius Determination, DPDP Data Fiduciary Notification, Bulk Token Revocation on Account Compromise, Freeze One Organization Runbook, Live Approval Tokens Survive a Freeze, ORGANIZATION_SUSPENDED Status, Reads and Exports Preserved During Freeze, Single-Tenant Blast Radius Check (+6 more)

### Community 90 - "Config Package"
Cohesion: 0.14
Nodes (13): dependencies, zod, exports, zod, main, name, private, scripts (+5 more)

### Community 91 - "Contracts Package"
Cohesion: 0.14
Nodes (13): dependencies, zod, exports, zod, main, name, private, scripts (+5 more)

### Community 92 - "Api Files"
Cohesion: 0.14
Nodes (13): ALLOWED_UPLOAD_MIME_TYPES, AllowedMimeType, CompleteUploadSchema, CreateUploadInput, CreateUploadSchema, FileObjectDto, FileObjectSchema, MAX_FILE_BYTES (+5 more)

### Community 93 - "Api Reports"
Cohesion: 0.14
Nodes (13): ApprovedChangeExport, ApprovedChangeExportSchema, CreateEvidencePackSchema, ExportJobDto, ExportJobSchema, ExtraWorkReportDto, ExtraWorkReportRow, ExtraWorkReportRowSchema (+5 more)

### Community 94 - "Src Errors"
Cohesion: 0.16
Nodes (9): AppError, ERROR_CODES, ERROR_MESSAGES, ErrorCode, ErrorEnvelope, foldLatinAccents(), HONORIFICS, signerNameMatches() (+1 more)

### Community 95 - "Approvals Otp"
Cohesion: 0.16
Nodes (12): GeneratedOtp, generateOtp(), hashOtp(), OTP_DAILY_LIMIT, OTP_DIGITS, OTP_RESEND_COOLDOWN_SECONDS, OTP_WINDOW_LIMIT, OTP_WINDOW_MINUTES (+4 more)

### Community 96 - "Reminders Reminders"
Cohesion: 0.19
Nodes (13): isOpenForDecision(), buildReminderSchedule(), DEFAULT_REMINDER_POLICY, localHourIn(), nextLocalWindow(), ReminderChannel, ReminderContext, ReminderDecision (+5 more)

### Community 97 - "Intake Parse Message"
Cohesion: 0.24
Nodes (12): EMPTY, IntakeValidation, LABELS, looksLikeAmount(), looksLikeDays(), normalizeLabel(), parseAmountToMinor(), parseCommaSeparated() (+4 more)

### Community 98 - "Integrations Package"
Cohesion: 0.14
Nodes (13): devDependencies, @types/nodemailer, exports, main, name, private, scripts, build (+5 more)

### Community 99 - "Db Package"
Cohesion: 0.15
Nodes (13): drizzle-orm, drizzle-orm, drizzle-orm, dependencies, drizzle-orm, @extrawork/config, @extrawork/contracts, @extrawork/domain (+5 more)

### Community 100 - "CLAUDE"
Cohesion: 0.15
Nodes (13): Customer Persona, packages/contracts, packages/integrations, WhatsApp delivery is manual/deferred, Customer / Authorized Approver (Product Brief), MVP Scope, End-to-End Workflow, Business Model / Pricing Plans (+5 more)

### Community 101 - "(app) Layout"
Cohesion: 0.21
Nodes (8): MeResponse, AppShell(), ShellUser, OfflineBanner(), useOnlineStatus(), archivo, splineMono, Providers()

### Community 102 - "Src Outbox Pump"
Cohesion: 0.22
Nodes (5): delay(), EnqueueInput, jobsFor(), OutboxPump, ADR-0003

### Community 103 - "CLAUDE"
Cohesion: 0.23
Nodes (13): apps/api, apps/web, apps/worker, Lint-enforced dependency direction, Sent version is frozen, Modular monolith architecture, Money is never a float, packages/application (+5 more)

### Community 104 - "Runbooks Backup And Restore"
Cohesion: 0.19
Nodes (13): Evidence PDFs regenerable, uploaded originals are not (rationale), Backups, Health Checks and Restore Rehearsal, Monthly restore rehearsal, scripts/backup.sh, scripts/verify-backup.sh, TEST_DATABASE_URL must never fall back to DATABASE_URL (rationale), Repair Incorrect Project Totals, INTEGRITY_REVIEW project status (+5 more)

### Community 105 - "Repositories Request Templates"
Cohesion: 0.23
Nodes (6): mapTemplate(), RequestTemplateRepository, RequestTemplateRow, TEMPLATE_COLUMNS, TemplateRecord, TemplateSnapshot

### Community 106 - "Src Otp"
Cohesion: 0.27
Nodes (6): OtpDeliveryCommand, OtpGateway, ProviderMessageRef, ConsoleOtpGateway, MessageGatewayOtpGateway, UnavailableOtpGateway

### Community 107 - "Integrations Package"
Cohesion: 0.17
Nodes (12): @extrawork/observability, @extrawork/observability, @extrawork/observability, dependencies, @extrawork/config, @extrawork/contracts, @extrawork/domain, @extrawork/observability (+4 more)

### Community 108 - "Trusted Read Resume 02 Document Text"
Cohesion: 0.27
Nodes (12): Council for Financial Education (COO role), Institute of Economic & Financial Policy (VP Research & Operations), NYU Stern School of Business (Education entry), Statistical Arbitrage Model project, University of Alabama Research Assistant role, Vedant Sacheendran Resume (Revision 1), Austin Public Library Teen Volunteer / FLL Robotics Program, Vedant Sacheendran Resume (Revision 2) (+4 more)

### Community 109 - "Docs Extrawork Product Brief"
Cohesion: 0.17
Nodes (11): Business owner or administrator, Core product value, Customer or authorized approver, End-to-end workflow, ExtraWork — Product Brief, Field employee, Later expansion, MVP scope (+3 more)

### Community 110 - "Docs HANDOFF 2026 08 17"
Cohesion: 0.20
Nodes (12): Real WhatsApp Implementation Gap, Engineering Required Before Real WhatsApp, extra_work_decision_receipt_v1 Template, extra_work_reminder_v1 Template, extra_work_request_v1 Template, Meta Messaging Cost Expectation, Meta WhatsApp Cloud API, Open Decisions and Risks (+4 more)

### Community 111 - "Runbooks Data Subject Request"
Cohesion: 0.18
Nodes (12): erase-contact.ts CLI, Erasure reconciled against contractual evidence requirements (rationale), export-subject.ts CLI, Handle a Data Access, Export or Deletion Request, legal_holds table / legal hold mechanism, Migration Checksum Guard, Operational Runbooks Index, Never edit evidence by hand (triggers + role privileges) (+4 more)

### Community 112 - "Src Assurance"
Cohesion: 0.18
Nodes (9): APPROVAL_DECLARATION, ASSURANCE_COPY, assuranceCopy, DECLINE_DECLARATION, EVIDENCE_DISCLAIMER, RANK, REVISION_DECLARATION, TERMS_VERSION (+1 more)

### Community 113 - "Src Jobs"
Cohesion: 0.18
Nodes (7): enqueueJob(), EnqueueJobInput, failJob(), JobRow, QueueDepth, truncateError(), ADR-0003

### Community 114 - "Evidence Section63"
Cohesion: 0.18
Nodes (7): Section63Certificate, Section63Input, SECTION_63_AUTHORITY, SECTION_63_SCHEMA_VERSION, assertAllSameTenant(), assertSameTenant(), TenantContext

### Community 115 - "Src Gateways"
Cohesion: 0.24
Nodes (7): ESignGateway, UnavailableESignGateway, createEmailDriver(), createIntegrations(), createOtpGateway(), createWhatsAppGateway(), Integrations

### Community 116 - "Application Package"
Cohesion: 0.18
Nodes (10): exports, main, name, private, scripts, build, typecheck, type (+2 more)

### Community 117 - "Src Events"
Cohesion: 0.18
Nodes (9): DOMAIN_EVENTS, DomainEventType, JOB_KINDS, JOB_PRIORITY, JobKind, MAX_JOB_ATTEMPTS, OUTBOX_TOPICS, OutboxTopic (+1 more)

### Community 118 - "Cli Harden"
Cohesion: 0.18
Nodes (6): APPEND_ONLY_TABLES, config, dryRun, FROZEN_TABLES, pool, statements

### Community 119 - "Src Migrate"
Cohesion: 0.22
Nodes (8): config, pool, loadMigrations(), MigrateOptions, MigrateResult, MigrationFile, MIGRATIONS_DIR, runMigrations()

### Community 120 - "Domain Package"
Cohesion: 0.18
Nodes (10): exports, main, name, private, scripts, build, typecheck, type (+2 more)

### Community 121 - "Observability Package"
Cohesion: 0.18
Nodes (10): exports, main, name, private, scripts, build, typecheck, type (+2 more)

### Community 122 - "Runtime Package"
Cohesion: 0.18
Nodes (10): exports, main, name, private, scripts, build, typecheck, type (+2 more)

### Community 123 - "Testkit Package"
Cohesion: 0.18
Nodes (10): main, name, private, scripts, build, seed, typecheck, type (+2 more)

### Community 124 - "Api Package"
Cohesion: 0.20
Nodes (9): default, development, exports, ./app, main, name, private, type (+1 more)

### Community 125 - "Observability Package"
Cohesion: 0.20
Nodes (10): @extrawork/config, @extrawork/config, @extrawork/config, @extrawork/config, dependencies, @extrawork/config, pino, pino-pretty (+2 more)

### Community 126 - "Domain Package"
Cohesion: 0.20
Nodes (10): @extrawork/contracts, @extrawork/contracts, decimal.js, libphonenumber-js, @extrawork/contracts, @extrawork/contracts, dependencies, decimal.js (+2 more)

### Community 127 - "Api Package"
Cohesion: 0.20
Nodes (10): devDependencies, tsx, typescript, tsx, typescript, typescript, devDependencies, tsx (+2 more)

### Community 128 - "Routes Change Orders"
Cohesion: 0.31
Nodes (8): IdParams, ProjectIdParams, registerChangeOrderRoutes(), summariseEvent(), IdParams, parseLockVersion(), registerCustomerRoutes(), summaryDto()

### Community 129 - "Web DESIGN"
Cohesion: 0.20
Nodes (9): Accessibility, Boundaries, Colour, Components, Design, Layout, Motion, The world (+1 more)

### Community 130 - "Web Package"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, start, typecheck, type (+1 more)

### Community 131 - "Worker Package"
Cohesion: 0.20
Nodes (9): devDependencies, tsx, typescript, tsx, main, name, private, type (+1 more)

### Community 132 - "Worker Tsconfig"
Cohesion: 0.20
Nodes (9): compilerOptions, noEmit, outDir, rootDir, types, extends, include, node (+1 more)

### Community 133 - "Docker Compose"
Cohesion: 0.33
Nodes (10): docker-compose.yml (local dev stack), api service (profile: app), db service (Postgres 16), Docker-based local dev matches prod topology, mailpit service, minio-init service, minio service, Private bucket + short-lived signed URLs (+2 more)

### Community 134 - "Migrations 0005 Whatsapp Intake"
Cohesion: 0.33
Nodes (8): employee_project_assignments, employees, inbound_messages, request_templates, change_orders, inbound_message_media, file_objects, organizations

### Community 135 - "Cli Guards"
Cohesion: 0.24
Nodes (8): assertLocalDatabase(), DatabaseTarget, describeTarget(), LOCAL_HOSTS, config, databaseName, pool, url

### Community 137 - "E2e Fixtures"
Cohesion: 0.27
Nodes (6): ApprovalLink, HELPER, ROOT, run, Scenario, seedScenario()

### Community 138 - "Tsconfig.base"
Cohesion: 0.22
Nodes (6): metadata, viewport, dist, .next, exclude, $schema

### Community 139 - "Simulator Simulator Console"
Cohesion: 0.25
Nodes (6): dynamic, OutboxRecord, SendResult, SimEmployee, SimulatorConsole(), STATUS_COPY

### Community 140 - "Web Tsconfig"
Cohesion: 0.22
Nodes (8): exclude, extends, include, src/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, src/**/*.tsx

### Community 141 - "Src Runner"
Cohesion: 0.28
Nodes (4): classify(), delay(), JobRunner, truncate()

### Community 142 - "Identity Password"
Cohesion: 0.28
Nodes (6): RFC-7914, hashPassword(), MIN_PASSWORD_LENGTH, OBVIOUS, scrypt(), verifyPassword()

### Community 143 - "Docs HANDOFF 2026 08 21"
Cohesion: 0.25
Nodes (9): apps/web, Migration 0012 Message Delivery Ledger, Next.js Webpack conditionNames Bug, packages/contracts, packages/db, packages/testkit, Supabase Hosted Postgres/Auth, Build Order S1-S10 (+1 more)

### Community 144 - "Runbooks Rotate Credentials"
Cohesion: 0.22
Nodes (9): pnpm db:harden restricted runtime role creation, Two connections: runtime role vs maintenance role, APPROVAL_LINK_ENCRYPTION_SECRET (drain queue before rotating), Rotate Provider and Webhook Credentials, Add/Switch/Observe/Remove rotation order, never reversed (rationale), PRIVACY_HASH_SECRET (do not rotate casually), RAZORPAY_WEBHOOK_SECRET_NEXT overlap rotation, SESSION_SECRET rotation (signs out all users) (+1 more)

### Community 145 - "Identity Google Oauth"
Cohesion: 0.25
Nodes (5): base64url(), GoogleAuthStart, GoogleOAuthOptions, GoogleOAuthProvider, GoogleProfile

### Community 146 - "Cli Repair Project Totals"
Cohesion: 0.22
Nodes (6): config, dryRun, operator, projectId, reason, uow

### Community 147 - "Cli Replay"
Cohesion: 0.22
Nodes (7): config, jobKind, [kind, maybeId], limit, topic, uow, replayJob()

### Community 148 - "Audit Chain"
Cohesion: 0.36
Nodes (8): AuditEventInput, canonicalEventBody(), ChainedAuditEvent, chainEvents(), ChainVerificationResult, computeEventHash(), verifyChain(), verifyChainFrom()

### Community 149 - "Web Tsconfig"
Cohesion: 0.25
Nodes (8): compilerOptions, allowJs, incremental, jsx, moduleResolution, noEmit, paths, plugins

### Community 150 - "Cli Describe Error"
Cohesion: 0.39
Nodes (7): collectCodes(), collectMessages(), DescribedError, describeError(), formatCliError(), NodeError, redactUrl()

### Community 152 - "Numbering Numbering"
Cohesion: 0.25
Nodes (4): DEFAULT_FORMATS, NumberFormat, SEQUENCE_KINDS, SequenceKind

### Community 153 - "Ui Tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, outDir, rootDir, extends, include, src/**/*.ts

### Community 154 - "Integration Intake Service.test"
Cohesion: 0.43
Nodes (7): addEmployee(), GOOD_MESSAGE, nextMessageId(), nextPhone(), raiseAndDecide(), send(), today()

### Community 155 - "Routes Projects"
Cohesion: 0.48
Nodes (6): fullProject(), IdParams, ProjectRowLike, projectTotalsDto(), registerProjectRoutes(), summariseProject()

### Community 156 - "Employees Employee Manager"
Cohesion: 0.38
Nodes (6): EmployeeManager(), EMPTY, FormState, messageFor(), ProjectOption, minorToInput()

### Community 158 - "Docs HANDOFF"
Cohesion: 0.29
Nodes (7): 6.1 Company field is optional, not required, 6.2 The parser refuses to guess, 6.3 WhatsApp templates — the constraint that shapes onboarding, 6.4 Simulator-first gateway, 6.5 Signature is stronger evidence, not a stronger legal claim, 6.6 Assurance levels, 6. Decisions made, and why

### Community 159 - "Docs HANDOFF"
Cohesion: 0.29
Nodes (7): 8. Next steps, in build order, Step 1 — WhatsApp gateway with simulator driver, Step 2 — Intake service, Step 3 — Contract rendering + signature pad, Step 4 — Owner dashboard pages, Step 5 — Notifications back, Step 6 — Register the Meta template

### Community 160 - "Runbooks Cross Tenant Disclosure"
Cohesion: 0.29
Nodes (7): Cross-Tenant Disclosure Response Runbook, Cross-Tenant IDOR Threat, Preserve Evidence Then Contain, Pseudonymous Log Correlation by requestId, Tenant Authorization Rule, TenantContext Repository Scope, Tenant Isolation Negative Corpus

### Community 162 - "Application Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 163 - "Config Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 164 - "Contracts Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 165 - "Db Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 166 - "Domain Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 167 - "Files Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 168 - "Webhooks Signature"
Cohesion: 0.43
Nodes (4): constantTimeEqual(), resolveMetaChallenge(), verifyMetaSignature(), verifyRazorpaySignature()

### Community 169 - "Integrations Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 170 - "Observability Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 171 - "Runtime Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 172 - "Testkit Tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts

### Community 173 - "Scripts Dev Lan"
Cohesion: 0.29
Nodes (6): API_HOST, API_PUBLIC_URL, CORS_ALLOWED_ORIGINS, NEXT_PUBLIC_API_URL, dev-lan.sh script, WEB_PUBLIC_URL

### Community 175 - "Api Package"
Cohesion: 0.33
Nodes (6): scripts, build, dev, openapi, start, typecheck

### Community 176 - "Api Tsconfig"
Cohesion: 0.33
Nodes (6): compilerOptions, noEmit, outDir, rootDir, types, node

### Community 178 - "Web Package"
Cohesion: 0.33
Nodes (6): devDependencies, @types/react, @types/react-dom, typescript, @types/react, @types/react-dom

### Community 179 - "Runbooks Replay Events"
Cohesion: 0.33
Nodes (6): Bounded Replay Only, claimForGeneration State Guard, Decisions Are Never Replayable, Handler Idempotency, Message dedupe_key Check, replay.ts Audited Replay Command

### Community 180 - "Src Container"
Cohesion: 0.40
Nodes (3): Container, ContainerOptions, createContainer()

### Community 181 - ".prettierrc"
Cohesion: 0.33
Nodes (5): arrowParens, printWidth, semi, singleQuote, trailingComma

### Community 182 - "Scripts Preflight Hosted"
Cohesion: 0.47
Nodes (5): main(), record(), redact(), Result, results

### Community 183 - "Integration Message Delivery Ledger.test"
Cohesion: 0.47
Nodes (3): approveChange(), job(), planCustomerReceipt()

### Community 185 - "Plugins Errors"
Cohesion: 0.60
Nodes (3): registerErrorHandler(), toAppError(), zodDetails()

### Community 186 - "Api Tsconfig"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 187 - "Docs Extrawork Product Brief"
Cohesion: 0.40
Nodes (5): WhatsApp Intake Positioning, Site Employee Persona, Field Employee (Product Brief), Underlying Idea: Adapting Change Orders to India, WhatsApp Intake Message Flow

### Community 188 - "Worker Package"
Cohesion: 0.40
Nodes (5): scripts, build, dev, start, typecheck

### Community 189 - "Runbooks Failed Migration"
Cohesion: 0.40
Nodes (5): Concurrent Index Rebuild, Expand-and-Contract Migrations, Failed Migration Recovery Runbook, Fix Forward or Roll Back the Code, Per-Migration Transaction Atomicity

### Community 190 - "Evidence Build"
Cohesion: 0.50
Nodes (4): BuildEvidenceOptions, buildEvidenceViewModel(), EvidenceViewModel, formatInTimezone()

### Community 191 - "Approvals Signing"
Cohesion: 0.50
Nodes (4): assertSignedDatePlausible(), calendarDateIn(), SIGNED_DATE_TOLERANCE_DAYS, SignedDateCheck

### Community 192 - "Testkit Package"
Cohesion: 0.40
Nodes (5): exports, ./seed, default, development, types

### Community 194 - "Integration Intake Repositories.test"
Cohesion: 0.70
Nodes (4): addEmployee(), nextMessageId(), nextPhone(), record()

### Community 197 - "AGENTS"
Cohesion: 0.50
Nodes (3): graphify, Graphify Query Workflow (AGENTS.md), Graphify Query Workflow (CLAUDE.md)

### Community 198 - "Web PRODUCT"
Cohesion: 0.50
Nodes (4): Operating Context (paise, baseline lock), Roles (OWNER/ADMIN/PROJECT_MANAGER/FINANCE/VIEWER), Change Request State Machine, Money Is Never a Float (ADR-005)

### Community 199 - "Web Tsconfig"
Cohesion: 0.50
Nodes (4): lib, ES2023, DOM, DOM.Iterable

### Community 202 - "Docs Extrawork Product Brief"
Cohesion: 0.67
Nodes (3): Core Product Value, Later Expansion Roadmap, The Problem (Informal Extra-Work Authorization)

### Community 203 - "Runbooks Replay Events"
Cohesion: 0.67
Nodes (3): Dead-Letter Diagnosis Before Replay, PermanentJobError, Replay Webhook and Outbox Events Runbook

### Community 204 - "Runbooks Revoke Leaked Token"
Cohesion: 0.67
Nodes (3): A0 Bearer-Link Assurance Level, Corrective Change to Undo an Approval, Spent Token With Recorded Decision

## Knowledge Gaps
- **1298 isolated node(s):** `LoggerContext`, `Labels`, `Series`, `Blocker`, `DraftValidationResult` (+1293 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **43 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppError` connect `Src Errors` to `Jobs Exports`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `toAppError()` connect `Plugins Errors` to `Jobs Exports`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `generateEvidence()` connect `Worker Evidence & Export Jobs` to `Jobs Exports`, `Evidence PDF Template`, `Worker Maintenance Jobs`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `LoggerContext`, `Labels`, `Series` to the rest of the system?**
  _1298 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Database Core & IDs` be split into smaller, more focused modules?**
  _Cohesion score 0.042843232716650435 - nodes in this community are weakly interconnected._
- **Should `File Storage & Object Store` be split into smaller, more focused modules?**
  _Cohesion score 0.05010351966873706 - nodes in this community are weakly interconnected._
- **Should `Document Repository` be split into smaller, more focused modules?**
  _Cohesion score 0.053185271770894216 - nodes in this community are weakly interconnected._