<!-- converted from ExtraWork_Technical_Design_Report_v2.0.docx -->

TECHNICAL DESIGN REPORT
ExtraWork
Technical Design Report and Master Build Specification
| Version | 2.0 \| 14 August 2026 |
| --- | --- |
| Status | Approved design baseline |
| Audience | Founder, product, engineering, security, and implementation partners |

Product thesis
ExtraWork is a WhatsApp-first contract-change approval service for small Indian project businesses. Owners administer projects and permissions from one dashboard; authorized employees submit minimal requests to ExtraWork on WhatsApp; customers decide from a secure no-account webpage.
| Architecture recommendation: Build a TypeScript modular monolith with a Next.js web application, Fastify API, PostgreSQL, private object storage, and a PostgreSQL-backed worker. Defer microservices, Redis, Elasticsearch, blockchain, native mobile applications, and AI. |
| --- |


## Document map
Product definition and source-of-truth decisions
Design goals, assumptions, and non-goals
Users, authorization, and assurance
Domain workflows and state machines
System architecture and trust boundaries
Frontend design
Backend modules and API contract
Core product engines
Data architecture and example schema
External systems and integrations
Infrastructure and delivery
Security, privacy, compliance, and governance
Reliability and operations
Engineering structure and testing
Development plan, economics, and scaling
Unresolved decisions and launch gates
# 1. Product definition and source-of-truth decisions
## 1.1 What the product is
ExtraWork is a multi-tenant SaaS service for contractors and other project-based SMBs. The paying business uses a web dashboard as its only administrative interface. It records the original project, customer approver, and the employees authorized to submit requests for that project. A field employee uses WhatsApp only: the employee sends the project reference, extra-work description, reason, total cost, time impact, and photographs. ExtraWork authenticates the sender's phone, resolves the organization and project assignment, validates or conversationally completes the request, and creates a frozen contract-change version.
The customer receives an approved WhatsApp utility message with a secure review link. The customer sees the exact work, price/tax presentation, photographs, schedule effect, and resulting contract total when configured. The customer can approve, decline, or request revision without an account. ExtraWork then preserves the exact version, message and decision history, and generates a tamper-evident evidence PDF for invoicing, closeout, or a later disagreement.
The initial vertical is Indian interior renovation and turnkey fit-out businesses with approximately 5-30 staff, projects commonly above INR 5 lakh, multiple concurrent projects, and direct homeowner or commercial-client relationships.
## 1.2 User problem
The product addresses four related failures in informal project management:
Scope ambiguity: the customer and contractor remember differently whether work was included.
Commercial ambiguity: work may be approved conversationally without a clear amount, tax treatment, or revised total.
Authority ambiguity: a relative, employee, tenant, designer, or site contact may request work without authority to increase the contract.
Evidence fragmentation: instructions, prices, photographs, and acknowledgements are distributed across calls, chats, PDFs, and invoices.
The technical product must therefore do more than store a customer's “yes.” It must connect a decision to an identified project, baseline agreement, numbered change, exact frozen version, commercial impact, schedule impact, approver, and event history.
## 1.3 Core value proposition
| Get the customer's written approval for extra cost and time before work begins, in under one minute, through WhatsApp, without requiring a customer account. |
| --- |

Value is created through recovered billable work, faster decisions, fewer misunderstandings, cleaner invoice preparation, and a credible evidence trail. The product does not promise that every record is legally enforceable or “court-proof.” It strengthens documentation and attribution while leaving enforceability to the underlying agreement and applicable law.
## 1.4 Models being adapted
The relevant analogues are construction change-order and quote-acceptance products, not healthcare marketplaces such as Cost Plus Drugs or GoodRx. Those names are examples of localization models in the broader startup thesis, but their pricing/data architecture is not being replicated here.
| Model | What it already proves | What ExtraWork replicates | What ExtraWork changes |
| --- | --- | --- | --- |
| Beam, Houzz Pro, 247Pro, Snappii | Contractors will create, send, approve, and bill change orders digitally | Numbered changes, client review, approval status, signatures/evidence, PDF | India pricing, WhatsApp-first delivery, no client account, lighter product |
| Onsite and Powerplay | Indian construction software recognizes scope variation and approval as a real workflow | Project-linked scope and cost changes, approval tracking | Standalone workflow for smaller firms that reject full ERP adoption |
| Zoho Invoice/Books | Customers accept or reject quotations; accepted quotes can flow into invoices | Mobile acceptance, status visibility, eventual invoice integration | A change amends an existing project and shows revised contract/time totals; it is not a new generic quote |
| WhatsApp plus PDF | Existing behavior is cheap and familiar | WhatsApp remains the distribution surface | ExtraWork supplies structure, versioning, identity evidence, totals, and an evidence pack |

## 1.5 Product boundary
ExtraWork owns the lifecycle from project baseline through change decision and evidence export. It references invoices and payments but is not an accounting ledger. It stores project and customer context but is not a CRM. It may record a schedule delta but is not a scheduling system. This boundary is an intentional commercial and engineering constraint.
# 2. Design goals, assumptions, and non-goals
## 2.1 Design goals
A repeat change request can reach send confirmation in less than 60 seconds from WhatsApp.
A customer can review and decide without registration or installation.
All money is represented deterministically and all totals are reproducible.
A sent or approved version cannot be edited in place.
Every security-relevant event is attributable, timestamped, and auditable.
WhatsApp ingress and customer delivery are observable and recoverable; a dashboard copy-link/manual-send fallback remains available during provider failure.
The initial system costs little to operate and can be owned by one full-stack engineer.
The codebase supports later extraction of notifications, documents, and integrations without premature microservices.
## 2.2 Operating assumptions
Owners and administrators use the dashboard from desktop or mobile browsers; field employees primarily use WhatsApp on Android phones.
Customer recipients use a modern mobile browser and WhatsApp; email is a fallback.
Currency is INR in the initial release, but storage and APIs retain ISO currency codes.
Timestamps are stored in UTC and rendered in the organization's configured timezone, initially Asia/Kolkata.
Telephone numbers are normalized to E.164. Indian ten-digit entry is accepted and normalized with country confirmation.
A project has one baseline commercial amount in the MVP. Multiple baselines or formal BOQ revisions are later features.
An employee's registered E.164 WhatsApp phone number identifies the worker. Authorization also requires an active organization membership and active project assignment. If one phone belongs to workers in multiple organizations, the conversation must explicitly resolve the organization.
One authorized customer approver is required per request in the MVP. Multiple and sequential approvers are deferred.
The employee fast path accepts one structured message plus photographs. An intake session preserves valid fields and asks only for missing or ambiguous information.
The company name is inferred from the employee record and is not normally typed. The project may be inferred only when exactly one authorized active project is safe to select.
The business remains responsible for the accuracy of scope, tax, pricing, and authorization data.
Core operation requires no proprietary external dataset, scraper, marketplace liquidity, or AI model.
## 2.3 Non-goals for MVP
Payroll, attendance, inventory, procurement, vendor management, full scheduling, lead CRM, or job costing
Full GST invoicing or tax filing
Native iOS or Android applications and an employee web/PWA composer
Aadhaar-based signing, qualified electronic signature, or blockchain notarization
AI-generated scopes, prices, photographs, or legal advice
Offline customer decisions
Multi-company marketplaces or contractor discovery
Government-contract variation-order compliance
General-purpose document signing
## 2.4 Primary technical quality attributes
| Attribute | MVP target | Production target |
| --- | --- | --- |
| Availability | 99.5% monthly; approval surface prioritized | 99.9% monthly |
| Customer-page performance | LCP below 2.5 seconds on typical Indian 4G at p75 | Same, measured by region/device |
| API latency | p95 under 500 ms excluding documents/providers | p95 under 300 ms for core reads |
| Decision durability | Transactionally committed before success response | Same, with cross-region backup |
| Recovery point objective | 24 hours maximum; target under 5 minutes with PITR | Under 5 minutes |
| Recovery time objective | 8 hours | 2 hours |
| Tenant isolation | No cross-tenant reads under automated tests | Defense-in-depth with RLS/audits |

# 3. Users, authorization, and assurance
## 3.1 Personas and roles
| Role | Typical person | Capabilities |
| --- | --- | --- |
| Organization owner | Contractor founder | Billing, organization policy, users, every project and export |
| Administrator | Operations manager | Users except ownership transfer, all projects, templates, reports |
| Project manager | Site/project lead | Assigned projects, customers, changes, sharing, decisions |
| Field employee | Site worker/supervisor | WhatsApp-only submission for explicitly assigned active projects; no dashboard account required |
| Finance | Accountant | Read projects and approvals, export/invoice references; cannot change scope |
| Viewer | Partner or auditor | Read-only assigned projects and exports |
| Customer approver | Homeowner/client representative | Review one version and decide through scoped public link |
| Support operator | ExtraWork support | Metadata-only by default; time-bound audited access after customer grant |

## 3.2 Authorization model
Use role-based access control plus project assignment for dashboard actors and a distinct channel-actor policy for WhatsApp employees. Every authenticated dashboard request resolves actor_id, organization_id, role, and optional project grants. Every inbound employee command resolves the verified provider sender number to an active field_worker, an organization, and an active project assignment. Backend authorization is mandatory even when the frontend or bot hides choices.
Authorization rule shape:
allow(actor, action, resource) =
  actor.organization_id == resource.organization_id
  AND role_allows(actor.role, action)
  AND (actor.role in {OWNER, ADMIN} OR resource.project_id in actor.project_grants)
WhatsApp submission rule:
allowWhatsAppSubmit(senderPhone, organization, project) =
  field_worker.phone_e164 == senderPhone
  AND field_worker.organization_id == organization.id
  AND field_worker.status == ACTIVE
  AND project.status == ACTIVE
  AND active_project_assignment(field_worker.id, project.id).can_submit == true
Phone ownership is necessary but not sufficient. The system rechecks worker and project authorization both when the intake session begins and immediately before the request is frozen or sent. Deactivation blocks new commands but never erases historical attribution.
The database includes organization_id on every tenant-owned row. Repository methods require an organization context rather than accepting arbitrary identifiers. PostgreSQL row-level security may be enabled as defense-in-depth after repository integration tests are stable; application-layer tenant scoping remains the primary explicit control.
## 3.3 Approval assurance levels
ExtraWork must describe identity assurance accurately.
| Level | Evidence | Use |
| --- | --- | --- |
| A0: secure-link assent | 256-bit opaque token, typed name, affirmative checkbox, timestamp, IP/user agent | MVP default; commercially useful but bearer-link identity is limited |
| A1: phone-verified assent | A0 plus OTP to the recorded approver phone and verified-phone event | Recommended P1 default for higher-value changes |
| A2: licensed e-signature | External e-sign provider, provider certificate and signed artifact | Enterprise or contractually required cases |

The UI and evidence PDF show the achieved assurance level. A0 must never be represented as a government-recognized electronic-signature certificate. The legal copy is reviewed by Indian counsel before launch.
## 3.4 Public-token security
Generate 32 random bytes with a cryptographically secure generator.
Return the URL-safe base64 token only once; store SHA-256(token).
Bind it to exactly one change-order version and intended approver.
Expire it according to the request deadline, with a maximum configured lifetime.
Revoke it when the version is superseded, cancelled, or decided.
Never log the plaintext token or include it in analytics/referrer URLs.
Set Referrer-Policy: no-referrer, prevent search indexing, and avoid third-party scripts on approval pages.
# 4. Domain workflows and state machines
## 4.1 Project setup
An authenticated owner creates the organization profile and selects tax, template, notification, and direct-send/manager-review policy.
The owner creates or selects a customer and records the intended WhatsApp approver, authority note, and communication opt-in/basis where required.
The owner creates a project with a short unique code, title, site address, currency, timezone, baseline subtotal/tax/total, dates, and authorized approver.
The owner optionally uploads the original quotation or contract. The system records a baseline snapshot. Changing the baseline after the first sent change requires an explicit baseline amendment event, not a silent update.
The owner creates field-worker records with names and normalized WhatsApp phone numbers, then assigns each worker to the projects for which the worker may submit.
ExtraWork provides an activation message or QR/deep link so the worker initiates the WhatsApp conversation. No employee password or application is created.
## 4.2 Create, send, and decide
[Employee WhatsApp]
        |
        | text + photos
        v
[Meta webhook ingress] -> [Webhook inbox/dedupe] -> [Intake session]
                                                    |
                          [phone -> worker -> organization -> project grant]
                                                    |
                          [extract fields / ask only for missing data]
                                                    |
                          [WhatsApp summary: Send / Change / Cancel]
                                                    |
                                      [optional manager review]
                                                    |
                         [Freeze snapshot + token + outbox atomically]
                                                    |
                         [Worker -> WhatsApp customer utility template]
                                                    |
                                         [Customer approval page]
                                                    |
                         POST /public/v1/requests/{token}/decisions
                                                    v
                                      [Atomic decision transaction]
                                                    |
                              +---------------------+--------------------+
                              |                     |                    |
                           Approved              Declined       Revision requested
                              |
                              v
                  [Evidence PDF + project totals + WhatsApp notifications]
The dashboard retains a manual create/resend path for support and provider-outage recovery, but the employee WhatsApp path is the primary creation workflow.
## 4.3 Change-order aggregate states
DRAFT --send--> SENT --open--> VIEWED
  |                |              |
  |                +--------------+--approve--> APPROVED (terminal)
  |                +--------------+--decline---> DECLINED (terminal)
  |                +--------------+--request revision--> REVISION_REQUESTED
  |                +--------------+--expire----> EXPIRED
  +--cancel-------> CANCELLED      +--cancel----> CANCELLED

REVISION_REQUESTED --create revision--> DRAFT(new version)
APPROVED --commercial reversal needed--> create separate deduction change
APPROVED and DECLINED are terminal for that version. An approved request cannot be deleted or edited. A correction is a new linked change order or reversal. An expired or declined request can be duplicated into a new version, but historical events remain.
## 4.4 Version rules
Draft edits may update the same draft version until first send.
Sending freezes a canonical snapshot and increments no version by itself.
Any change after send creates version n + 1, marks the prior version SUPERSEDED, and revokes its token.
Numbering is organization/project scoped and gap tolerant. A rolled-back allocation may leave a gap; numbers are identifiers, not accounting sequences.
Every PDF displays business name, project number, change number, version, state, assurance level, and generation timestamp.
## 4.5 Approval request lifecycle
Public GET resolves the hashed token, validates expiry and revocation, and returns a sanitized projection.
A first valid view appends REQUEST_VIEWED; repeat views update aggregate analytics without changing the evidence event.
Customer enters name and optional comment. A0 requires an explicit checkbox confirming authority and assent.
For A1, the API initiates and verifies OTP before enabling final submission.
Decision POST includes an idempotency key and the version ETag.
The API locks the version row, revalidates state and token, writes the decision and audit events, updates project materialized totals, and commits.
Only after commit does the response show success. Documents and notifications are asynchronous.
## 4.6 Failure and edge-case behavior
If the sender phone is unknown, respond with a generic registration instruction and disclose no organization or project information.
If the worker belongs to more than one organization or has multiple plausible projects, present explicit numbered choices; never select by fuzzy similarity alone.
If a message contains some valid fields, preserve them and request only missing or ambiguous fields. A malformed cost must not discard the description or photographs.
Correlate follow-up photographs and text to one active intake session using sender, provider conversation/message IDs, timestamps, and session state. Duplicate or late media events must not create a second request.
Recheck worker status, project status, and assignment at confirmation/send time. If authorization changed during the conversation, fail safely and preserve a support-visible draft.
Intake sessions expire after a configurable inactivity period. CANCEL, RESTART, and HELP are deterministic commands and must not depend on natural-language classification.
If two decisions race, the first committed terminal decision wins; the second receives 409 ALREADY_DECIDED and the recorded state.
If the contractor supersedes while the customer page is open, the decision receives 409 VERSION_SUPERSEDED with a safe link to the current version when allowed.
A negative change is supported as a deduction and must show a minus sign and revised total clearly.
A zero-price time-only change is valid.
If the revised total would become negative or currency differs from the project, validation fails.
Customer comments are append-only evidence; contractor replies create separate events.
Attachment removal after send is impossible; a revision is required.
Project currency and timezone cannot change after the first sent request without an administrator migration workflow.
# 5. System architecture and trust boundaries
## 5.1 Recommended architecture
Use a modular monolith in a TypeScript monorepo. The web, API, and worker are separate runtime processes but share domain code, schemas, and database. This yields simple transactions and operations while preventing a Next.js frontend from becoming the domain layer.
Internet / Meta
                             |
                   [CDN / WAF / TLS edge]
            +----------------+----------------+
            |                |                |
   [Owner Web Dashboard] [Public Approval] [WhatsApp Webhook]
            \                |                /
             +---------------+---------------+
                             |
                         [Fastify API]
            +----------------+----------------+
            |                |                |
     [Domain modules] [Intake/session engine] [Auth/RBAC]
            |                |                |
            +-----------[PostgreSQL]----------+
                         |          \
                    [Outbox/jobs] [Audit/event chain]
                         |
                    [Worker process]
            +------------+------------+------------+
            |                         |            |
      [Object storage]     [WhatsApp send/media] [Email/OTP]
            |
      [PDF evidence packs]

Optional later: Payments, accounting exports, licensed e-signature
## 5.2 Component boundaries
| Component | Owns | Must not own |
| --- | --- | --- |
| Owner web | Dashboard rendering, route protection, administrative forms, upload state | Employee conversation state, commercial calculations, or authorization truth |
| API | Validation, authorization, transactions, domain state, projections | Provider-specific retry loops or heavy PDFs |
| WhatsApp ingress | Webhook verification, inbox dedupe, normalized event acceptance | Long domain orchestration inside the webhook request |
| Intake/session engine | Sender/project resolution, field extraction, conversation state, prompts, confirmation | Provider-specific payload shapes or legal template mutation |
| Worker | Outbox consumption, messaging, reminders, PDFs, scans, reconciliation | Accepting customer decisions directly |
| PostgreSQL | Source of truth, constraints, jobs/outbox, audit chain | Binary attachment bodies |
| Object storage | Private originals, photos, generated evidence | Public permanent URLs |
| Integration adapters | Provider authentication, payload mapping, webhook verification | Domain state decisions |

## 5.3 Trust boundaries
Authenticated business boundary: session-authenticated users; tenant and role checks on every resource.
Public approval boundary: bearer link plus optional OTP; minimal response fields; aggressive rate limits; no tenant dashboard access.
File boundary: uploads are untrusted until MIME validation and malware scanning complete.
Provider webhook boundary: raw body retained temporarily; signature verified before acknowledgement/processing.
Employee-channel boundary: a provider-reported phone number identifies a worker but every command still requires active worker and project assignment checks.
Support boundary: staff have no default document access; elevated access is time-limited, customer-authorized, and audited.
## 5.4 Architectural decision records
### ADR-001: modular monolith instead of microservices
Recommendation: one domain codebase and one transactional database.
Why: change creation, version freezing, decisions, totals, entitlements, and audit events require strong transactions. The expected initial load is modest, and a solo team cannot justify distributed consistency or service operations.
Alternative: separate project, approval, notification, and billing services. This offers independent scaling but adds network failure, schema coordination, tracing, and eventual-consistency complexity.
Extraction trigger: a module needs independent availability/security ownership, or consumes more than 30% of compute and cannot scale economically with the monolith.
### ADR-002: REST JSON instead of GraphQL
Recommendation: versioned REST endpoints with OpenAPI-generated clients.
Why: workflows are command-oriented, public endpoints must be narrowly scoped, HTTP caching and idempotency are explicit, and engineering/tooling is simpler.
Alternative: GraphQL improves flexible dashboard reads but complicates authorization, caching, query cost control, and public attack surface. Add only if multiple rich clients later need flexible projections.
### ADR-003: PostgreSQL job queue before Redis
Recommendation: pg-boss or an equivalent FOR UPDATE SKIP LOCKED queue, plus a transactional outbox.
Why: avoids a second stateful service, allows enqueue-with-transaction, and is sufficient for early notification/PDF volume.
Alternative: Redis/BullMQ provides higher throughput and richer queue operations but creates dual-write risks unless paired with an outbox. Migrate when queue contention or latency is measured.
### ADR-004: PostgreSQL search before Elasticsearch
Recommendation: B-tree, trigram, and full-text indexes for customers, projects, and changes.
Why: the corpus is tenant-scoped and small. Dedicated search infrastructure is unnecessary.
Alternative: OpenSearch becomes useful for multi-million-record fuzzy search and analytics, but requires indexing pipelines and consistency handling.
### ADR-005: canonical server calculations
Recommendation: the API calculates and stores all totals; the client may preview but never supplies authoritative totals.
Why: prices, tax, rounding, and revised contract values become evidence. One implementation must govern every UI, PDF, export, and webhook.
Alternative: client-calculated totals reduce API calls but create drift and tampering risk.
# 6. Frontend design
## 6.1 Applications and rendering model
Use one Next.js application with two route groups:
/app/*: authenticated owner/admin/project/finance dashboard.
/r/*: isolated public approval experience with a reduced JavaScript and analytics footprint.
Prefer server-rendered initial pages and client-side enhancement. Public pages should remain functional on low-memory devices and constrained networks. Field employees do not use the web application in the MVP; WhatsApp is their complete request interface. The dashboard remains responsive for owners who use phones, but no installable employee PWA or offline send workflow is required.
## 6.2 Route and page inventory
| Route | Purpose | Critical actions |
| --- | --- | --- |
| /app/onboarding | Organization setup | Business identity, timezone, currency, first project |
| /app/dashboard | Operational overview | Pending, overdue, approved value, recent decisions |
| /app/customers | Customer directory | Search, create, merge duplicate |
| /app/customers/{id} | Customer history | Projects, approvers, consent status |
| /app/projects | Project list | Filter by state/owner/customer |
| /app/projects/{id} | Project workspace | Baseline, change register, revised total, exports |
| /app/employees | Field-worker directory | Add/deactivate phone, view authorization state |
| /app/employees/{id} | Employee assignments and history | Assign/revoke projects, review submissions |
| /app/requests | Complete request register | Search/filter/status/action queues |
| /app/changes/{id} | Request, intake, version, delivery, and decision history | Review, revise, resend, remind, export |
| /app/reviews | Optional manager-review queue | Approve, edit through controlled form, reject/cancel |
| /app/templates | Reusable language/line items | Create and localize templates |
| /app/reports | Documented extra-work summary | Date/project/user filters, CSV/PDF |
| /app/settings/* | Users, roles, branding, retention, billing | Organization policy |
| /r/{token} | Public customer review | View, approve, decline, request revision |
| /r/{token}/verify | OTP verification when required | Send/resend/verify code |
| /r/{token}/complete | Decision receipt | Receipt ID and PDF access if permitted |

## 6.3 UX-critical owner control surfaces
The owner dashboard is an administrative control plane, not the default field composer. The most important flows are:
Fast onboarding: organization -> first project/customer/approver -> first employee phone -> project assignment -> WhatsApp activation.
Request register: one list of incomplete intake sessions, manager reviews, delivery failures, pending customer decisions, and terminal records.
Project workspace: baseline, authorized approver, assigned employees, change register, approved delta, evidence, and exports.
Employee authorization: add/deactivate worker, normalize/verify phone, assign projects, and see historical submissions.
Controlled correction: edit an incomplete draft or manager-review item; any sent request requires a new version.
The dashboard may expose a manual request/revision form for operations and provider-outage recovery. It uses React Hook Form, shared Zod contracts, integer-paise money serialization, signed uploads, and optimistic locking. It is not promoted as the employee experience.
## 6.4 WhatsApp conversational UX
The conversation engine supplies the lowest-friction field experience:
Accept a one-message fast path containing project, description, reason, cost, and time impact, plus attached/follow-up photos.
Infer organization and worker from the provider sender number. Infer project only when exactly one active authorized project is unambiguous.
Preserve recognized fields and ask one short question for each missing or ambiguous value.
Prefer deterministic buttons/list replies for reason, project selection, time impact, send/change/cancel, and manager confirmation where Meta supports them.
Return a compact final summary and require explicit SEND confirmation before customer delivery.
Support HELP, STATUS, CANCEL, and RESTART commands independent of free-text extraction.
Never expose one organization's name, projects, clients, or employees to an unresolved/unauthorized sender.
Explain validation errors with a correction example; never answer only “invalid format.”
Expire inactive sessions and notify the worker that NEW starts again without losing any already-created dashboard record.
Conversation state is server-side. WhatsApp is a transport, not a trusted state store. The employee can resume after retries or duplicate webhook delivery without producing duplicate drafts.
## 6.5 Frontend state management
Use TanStack Query for dashboard server state, request deduplication, revalidation, and optimistic UI. Use component/form state for transient administrative inputs. A small Zustand store is optional for upload progress and manual draft recovery; do not mirror all API data into a global store. WhatsApp intake state lives only in the backend intake_sessions aggregate and is never reconstructed from browser state.
Query-key examples:
['organization', organizationId]
['projects', organizationId, filters]
['project', projectId]
['changeOrder', changeOrderId]
['changeOrderVersions', changeOrderId]
['dashboard', organizationId, dateRange]
Invalidate narrowly after mutations. Approval-page state is not kept in the authenticated query cache.
## 6.6 Authentication and sessions
Use managed authentication for business users, preferably Supabase Auth or Clerk, with email magic link initially and passkeys/TOTP later. Store only the provider user ID and application profile in the domain database. Sessions use secure, HTTP-only, SameSite=Lax cookies; do not store bearer access tokens in local storage.
Public customers do not authenticate into the business application. Their secure link creates a separate short-lived public session cookie after token validation. At A1, successful OTP verification raises that session's assurance level.
## 6.7 Search and dashboards
Search calls /v1/search?q= with tenant-scoped results grouped into customers, projects, and changes. Debounce by 250 ms, require two characters, and cancel stale requests. The backend uses normalized text and trigram search; results include only safe snippets.
The dashboard should query pre-aggregated projections rather than scanning audit events. Initial cards:
Incomplete WhatsApp intake sessions
Requests awaiting manager review
Pending customer decisions
WhatsApp delivery failures
Requests overdue or expiring
Approved extras this month
Projects with unbilled approved extras
## 6.8 Customer approval UX
The public page is the highest-value surface and must be visually neutral. It shows:
Contractor branding and verified contact
Project and site summary without unnecessary personal details
Change number/version and status
Scope and photographs
Original baseline, previously approved net changes, current delta, and revised total
Schedule impact
Expiry and assurance method
Prominent Approve, Decline, and Request revision actions
The final action uses a confirmation screen summarizing the exact decision. Prevent double submission, but rely on backend idempotency. After decision, show a receipt ID and timestamp. Do not deploy dark patterns, preselected consent, or a visually hidden decline option.
## 6.9 Offline and degraded behavior
The owner dashboard may cache its application shell and harmless list projections, but must not claim offline writes succeeded. Field intake depends on Meta delivery and the webhook/API path; provider-delayed messages are processed idempotently when received. The worker receives a concise “temporarily unavailable” reply only when the system can safely send one. A dashboard manual-create/copy-link path remains available for a confirmed provider outage.
If automated customer delivery fails, preserve the frozen request and expose Copy link, Share sheet, email, and retry actions to the owner. If the API or database is unavailable, public pages render a branded retry screen and never imply that a decision was recorded.
## 6.10 Accessibility and localization
Meet WCAG 2.2 AA for contrast, focus, labels, error association, and keyboard use.
Avoid meaning conveyed only through green/red status colors.
Use logical focus after validation errors and decision confirmation.
Use ICU message catalogs and locale-aware number/date formatting.
Store business-authored text as entered; do not automatically translate contractual scope.
Initial UI language may be English; Hindi templates are P1. Add languages only after field validation.
# 7. Backend modules and API contract
## 7.1 Module map
| Module | Responsibilities | Key interfaces |
| --- | --- | --- |
| Identity | Provider-user mapping, sessions, organization membership | AuthContext, MembershipRepository |
| Organizations | Business profile, policies, numbering, branding | OrganizationService |
| Field Workers | WhatsApp identities, status, project grants, activation | FieldWorkerService, WorkerAuthorization |
| Customers | Customers, contacts, approver authorization, consent | CustomerService |
| Projects | Baseline snapshot, members, calculated project summary | ProjectService, ProjectTotals |
| Intake | Webhook normalization, conversation/session state, field extraction, prompts, confirmation | IntakeSessionService, IntakeParser |
| Change Orders | Aggregate state, versions, lines, transitions | ChangeOrderService |
| Approvals | Public tokens, assurance, decisions, receipts | ApprovalService |
| Documents | Canonical snapshots, PDFs, manifests, exports | EvidencePackService |
| Messaging | Share instructions, templates, sends, delivery events | MessageGateway |
| Files | Upload sessions, validation, scanning, signed access | FileService |
| Billing | Plans, entitlements, subscription/provider state | EntitlementService |
| Payments | Optional deposits and reconciliation | PaymentGateway |
| Audit | Append-only domain/security events and hash chain | AuditWriter |
| Reporting | Read models, CSV, operational metrics | ReportingRepository |

Modules call each other through application services or domain interfaces, not by importing another module's database tables directly. Cross-module work occurs in a single API transaction when synchronous consistency is required; slow side effects use outbox events.
## 7.2 API conventions
Base paths: /v1 authenticated, /public/v1 approval, /webhooks/v1 providers.
JSON fields use camelCase; database uses snake_case.
UUIDv7 identifiers improve index locality; never expose sequential database IDs.
Dates are ISO 8601 UTC; local dates such as expected completion use YYYY-MM-DD.
Money uses { amountMinor: 1500000, currency: "INR" }.
Quantity is a decimal string such as "2.500".
Mutating commands accept Idempotency-Key; draft updates also require If-Match.
Responses include requestId; errors use a stable machine code and human-safe message.
Error envelope:
{
  "error": {
    "code": "VERSION_SUPERSEDED",
    "message": "This request has been replaced by a newer version.",
    "requestId": "req_01J...",
    "details": {
      "currentVersion": 3
    }
  }
}
## 7.3 Principal endpoints
### Organizations and memberships
POST   /v1/organizations
GET    /v1/organizations/current
PATCH  /v1/organizations/current
GET    /v1/memberships
POST   /v1/memberships/invitations
PATCH  /v1/memberships/{id}
DELETE /v1/memberships/{id}
### Field workers and assignments
GET    /v1/field-workers?query=&status=&cursor=
POST   /v1/field-workers
GET    /v1/field-workers/{id}
PATCH  /v1/field-workers/{id}
POST   /v1/field-workers/{id}/project-assignments
DELETE /v1/field-workers/{id}/project-assignments/{projectId}
POST   /v1/field-workers/{id}/activation-message
GET    /v1/field-workers/{id}/submissions
### Customers and contacts
GET    /v1/customers?query=&cursor=
POST   /v1/customers
GET    /v1/customers/{id}
PATCH  /v1/customers/{id}
POST   /v1/customers/{id}/contacts
PATCH  /v1/contacts/{id}
POST   /v1/customers/{id}/merge
### Projects
GET    /v1/projects?status=&ownerId=&customerId=&cursor=
POST   /v1/projects
GET    /v1/projects/{id}
PATCH  /v1/projects/{id}
POST   /v1/projects/{id}/baseline-amendments
POST   /v1/projects/{id}/close
GET    /v1/projects/{id}/change-register
POST   /v1/projects/{id}/evidence-pack
### Change orders
POST   /v1/projects/{projectId}/change-orders
GET    /v1/change-orders/{id}
PATCH  /v1/change-orders/{id}/draft
POST   /v1/change-orders/{id}/attachments
DELETE /v1/change-orders/{id}/attachments/{attachmentId}
POST   /v1/change-orders/{id}/preview
POST   /v1/change-orders/{id}/send
POST   /v1/change-orders/{id}/revisions
POST   /v1/change-orders/{id}/cancel
POST   /v1/change-orders/{id}/reminders
GET    /v1/change-orders/{id}/events
GET    /v1/change-orders/{id}/evidence.pdf
### Public approval
GET    /public/v1/requests/{token}
POST   /public/v1/requests/{token}/otp
POST   /public/v1/requests/{token}/otp/verify
POST   /public/v1/requests/{token}/decisions
GET    /public/v1/receipts/{receiptToken}
### Provider webhooks
GET    /webhooks/v1/meta/whatsapp       # challenge verification
POST   /webhooks/v1/meta/whatsapp
POST   /webhooks/v1/razorpay
POST   /webhooks/v1/auth
POST   /webhooks/v1/esign/{provider}
Meta's POST webhook is the ingress for employee messages, photos, interactive replies, customer delivery states, and any customer replies. It must acknowledge quickly after signature verification and inbox insertion; the worker performs all conversation/domain processing asynchronously.
## 7.4 Example create request
The employee-channel command is normalized before it reaches the change-order service:
{
  "source": "WHATSAPP_EMPLOYEE",
  "sourceMessageIds": ["wamid...1", "wamid...2"],
  "fieldWorkerId": "0191...",
  "organizationId": "0191...",
  "projectId": "0191...",
  "description": "Add four concealed electrical points in the master bedroom.",
  "reasonCode": "CUSTOMER_REQUESTED",
  "totalCostMinor": 1500000,
  "scheduleDeltaDays": 2,
  "intakeAttachmentIds": ["0191..."],
  "confirmedAt": "2026-08-14T15:10:00Z"
}
The application expands this minimal command with stored organization, project, approver, baseline, tax, template, and attribution data. The richer API form below is used by the controlled dashboard/manual path and internally by the application layer; employees never need to supply its full structure.
{
  "type": "ADDITION",
  "title": "Additional electrical wiring",
  "scope": "Supply and install two new 16A circuits from the distribution board...",
  "reason": "Requested by customer after kitchen appliance selection",
  "lineItems": [
    {
      "description": "Electrical wiring and installation",
      "quantity": "1.000",
      "unit": "lot",
      "unitPriceMinor": 1500000,
      "taxRateBps": 1800
    }
  ],
  "scheduleDeltaDays": 2,
  "approverContactId": "0191...",
  "expiresAt": "2026-08-20T18:30:00Z",
  "assuranceRequired": "A0"
}
Response:
{
  "id": "0191...",
  "number": "EW-004",
  "version": 1,
  "status": "DRAFT",
  "lockVersion": 1,
  "totals": {
    "subtotalDeltaMinor": 1500000,
    "taxDeltaMinor": 270000,
    "totalDeltaMinor": 1770000,
    "revisedContractTotalMinor": 41770000,
    "currency": "INR"
  }
}
## 7.5 Request lifecycle and middleware
Authenticated request order:
Assign request ID and structured log context.
Enforce maximum body size and content type.
Resolve and validate session.
Resolve active organization.
Apply user/IP rate limit.
Parse shared schema.
Load resource with mandatory tenant scope.
Authorize action.
Execute application service transaction.
Write audit/outbox records in the same transaction.
Commit; then return projection.
Emit metrics without PII.
Public decision requests additionally validate token hash, expiry, public session, origin/CSRF strategy, decision rate limit, assurance level, and ETag.
Inbound WhatsApp lifecycle:
Read raw body and verify Meta signature before trusting any field.
Parse only enough to derive the provider event/message key.
Insert the raw/minimized event into webhook_inbox under a uniqueness constraint.
Return HTTP 200 quickly, including for a known duplicate.
Worker loads the inbox item, normalizes sender, message, interactive reply, and media references.
Resolve active field-worker candidates by phone without exposing tenant data.
Lock or create the sender's intake session and apply the deterministic conversation transition.
Persist normalized message, newly extracted fields, audit event, and outbound prompt event atomically.
Worker downloads/scans media and sends the queued prompt/confirmation outside the transaction.
At final confirmation, reauthorize worker/project and invoke ChangeOrderService idempotently.
## 7.6 Idempotency and retries
Store mutating idempotency records with (scope, actor_or_token_id, key) unique. Persist request hash, status, resource ID, response status, response body, and expiry. If the same key and same request hash repeats, return the stored result. If the key repeats with a different payload, return 409 IDEMPOTENCY_KEY_REUSED.
Do not keep database transactions open while calling external providers. Domain transaction writes an outbox event; worker calls provider after commit. Retry network/timeouts with exponential backoff and jitter. Do not automatically retry validation, authentication, policy, or permanent provider errors.
Suggested retry schedule for non-urgent jobs:
30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours; then dead-letter
Approval confirmation notification failure never reverses the approval.
## 7.7 Rate limiting
| Surface | Initial limit | Key |
| --- | --- | --- |
| Authenticated reads | 300/minute | user plus organization |
| Authenticated mutations | 60/minute | user plus organization |
| Public request GET | 60/hour | token plus IP |
| Public decision POST | 10/hour | token plus IP |
| OTP send | 3/15 minutes, 10/day | contact plus IP |
| Upload creation | 30/hour | user plus organization |
| Employee inbound messages | 120/hour | provider sender plus organization/session |
| New intake sessions | 20/day | field worker plus organization |
| Webhooks | Provider-dependent burst limit | provider/account |

Implement MVP counters in PostgreSQL or edge middleware. Move high-volume public limits to managed edge/WAF or Redis when database write amplification becomes material.
## 7.8 Concurrency control
Draft updates use optimistic locking: UPDATE ... WHERE id=? AND lock_version=?.
Decision, send, supersede, numbering, and baseline amendment commands use short database transactions and row locks.
A unique partial index allows at most one terminal decision per version.
Version numbers are allocated under a lock on the change aggregate.
Project materialized totals are updated in the approval transaction or rebuilt from approved versions after detected inconsistency.
Jobs claim rows with FOR UPDATE SKIP LOCKED and a lease timestamp.
# 8. Core product engines
## 8.1 WhatsApp intake and conversation engine
Use a deterministic state machine with bounded extraction helpers, not an unconstrained chatbot. An LLM is not required for MVP and must never decide authorization, money, project identity, or whether to send. The engine accepts normalized provider events and produces domain commands plus outbound prompt intents.
IDLE
  -> RESOLVING_ORGANIZATION
  -> RESOLVING_PROJECT
  -> COLLECTING_DESCRIPTION
  -> COLLECTING_REASON
  -> COLLECTING_COST
  -> COLLECTING_TIME
  -> COLLECTING_MEDIA (optional/policy)
  -> AWAITING_EMPLOYEE_CONFIRMATION
  -> AWAITING_MANAGER_REVIEW (optional)
  -> SUBMITTED

Any nonterminal state -> CANCELLED or EXPIRED
Extraction order:
Exact project code token and interactive reply ID.
Explicit labels (Reason:, Cost:, Time:) using locale-aware deterministic parsers.
Safe textual heuristics for currency and number-of-days phrases.
Remaining text becomes a candidate description only when it meets minimum quality rules.
Anything ambiguous becomes a prompt; never guess a project, currency, authorization, or price.
Pseudocode:
async function handleInboundMessage(event: NormalizedWhatsAppMessage) {
  return db.transaction(async tx => {
    if (await inbox.wasProcessed(tx, event.providerMessageId)) return;
    const candidates = await workers.findActiveByPhone(tx, event.senderPhone);
    const session = await sessions.lockOrCreate(tx, event.senderPhone, candidates);
    const transition = intake.reduce(session, event, candidates);

    await normalizedMessages.insert(tx, event);
    await sessions.save(tx, transition.session);
    await intakeFields.upsertObserved(tx, transition.fieldChanges);
    await audit.append(tx, transition.auditEvents);
    await outbox.publishAll(tx, transition.outboundPrompts);
    await inbox.markProcessed(tx, event.providerMessageId);
  });
}
At employee confirmation, create a command hash from session ID plus accepted message/media IDs. Insert it under a unique constraint and call the change-order application service. This makes repeated button replies and webhook redelivery harmless.
Media correlation uses provider message ID, sender, conversation/account ID, receive time, and active session ID. Media is first stored as a pending intake attachment, then promoted to the frozen version only after scan and final confirmation. A late media event after submission is not silently added to a sent version; it creates an explicit follow-up requiring a revision.
## 8.2 Canonical money and tax engine
All stored money is signed 64-bit integer minor units. Quantity and unit rates are converted using a decimal library; never use JavaScript number for multiplication involving currency.
Per line:
raw_subtotal_minor = round_half_up(decimal(quantity) * unit_price_minor)
signed_subtotal = direction_sign * raw_subtotal_minor
tax_minor = round_half_up(signed_subtotal * tax_rate_bps / 10000)
line_total_minor = signed_subtotal + tax_minor
Aggregate:
version_delta = sum(line_total_minor)
prior_approved_delta = sum(latest approved, non-reversed versions for project)
revised_contract_total = baseline_total + prior_approved_delta + current_version_delta
The engine stores both inputs and calculated outputs in the frozen snapshot. On every read, the application may recompute and compare. A mismatch triggers a high-severity integrity alert and blocks new evidence generation until repaired.
Tradeoff: per-line GST rates and inclusive/exclusive presentation are supported for display, but ExtraWork does not issue statutory tax invoices in MVP. Full invoice tax compliance belongs to an accounting integration.
## 8.3 Numbering engine
Maintain a document_sequences row per organization/project and document type. Allocate inside a transaction:
INSERT INTO document_sequences (organization_id, project_id, kind, next_value)
VALUES ($1, $2, 'CHANGE_ORDER', 2)
ON CONFLICT (organization_id, project_id, kind)
DO UPDATE SET next_value = document_sequences.next_value + 1
RETURNING next_value - 1 AS allocated;
Format is configurable later; MVP uses EW-{zero-padded value}. Numbers may have gaps after transaction or draft cancellation. Never reuse a number because reuse damages auditability.
## 8.4 Snapshot and version engine
At send, build a canonical JSON object with stable field ordering and normalized values:
{
  "schemaVersion": 1,
  "organization": {"legalName": "...", "displayName": "..."},
  "project": {"id": "...", "number": "...", "baselineTotalMinor": 40000000},
  "change": {"number": "EW-004", "version": 1, "type": "ADDITION"},
  "scope": {"title": "...", "description": "...", "reason": "..."},
  "commercial": {"currency": "INR", "lines": [], "totalDeltaMinor": 1770000},
  "schedule": {"deltaDays": 2, "revisedCompletionDate": "2026-10-14"},
  "approver": {"contactId": "...", "maskedPhone": "+91******1234"},
  "attachments": [{"id": "...", "sha256": "...", "mimeType": "image/jpeg"}],
  "termsVersion": "approval-terms-in-v1"
}
Serialize with JSON Canonicalization Scheme or an equivalently documented canonicalizer, then compute SHA-256. The snapshot, digest, canonicalizer version, and terms version are permanent for that sent version.
## 8.5 Approval decision engine
Pseudocode:
async function decide(command, context) {
  return db.transaction(async tx => {
    const keyResult = await idempotency.begin(tx, context.subject, command.key, command);
    if (keyResult.replay) return keyResult.response;

    const token = await approvalTokens.lockByHash(tx, sha256(context.plainToken));
    assertUsable(token);

    const version = await versions.lock(tx, token.versionId);
    assert(version.status === 'SENT' || version.status === 'VIEWED');
    assert(version.etag === command.ifMatch);
    assertAssurance(context.publicSession, version.assuranceRequired);

    const now = clock.now();
    const decision = await decisions.insert(tx, {
      versionId: version.id,
      type: command.type,
      signerName: command.signerName,
      comment: command.comment,
      assuranceAchieved: context.publicSession.assurance,
      occurredAt: now,
      ipHash: privacyHash(context.ip),
      userAgent: truncate(context.userAgent)
    });

    await versions.markTerminal(tx, version.id, command.type, now);
    await approvalTokens.revoke(tx, token.id, 'DECIDED');
    if (command.type === 'APPROVE') {
      await projects.applyApprovedDelta(tx, version.projectId, version.totalDeltaMinor);
    }
    await audit.append(tx, decisionEvents(decision, version));
    await outbox.publish(tx, 'approval.decided.v1', {decisionId: decision.id});
    const response = receiptProjection(decision, version);
    await idempotency.complete(tx, keyResult.id, response);
    return response;
  });
}
## 8.6 Evidence and tamper-evidence engine
An evidence pack is a PDF plus machine-readable manifest. It contains:
Cover summary and disclaimer
Project baseline reference
Exact change snapshot
Line items, totals, and schedule effect
Attachment thumbnails and file digests
Decision details and achieved assurance
Chronological event history
Manifest digest and generation metadata
Audit chain:
event_hash[0] = SHA256(canonical(event[0]))
event_hash[n] = SHA256(event_hash[n-1] || canonical(event[n]))
Store previous_hash and event_hash per aggregate. The evidence manifest contains the terminal event hash and each referenced attachment digest. This detects later modification but does not independently prove when the hash existed. Optional P2 hardening writes daily Merkle roots to immutable object storage or an external timestamping/notarization service. Blockchain is unnecessary.
PDFs are rendered by Playwright/Chromium from a versioned HTML template. Store template version, renderer version, generated file hash, storage object version, and generation time. Regenerating the same evidence may produce different PDF bytes due to metadata; the canonical snapshot hash remains the legal/commercial identity.
## 8.7 Reminder engine
Each sent request creates a reminder schedule from organization policy, for example 24 hours and 72 hours before expiry. Worker checks state immediately before send. A reminder is suppressed if decided, revoked, opted out, outside allowed local hours, or rate-limited.
Use deduplication key:
reminder:{version_id}:{policy_step}:{channel}
Contractor-triggered reminders share cooldown rules. The central WhatsApp adapter sends only an allowed session message or approved utility template and records provider acceptance/delivery honestly. If provider sending fails, the dashboard exposes a manual copy-link fallback.
## 8.8 Entitlement engine
Entitlements are evaluated server-side from plan and subscription state:
type Entitlements = {
  activeProjects: number;
  completedDecisionsPerPeriod: number;
  teamMembers: number;
  automatedWhatsApp: boolean;
  otpApprovals: boolean;
  customBranding: boolean;
  retentionMonths: number;
};
Do not delete or hide historical evidence when a subscription lapses. Move the organization to read/export mode, stop new sends after grace, and preserve access according to retention policy. This protects both customer trust and dispute records.
# 9. Data architecture and example schema
## 9.1 Database choice
Use PostgreSQL 16 or newer through a managed provider. PostgreSQL provides transactions, constraints, JSONB for frozen snapshots, full-text/trigram search, row locks, partial indexes, and a viable early job queue. Drizzle ORM is recommended for migrations and typed queries while retaining explicit SQL for locking, aggregates, and constraints.
Alternative: DynamoDB or another document store can scale public token reads cheaply, but transactional versioning, joins, reporting, and ad hoc operational queries become harder. It is not justified for the expected load.
## 9.2 Logical entity relationships
Organization 1---N Membership N---1 User
Organization 1---N FieldWorker N---N Project through ProjectWorkerAssignment
Organization 1---N Customer 1---N Contact
Organization 1---N Project N---1 Customer
Project      1---N ProjectMember
Project      1---N ChangeOrder 1---N ChangeOrderVersion
Version      1---N LineItem
Version      N---N FileObject through VersionAttachment
Version      1---N ApprovalToken
Version      1---0..1 Decision
Project      1---N AuditEvent
Organization 1---N Message
FieldWorker 1---N IntakeSession 1---N InboundMessage
Organization 1---N Subscription
## 9.3 Core schema
The following DDL is representative rather than a copy-paste-complete migration. Every table also has standard created_at, and mutable tables have updated_at and lock_version.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE membership_role AS ENUM
  ('OWNER','ADMIN','PROJECT_MANAGER','FINANCE','VIEWER');
CREATE TYPE project_status AS ENUM ('ACTIVE','ON_HOLD','CLOSED','ARCHIVED');
CREATE TYPE change_type AS ENUM ('ADDITION','DEDUCTION','SUBSTITUTION','TIME_ONLY');
CREATE TYPE version_status AS ENUM
  ('DRAFT','SENT','VIEWED','REVISION_REQUESTED','APPROVED','DECLINED',
   'EXPIRED','CANCELLED','SUPERSEDED');
CREATE TYPE decision_type AS ENUM ('APPROVE','DECLINE','REQUEST_REVISION');
CREATE TYPE assurance_level AS ENUM ('A0','A1','A2');

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  legal_name text,
  gstin text,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  default_currency char(3) NOT NULL DEFAULT 'INR',
  retention_months integer NOT NULL DEFAULT 36 CHECK (retention_months BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  auth_provider_subject text NOT NULL UNIQUE,
  email_normalized text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role membership_role NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE field_workers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  display_name text NOT NULL,
  phone_e164 text NOT NULL,
  phone_status text NOT NULL DEFAULT 'REGISTERED',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone_e164)
);

CREATE TABLE customers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  display_name text NOT NULL,
  legal_name text,
  notes text,
  search_document tsvector,
  merged_into_customer_id uuid REFERENCES customers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1
);

CREATE TABLE contacts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  name text NOT NULL,
  phone_e164 text,
  email_normalized text,
  is_default_approver boolean NOT NULL DEFAULT false,
  authority_note text,
  whatsapp_opt_in_status text NOT NULL DEFAULT 'UNKNOWN',
  whatsapp_opt_in_at timestamptz,
  whatsapp_opt_in_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (phone_e164 IS NOT NULL OR email_normalized IS NOT NULL)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  project_number text NOT NULL,
  title text NOT NULL,
  site_address_json jsonb,
  status project_status NOT NULL DEFAULT 'ACTIVE',
  currency char(3) NOT NULL,
  timezone text NOT NULL,
  baseline_subtotal_minor bigint NOT NULL,
  baseline_tax_minor bigint NOT NULL,
  baseline_total_minor bigint NOT NULL,
  approved_delta_minor bigint NOT NULL DEFAULT 0,
  revised_total_minor bigint NOT NULL,
  expected_completion_date date,
  retention_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, project_number),
  CHECK (baseline_total_minor = baseline_subtotal_minor + baseline_tax_minor),
  CHECK (revised_total_minor = baseline_total_minor + approved_delta_minor)
);

CREATE TABLE project_worker_assignments (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  field_worker_id uuid NOT NULL REFERENCES field_workers(id),
  can_submit boolean NOT NULL DEFAULT true,
  requires_manager_review boolean,
  assigned_by_user_id uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (project_id, field_worker_id)
);

CREATE TABLE intake_sessions (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id),
  field_worker_id uuid REFERENCES field_workers(id),
  provider_account_id text NOT NULL,
  sender_phone_e164 text NOT NULL,
  state text NOT NULL,
  resolved_project_id uuid REFERENCES projects(id),
  collected_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  lock_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  submitted_change_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inbound_messages (
  id uuid PRIMARY KEY,
  provider text NOT NULL DEFAULT 'META_WHATSAPP',
  provider_account_id text NOT NULL,
  provider_message_id text NOT NULL,
  sender_phone_e164 text NOT NULL,
  intake_session_id uuid REFERENCES intake_sessions(id),
  message_type text NOT NULL,
  normalized_text text,
  provider_media_id text,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id, provider_message_id)
);

CREATE TABLE change_orders (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  number text NOT NULL,
  type change_type NOT NULL,
  current_version_id uuid,
  created_by_actor_type text NOT NULL CHECK (created_by_actor_type IN ('USER','FIELD_WORKER','SYSTEM')),
  created_by_actor_id uuid NOT NULL,
  source_channel text NOT NULL DEFAULT 'DASHBOARD',
  source_intake_session_id uuid REFERENCES intake_sessions(id),
  reversal_of_change_order_id uuid REFERENCES change_orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE TABLE change_order_versions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  change_order_id uuid NOT NULL REFERENCES change_orders(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  status version_status NOT NULL DEFAULT 'DRAFT',
  title text NOT NULL,
  scope_description text NOT NULL,
  reason text,
  schedule_delta_days integer NOT NULL DEFAULT 0,
  revised_completion_date date,
  approver_contact_id uuid NOT NULL REFERENCES contacts(id),
  assurance_required assurance_level NOT NULL DEFAULT 'A0',
  currency char(3) NOT NULL,
  subtotal_delta_minor bigint NOT NULL DEFAULT 0,
  tax_delta_minor bigint NOT NULL DEFAULT 0,
  total_delta_minor bigint NOT NULL DEFAULT 0,
  revised_contract_total_minor bigint,
  canonical_snapshot jsonb,
  canonical_sha256 bytea,
  canonicalizer_version text,
  terms_version text,
  sent_at timestamptz,
  viewed_at timestamptz,
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  UNIQUE (change_order_id, version_number),
  CHECK (total_delta_minor = subtotal_delta_minor + tax_delta_minor),
  CHECK ((status = 'DRAFT' AND canonical_snapshot IS NULL) OR
         (status <> 'DRAFT' AND canonical_snapshot IS NOT NULL))
);

ALTER TABLE change_orders
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id) REFERENCES change_order_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE line_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  version_id uuid NOT NULL REFERENCES change_order_versions(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  description text NOT NULL,
  quantity numeric(18,3) NOT NULL,
  unit text,
  direction smallint NOT NULL CHECK (direction IN (-1, 1)),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  tax_rate_bps integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  subtotal_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  UNIQUE (version_id, position)
);

CREATE TABLE file_objects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  storage_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  declared_mime_type text,
  detected_mime_type text,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 bytea,
  scan_status text NOT NULL DEFAULT 'PENDING',
  storage_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE version_attachments (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  version_id uuid NOT NULL REFERENCES change_order_versions(id),
  file_object_id uuid NOT NULL REFERENCES file_objects(id),
  position integer NOT NULL,
  caption text,
  PRIMARY KEY (version_id, file_object_id),
  UNIQUE (version_id, position)
);

CREATE TABLE approval_tokens (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  version_id uuid NOT NULL REFERENCES change_order_versions(id),
  token_hash bytea NOT NULL UNIQUE,
  approver_contact_id uuid NOT NULL REFERENCES contacts(id),
  assurance_required assurance_level NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  version_id uuid NOT NULL UNIQUE REFERENCES change_order_versions(id),
  type decision_type NOT NULL,
  signer_name text NOT NULL,
  signer_comment text,
  assurance_achieved assurance_level NOT NULL,
  verified_phone_e164 text,
  public_session_id uuid,
  ip_hash bytea,
  user_agent text,
  occurred_at timestamptz NOT NULL,
  receipt_token_hash bytea UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid REFERENCES projects(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  sequence bigint NOT NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  previous_hash bytea,
  event_hash bytea NOT NULL,
  UNIQUE (aggregate_type, aggregate_id, sequence)
);
Supporting operational tables: project_members, baseline_versions, document_sequences, messages, message_events, webhook_inbox, outbox_events, idempotency_records, job_queue, generated_documents, subscriptions, entitlement_counters, payment_intents, otp_challenges, support_access_grants, and data_subject_requests.
## 9.4 Indexing plan
CREATE INDEX projects_org_status_idx
  ON projects (organization_id, status, updated_at DESC);
CREATE INDEX changes_project_created_idx
  ON change_orders (organization_id, project_id, created_at DESC);
CREATE INDEX versions_pending_idx
  ON change_order_versions (organization_id, expires_at)
  WHERE status IN ('SENT','VIEWED');
CREATE INDEX contacts_org_phone_idx
  ON contacts (organization_id, phone_e164);
CREATE INDEX field_workers_phone_active_idx
  ON field_workers (phone_e164, organization_id)
  WHERE status = 'ACTIVE';
CREATE INDEX worker_assignments_active_idx
  ON project_worker_assignments (field_worker_id, project_id)
  WHERE revoked_at IS NULL AND can_submit = true;
CREATE INDEX intake_sessions_sender_active_idx
  ON intake_sessions (provider_account_id, sender_phone_e164, updated_at DESC)
  WHERE state NOT IN ('SUBMITTED','CANCELLED','EXPIRED');
CREATE INDEX customers_search_idx
  ON customers USING gin (search_document);
CREATE INDEX customers_name_trgm_idx
  ON customers USING gin (display_name gin_trgm_ops);
CREATE INDEX audit_aggregate_idx
  ON audit_events (aggregate_type, aggregate_id, sequence);
CREATE INDEX outbox_unpublished_idx
  ON outbox_events (available_at, created_at)
  WHERE published_at IS NULL;
Every high-cardinality tenant query begins with organization_id. Use keyset/cursor pagination, not large offsets.
## 9.5 Data normalization and deduplication
Normalize phones with libphonenumber and store E.164.
Normalize email with trim and lowercase; do not remove dots or plus tags.
Normalize searchable names into a separate unaccented search document without changing display value.
Customer duplicates are suggestions, never automatically merged. Candidate score uses same phone, same normalized email, or high name similarity within a tenant.
Merge preserves source IDs through merged_into_customer_id and emits audit events.
Deduplicate uploaded bytes within an organization by SHA-256 only after scan. Keep separate logical attachment records to preserve filenames and evidence context.
Provider webhooks are deduplicated by provider plus account plus event/message ID.
## 9.6 Auditability, versioning, and corrections
Business data uses explicit domain versions, not generic temporal-table magic. Mutable profiles retain normal update history in audit events. Sent change versions, decisions, and audit events are append-only at the application level, protected by database privileges that deny UPDATE/DELETE to the runtime role.
A separate maintenance role may correct corrupted data only through a documented repair command that:
Requires two-person approval at scale.
Records before/after digests.
Emits an immutable repair event.
Rebuilds affected projections.
Never rewrites the original canonical snapshot or decision.
## 9.7 Storage architecture
Object key pattern:
org/{organizationId}/project/{projectId}/source/{fileId}/{sanitizedFilename}
org/{organizationId}/project/{projectId}/evidence/{versionId}/{documentId}.pdf
org/{organizationId}/exports/{exportId}.zip
Buckets are private. Application issues short-lived signed GET/PUT URLs after authorization. Uploads first enter a quarantine prefix; worker verifies size, magic-byte MIME, image decodability, hash, and malware scan before promotion. Strip EXIF GPS by default from customer-visible derivatives while preserving original bytes when the organization elects evidence retention and the privacy notice covers it.
Enable object versioning. Object Lock/WORM is a production hardening option for generated evidence, not an MVP requirement.
## 9.8 Retention and deletion
“Permanent record” means durable and tamper-evident during the disclosed retention period, not infinite processing. Implement policy fields rather than hard-coding a legal period.
Recommended initial policy pending counsel review:
Drafts abandoned for 180 days: delete after notification.
Raw provider webhook payloads: 90 days; retain normalized events longer.
Application logs: 30 days hot, 90 days archived without approval-link tokens.
Approved evidence: organization policy, default 36 months after project close.
Account deletion: 30-day recovery grace, then purge unless legal hold or contractual necessity applies.
Legal hold: suspends automatic deletion for explicitly scoped projects and is audited.
Before deleting approved evidence, notify the organization and offer export. Data-subject requests are reconciled against contractual evidence requirements rather than blindly deleting shared records.
# 10. External systems and integrations
## 10.1 External-data conclusion
ExtraWork needs no external market dataset, proprietary construction database, crawler, or ongoing scraper. All legally/commercially material project data is entered by the contractor or created by the approval process. This removes data licensing, ingestion, freshness, and cold-start risk.
External systems are replaceable service providers. Each adapter maps provider data into an internal normalized record so provider outages do not corrupt domain state.
## 10.2 Integration inventory
| System | Information/function | Collection and refresh | Validation/reconciliation | Fallback |
| --- | --- | --- | --- | --- |
| WhatsApp Cloud API | Receive employee text/photos/replies; send bot prompts, customer requests/reminders/receipts; delivery/read/failure events | Signed webhook inbox plus outbox sends | Provider account/message IDs, signature, dedupe, status ordering, media hashes, reconciliation | Dashboard manual request/copy link/email; preserve frozen request |
| Email provider | Request and receipt delivery | API plus webhook | Provider ID and bounce/complaint state | Copy link/manual email |
| OTP provider | Phone verification | On-demand challenge | TTL, attempt count, provider delivery ID | A0 link or alternate channel per policy |
| Object storage | Attachments and evidence PDFs | Direct signed upload/download | SHA-256, version ID, scan state | Temporarily disable new uploads; existing cached reads |
| Auth provider | Business identity/session | Webhook plus token/session validation | Subject mapping, membership state | Existing sessions until safe expiry; status page |
| Razorpay/Cashfree | Optional deposit collection | Orders/links plus signed webhook | Signature, amount/currency, event dedupe, fetch reconciliation | Approval remains valid; show payment pending/manual UPI |
| E-sign provider | A2 signing ceremony/certificate | Provider redirect/API plus webhook | Signed artifact digest and provider certificate | A1 or manual process; never downgrade silently |
| Zoho/Tally/Vyapar | Invoice/export handoff | User-triggered API or CSV | External ID, sync status, retry/reconcile | Download CSV/PDF |
| Analytics/error monitoring | Product usage and faults | Client/server events with PII redaction | Event schema and sampling | First-party logs/metrics |

## 10.3 WhatsApp phase design
### Phase 0: concierge validation
Before provider engineering, manually operate the same product contract for a small paid pilot: receive employee messages on a controlled business number, enter/validate the request through an internal console, create the secure customer page, and manually send the customer link. Do not call this automated or scalable; it exists to validate message behavior, request frequency, customer trust, and willingness to pay.
### Phase 1/MVP: central ExtraWork Cloud API number
The production MVP requires Meta's WhatsApp Business Platform/Cloud API or a BSP from the beginning because inbound employee messaging is the primary product interface. A dedicated ExtraWork number receives worker text, images, and interactive replies. The same platform sends approved utility templates to customers and decision/status notifications.
Implement a WhatsAppGateway with methods:
interface WhatsAppGateway {
  verifyWebhook(rawBody: Buffer, headers: Headers): VerifiedWebhook;
  normalizeInbound(input: VerifiedWebhook): ProviderEvent[];
  downloadMedia(providerMediaId: string): Promise<MediaStream>;
  sendSessionMessage(command: SessionMessageCommand): Promise<ProviderMessageRef>;
  sendTemplate(command: SendTemplateCommand): Promise<ProviderMessageRef>;
  fetchTemplateStatus(templateKey: string): Promise<TemplateStatus>;
}
Use pre-approved utility templates such as extra_work_request_v1, extra_work_reminder_v1, and extra_work_decision_receipt_v1. Record the customer communication basis/opt-in, source, and date according to current platform and legal review. Employee replies can use the provider-defined customer-service window; do not assume the window or pricing rules are permanent. Templates, categories, quality limits, API versions, and pricing are provider-controlled configuration rather than embedded domain assumptions.
Webhook lifecycle:
Verify challenge for GET setup.
Read raw bytes and verify provider signature before JSON parsing.
Insert webhook_inbox with unique provider event key.
Return HTTP 200 quickly.
Worker normalizes employee text, interactive replies, media references, customer replies, and delivery states.
Inbound messages enter the intake/session engine; media is downloaded through the provider adapter into quarantine and scanned.
Ignore an older delivery status if it would regress the internal state, but preserve the raw normalized event.
Reconcile queued/accepted messages that remain unresolved beyond a threshold where provider APIs permit.
Sender-resolution rules:
Normalize provider phone identifiers to E.164 and query active worker records across tenants without returning tenant data to the sender.
One active organization and one active project may be inferred. Multiple organizations/projects require deterministic interactive selection.
The employee never supplies a trusted company name; any typed company/project text is only a candidate matched against authorized records.
Reauthorization occurs when the worker presses Send because assignments can change mid-conversation.
Customer delivery rules:
Create and commit the frozen request, token hash, audit event, and outbox event before calling Meta.
A provider send error leaves the request frozen and actionable; it does not revert to an editable draft.
Track queued, provider accepted, delivered, read, and failed separately from request viewed/decided.
Owner fallback exposes copy link/share/email. Record the chosen action honestly; do not infer delivery.
### Phase 2: contractor-owned numbers
For branded sending, use Meta Embedded Signup or a BSP so each business connects its own WhatsApp Business Account and number. This improves sender trust but creates onboarding, template, quality, support, and account-state complexity. Do not implement until central-number pilots show that sender branding or account isolation materially improves conversion, trust, or retention.
## 10.4 Payment architecture
Payments are optional deposits following approval, not part of the validity of the approval. The contractor should be the merchant/seller where provider capabilities permit; ExtraWork should avoid holding customer funds.
Flow:
APPROVED -> contractor requests deposit -> API creates PaymentIntent
         -> worker/provider creates order/link -> customer pays
         -> signed webhook enters inbox -> worker verifies amount/currency
         -> PaymentIntent becomes PAID -> receipt/reference shown
The provider webhook, verified and reconciled, is authoritative. The browser checkout success callback is provisional. Webhook handlers must be idempotent and tolerate out-of-order delivery. A nightly job fetches unresolved provider orders if supported.
## 10.5 Accounting export
Start with CSV and PDF. Define an internal export model:
type ApprovedChangeExport = {
  externalCustomerRef?: string;
  projectRef: string;
  changeNumber: string;
  approvedAt: string;
  currency: string;
  lineItems: Array<{
    description: string;
    quantity: string;
    unitRateMinor: bigint;
    taxRateBps: number;
    totalMinor: bigint;
  }>;
};
Provider-specific adapters map this model to Zoho or other accounting APIs. Store external object ID and last exported snapshot digest. If the change is later reversed, create a new negative export; do not mutate an already issued invoice silently.
## 10.6 AI/ML position
No AI is needed for the core product. Suggested-scope drafting, OCR, duplicate detection, or translation may be tested later, but contractual text must always be reviewed and explicitly accepted by the contractor before send. Never send project photographs, contracts, addresses, or customer data to a model provider without a disclosed data-processing basis and redaction strategy.
# 11. Infrastructure and delivery
## 11.1 Lean MVP deployment
Recommended early topology:
Next.js web on Vercel or Cloudflare-backed managed hosting.
Fastify API as one small managed container on Railway, Render, Fly.io, or Google Cloud Run.
Worker as a second process from the same image.
Managed PostgreSQL from Supabase, Neon, Railway, or a cloud provider.
S3-compatible private object storage.
Managed DNS/CDN/WAF.
GitHub Actions for CI/CD.
Managed error monitoring and uptime checks.
Choose one geography and keep API, database, and object storage co-located. Prefer an Indian region where commercially and operationally available; verify the actual provider region and subprocessors before launch. Do not claim Indian localization is universally legally mandatory.
## 11.2 Environments
| Environment | Purpose | Data rules |
| --- | --- | --- |
| Local | Development and unit/integration tests | Generated fixtures only |
| Preview | Per-PR UI/API review | Ephemeral database or isolated schema; no production data |
| Staging | Provider sandbox, migrations, release verification | Synthetic/pseudonymized data |
| Production | Customer workloads | Restricted access, backups, monitoring |

Use separate provider accounts/keys where possible. Never reuse production WhatsApp, payment, auth, or storage secrets in non-production.
## 11.3 Networking and secrets
TLS 1.2+ at the edge and between managed services where supported.
Database accepts only encrypted connections and is not internet-open except through provider-controlled access rules.
Object storage denies public ACLs.
Secrets live in the deployment provider's encrypted secret manager, not repository or .env files committed to source.
Rotate webhook secrets and API keys; support overlapping key versions during rotation.
Apply CSP, HSTS, X-Content-Type-Options, permissions policy, and frame restrictions.
Public approval links should not load marketing trackers, chat widgets, or third-party fonts.
## 11.4 CI/CD pipeline
Pull request
  -> format/lint/typecheck
  -> unit and property tests
  -> migration lint
  -> integration tests with ephemeral PostgreSQL
  -> build web/api/worker
  -> dependency and secret scan
  -> preview deployment + Playwright smoke
Merge to main
  -> staging migration
  -> staging contract/E2E tests
  -> production backup checkpoint
  -> backward-compatible migration
  -> API/worker rolling deployment
  -> web deployment
  -> post-deploy smoke and metrics gate
Use expand-and-contract database migrations. Add nullable columns/tables first, deploy compatible code, backfill asynchronously, then add constraints/remove old paths in a later release. Never combine a destructive migration with code that assumes it completed everywhere.
## 11.5 Logging and observability
Structured logs include request ID, trace ID, environment, service, route template, status, duration, organization pseudonymous ID, and error code. Exclude plaintext tokens, scope descriptions, phone numbers, addresses, photographs, and signed URLs.
Metrics:
HTTP request rate, error rate, and latency by route class
Approval-page success and decision transaction failure
Database connections, locks, slow queries, replication/backup health
Queue depth, age of oldest job, retry/dead-letter count
PDF generation duration/failure
Provider send and webhook lag
OTP delivery/verification without logging code
Project-total integrity checks
Tracing is optional at very low volume but OpenTelemetry-compatible instrumentation should be used so API-to-worker/provider traces can be enabled without rewrite.
## 11.6 Backups and disaster recovery
Managed PostgreSQL point-in-time recovery when available; otherwise daily encrypted backups from launch.
Daily backup health check and monthly restore rehearsal to an isolated environment.
Object storage versioning and lifecycle policy.
Export infrastructure configuration and migration files in version control.
Keep a current runbook for database loss, object loss, auth-provider outage, provider credential compromise, and incorrect migration.
After restore, run projection rebuild and audit-chain verification before reopening writes.
# 12. Security, privacy, compliance, and governance
## 12.1 Security baseline
Use OWASP ASVS Level 2 as the practical application baseline. Highest-risk surfaces are cross-tenant authorization, bearer approval links, file uploads, webhook forgery, support access, and evidence mutation.
Mandatory controls:
Central authorization service and tenant-scoped repositories
Parameterized SQL and strict schema validation
CSRF protection for cookie-authenticated mutations
Short session lifetime with revocation on membership removal
Opaque public tokens, no token logging, rate limits, and expiry
File type/size allowlist, malware scan, image re-encode for display
Webhook signature verification using raw request body and constant-time compare
Encryption in transit and provider-managed encryption at rest
SAST/dependency/secret scanning
Privileged action reauthentication for ownership, retention, or support access
Append-only evidence tables and separate runtime/maintenance database roles
## 12.2 Threat model
| Threat | Primary mitigation | Residual risk |
| --- | --- | --- |
| Recipient forwards approval link | OTP for A1, display intended approver, record assurance honestly | A0 remains bearer-link assurance |
| Contractor edits approved scope | Frozen snapshot, append-only decision, hash chain, revisions only | Privileged infrastructure compromise |
| Cross-tenant IDOR | Tenant-scoped repositories, authorization middleware, UUIDs, isolation tests | Developer regression; monitor denied access |
| Forged WhatsApp/payment webhook | Provider signature validation, dedupe, raw payload retention | Provider credential compromise |
| Malicious file | Quarantine, MIME/magic-byte validation, scan, private storage | Novel malware; restrict serving headers |
| Token leakage via logs/referrer | Redaction, no-referrer, no third-party scripts, token hashes | User manually forwards link |
| Support employee access | No default content access, time-bound grant, audit | Insider with infrastructure privilege |
| Database operator modifies events | Hash chain, backup comparison, restricted roles, later WORM roots | Hash chain alone does not prove external time |
| OTP abuse | Per-contact/IP limits, cooldown, generic responses | SIM swap or compromised phone |

## 12.3 Privacy design
ExtraWork processes names, phone numbers, email, site address, photographs, contracts, IP-derived data, device metadata, and decisions. Apply purpose limitation and data minimization:
Public page reveals only the project information needed for the decision.
Hash or truncate IP for routine analytics; retain full IP only if counsel approves and it is necessary for evidence.
Separate product analytics from contractual records.
Do not use customer data for model training or advertising.
Make WhatsApp consent and opt-out state explicit.
Offer organization and data-principal workflows for access, correction, export, and erasure.
Maintain a processor/subprocessor register and data-processing terms.
The organization's and ExtraWork's legal roles can vary by processing purpose; counsel must map Data Fiduciary/processor responsibilities. Implement the technical capabilities required by India's Digital Personal Data Protection framework rather than assuming one role for every field.
## 12.4 Electronic records and assent
India's Information Technology Act Section 10A recognizes that a contract is not unenforceable solely because proposal and acceptance were communicated electronically. This does not make every click enforceable. Product language must distinguish:
electronic communication/record of assent;
OTP-supported attribution;
licensed electronic signature under an appropriate provider;
the separate validity of the underlying contract and authority of the approver.
The Bharatiya Sakshya Adhiniyam requirements for electronic records and any certificate/export practice must be reviewed by Indian litigation counsel. The system should retain enough generation and custody metadata to support later certification without claiming the generated PDF itself settles admissibility.
## 12.5 Data governance
Maintain:
Data inventory and classification: public, internal, confidential, restricted
Field-level owner and purpose
Retention rule and deletion implementation
Subprocessor and cross-border transfer record
Access review at least quarterly once staff grow
Incident and breach response runbook
Evidence template and terms version register
Schema migration and repair audit
Customer export format with manifest
Production database access is time-limited and logged. Use pseudonymized support tools. Prohibit direct ad hoc updates; operational corrections use repair commands.
# 13. Reliability and operations
## 13.1 Reliability priorities
The customer decision write path is more important than dashboards, exports, analytics, messaging automation, or payment status. Architect degraded modes around that hierarchy.
| Failure | User behavior | System response |
| --- | --- | --- |
| WhatsApp webhook/send unavailable | Employee intake or customer delivery is delayed | Preserve provider events/jobs idempotently; owner can use dashboard manual request/copy/email; never imply delivery |
| Duplicate/out-of-order WhatsApp event | Same text/photo/reply may arrive again | Inbox uniqueness, session locks, idempotent transitions, monotonic status projection |
| Ambiguous sender/project | Incorrect tenant or project would be dangerous | Prompt explicit organization/project choice; disclose no candidate details to unauthorized sender |
| Email/OTP provider unavailable | Request may still be viewed | A0 may proceed only if policy permits; A1 shows verification unavailable and does not downgrade silently |
| PDF worker unavailable | Decision must still commit | Receipt shows recorded decision; PDF status pending and worker retries |
| Payment provider unavailable | Approval must remain valid | Mark deposit unavailable/pending; provide manual payment instructions if configured |
| Object storage upload unavailable | Draft scope may still be saved | Block send only when required attachment is incomplete |
| Analytics unavailable | No product impact | Drop or buffer noncritical events; never block request |
| Search unavailable | Core records still accessible | Use project/customer lists and direct navigation |
| Database unavailable | No safe write possible | Read-only cached status where safe; decision page clearly says not recorded and retries |
| Stale/superseded link | Customer may attempt decision | Explain replacement; show current link only after safe authorization |

## 13.2 Outbox and inbox patterns
### Transactional outbox
Every external side effect originates as an outbox_events row committed with the domain change:
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  topic text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  leased_until timestamptz,
  published_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
Worker leases, performs the side effect, records provider reference, then marks published. Provider idempotency keys use outbox event ID. A worker crash after provider success but before local acknowledgement may cause a repeat, so adapters must supply provider idempotency where supported or reconcile by external reference.
### Webhook inbox
Verify signature first, then insert raw event with unique provider key. Acknowledge duplicates with HTTP 200. Normalize asynchronously. Keep provider arrival time separately from provider event time and domain occurrence time.
## 13.3 Projection integrity
projects.approved_delta_minor is a materialized projection. Nightly and on-demand integrity jobs recompute:
SELECT project_id, COALESCE(SUM(total_delta_minor), 0)
FROM change_order_versions
WHERE status = 'APPROVED'
GROUP BY project_id;
Compare with project projection. On mismatch:
Mark project INTEGRITY_REVIEW.
Block new sends and evidence regeneration, but preserve reads.
Alert operations.
Rebuild using a controlled repair command.
Record old/new values and cause.
## 13.4 Job semantics
At-least-once execution: all jobs must be idempotent.
Lease: default five minutes; heartbeat for long PDFs/exports.
Timeout: provider call 10-30 seconds; PDF generation two minutes.
Dead-letter: after policy attempts, preserve payload and error code; redact secrets.
Replay: operator may replay one event or bounded batch through an audited command.
Backpressure: pause low-priority reports before approval receipts/reminders.
Job priorities:
Approval receipt/evidence
New request messages
OTP
Reminders
File scans/thumbnails
Reports/exports
Analytics/reconciliation
## 13.5 SLOs and alerting
Initial service-level indicators:
Successful public decision transactions / valid attempts
p95 public request read and decision latency
Age of oldest critical outbox event
PDF generation success within 10 minutes
Automated message accepted/delivered rate
Database error and connection saturation
Backup freshness and restore-test age
Page an operator for sustained decision failures, database unavailability, invalid audit-chain checks, lost backup coverage, or compromised credentials. Create tickets rather than paging for isolated message/PDF failures.
## 13.6 Operational runbooks
At minimum document:
Revoke leaked approval token and issue a new version
Rotate Meta/payment/auth webhook credentials
Replay webhook and outbox events
Repair incorrect project totals
Restore database and verify audit chains
Recover from failed migration
Handle customer deletion/export request
Grant and revoke support access
Respond to suspected cross-tenant disclosure
Freeze one organization without affecting others
# 14. Engineering structure and testing
## 14.1 Recommended stack
| Layer | Recommendation | Reason / tradeoff |
| --- | --- | --- |
| Language | TypeScript, strict mode | Shared contracts and one-team productivity; CPU-heavy work is minimal |
| Web | Next.js, React | SSR for owner dashboard/public routes and strong ecosystem; avoid domain logic in route handlers |
| API | Fastify | Low overhead, schema hooks, explicit server boundary; NestJS is heavier but more prescriptive |
| Contracts | Zod plus generated OpenAPI | Runtime validation and typed client; OpenAPI remains integration contract |
| Database | PostgreSQL 16+ | Transactions, constraints, JSONB, search, queue |
| SQL layer | Drizzle plus explicit SQL | Type safety without hiding locks/constraints; Prisma is easier but less transparent for advanced SQL |
| Jobs | pg-boss or custom SKIP LOCKED | One stateful dependency; BullMQ later for high throughput |
| Files | S3-compatible object store | Cheap, durable, portable |
| PDFs | Versioned HTML/CSS plus Playwright Chromium | Same rendering model as web; heavier worker image |
| Auth | Managed auth | Avoid building password/MFA/recovery flows |
| Tests | Vitest, Testcontainers, Playwright | Unit/property, real database, end-to-end |
| Observability | OpenTelemetry-compatible logs/metrics plus Sentry | Portable instrumentation and fast early debugging |

## 14.2 Repository organization
extrawork/
  apps/
    web/                    # Next.js contractor and public UI
    api/                    # Fastify bootstrap/routes/middleware
    worker/                 # jobs, outbox, scheduler, PDF
  packages/
    domain/
      organizations/
      field-workers/
      customers/
      projects/
      intake/
      change-orders/
      approvals/
      evidence/
      billing/
    application/            # use cases and orchestration
    contracts/              # Zod schemas, API DTOs, error codes
    db/                     # schema, migrations, repositories, transaction unit
    integrations/           # WhatsApp, email, OTP, payment, e-sign adapters
    files/                  # upload and object-store abstractions
    ui/                     # design system
    observability/
    config/
    testkit/
  infra/
    docker/
    terraform-or-provider-config/
    runbooks/
  docs/
    adr/
    openapi/
    threat-model/
Enforce dependency direction:
domain <- application <- API/worker
domain <- repository interfaces <- db implementations
domain <- gateway interfaces <- integration implementations
web -> contracts only; never imports db or server domain internals
## 14.3 Key abstractions
interface UnitOfWork {
  transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

interface ChangeOrderRepository {
  getForUpdate(ctx: TenantContext, id: ChangeOrderId): Promise<ChangeOrder>;
  saveDraft(ctx: TenantContext, aggregate: ChangeOrder, expectedLock: number): Promise<void>;
  insertFrozenVersion(ctx: TenantContext, version: FrozenVersion): Promise<void>;
}

interface IntakeSessionRepository {
  lockOrCreateBySender(tx: TransactionContext, providerAccountId: string,
    senderPhone: string): Promise<IntakeSession>;
  save(tx: TransactionContext, session: IntakeSession,
    expectedLock: number): Promise<void>;
}

interface WorkerAuthorization {
  resolveCandidates(tx: TransactionContext, senderPhone: string): Promise<FieldWorkerCandidate[]>;
  assertCanSubmit(tx: TransactionContext, workerId: string, projectId: string): Promise<void>;
}

interface AuditWriter {
  append(tx: TransactionContext, events: AuditEventInput[]): Promise<void>;
}

interface MessageGateway {
  send(command: OutboundMessage): Promise<ProviderMessageRef>;
  verifyAndParse(raw: Buffer, headers: Record<string,string>): ProviderEvent[];
}

interface ObjectStore {
  createUpload(command: UploadRequest): Promise<PresignedUpload>;
  createDownload(key: string, ttlSeconds: number): Promise<string>;
  head(key: string): Promise<ObjectMetadata>;
}
Domain types such as Money, PhoneNumber, ChangeNumber, AssuranceLevel, and VersionStatus validate at construction. State transitions live in the aggregate, not controllers.
## 14.4 Coding rules
No floating-point money.
No direct database calls from route handlers.
No external provider calls inside database transactions.
No tenant-owned repository method without TenantContext.
No mutation without audit classification.
No provider payload reused as a domain model.
No public token in logs, analytics, exception text, or persistent URLs other than the intended link.
No status update that bypasses aggregate transition validation.
No evidence template change without a new template version and golden tests.
## 14.5 Testing strategy
### Unit tests
Intake state machine, exact-label parsing, project ambiguity, cancel/restart/help, and missing-field prompts
Worker phone/project authorization and send-time reauthorization
Media correlation and late-media handling
Money, tax, rounding, deductions, substitutions, and revised totals
State-transition matrix
Authorization matrix
Canonical JSON and digest stability
Token expiry/revocation and assurance rules
Provider payload mapping and error classification
### Property-based tests
Generate random valid line items and assert:
Sum of line totals equals version totals.
Baseline plus approved deltas equals revised total.
Reordering input object keys does not change canonical hash.
Terminal states never transition except via new aggregate/reversal.
Repeating idempotent command produces one decision and same response.
### Integration tests
Use an ephemeral real PostgreSQL instance:
Transaction rollback and constraints
Row-lock races for approval and send
Tenant isolation for every repository
Outbox atomicity
Job leases/retries
Search indexes and pagination
Migration forward compatibility
Webhook inbox deduplication, session locking, and repeated interactive replies
Cross-tenant worker-phone/project-assignment negative cases
Message-plus-follow-up-photo correlation and expired sessions
### End-to-end tests
Playwright mobile and desktop:
Create organization/customer/project and field-worker assignment.
Inject signed Meta webhook fixtures for employee text, photos, and interactive replies.
Observe missing-field prompt, confirmation, and optional manager review.
Observe frozen request and outbound customer-template job.
Open public link and approve/decline/request revision.
Observe employee/owner/customer notifications, dashboard, and evidence PDF.
Supersede while an old page is open.
Simulate duplicate/out-of-order webhooks, slow network, and duplicate decision tap.
### Security tests
IDOR/cross-tenant corpus
Token enumeration and leakage checks
CSRF/session cookie behavior
Malicious file types and polyglots
Webhook invalid signature/replay/out-of-order
Rate-limit and OTP abuse
Content security policy and dependency scan
### Golden evidence tests
For fixed fixtures, retain canonical JSON, expected digest, rendered PDF text extraction, and page screenshots. A template change requires explicit golden review so a missing price, version, or decision cannot ship unnoticed.
## 14.6 Test environments and provider contracts
Wrap every provider in a contract test suite. Run fast mocks in CI and real sandbox smoke tests on schedule/staging. Store recorded provider fixtures with PII removed. When a provider changes schema, the inbox preserves the raw unknown event while alerting rather than discarding it.
# 15. Development plan, economics, and scaling
## 15.1 Build sequence
### Phase 0: concierge validation, 3-5 days
Build a simple owner console/mobile prototype, receive real employee messages manually on a controlled WhatsApp Business number, and manually generate/send the customer page and PDF. No production automation, billing, or complex auth. Objective: prove the proposed message format, request frequency, customer willingness, and payment.
Exit gate: five live pilots, at least three paying at INR 499 or more, and repeated real requests.
### Phase 1: foundations, week 1
Monorepo, CI, environments, logging
Managed auth and organization membership
PostgreSQL schema/migrations
Tenant-scoped repositories and authorization tests
Customer/project/baseline CRUD
Field-worker records and project assignments
Private file upload skeleton
### Phase 2: WhatsApp ingress and intake, weeks 2-3
Meta app/number configuration, verified webhook, webhook inbox, and provider fixtures
Normalized inbound messages, interactive replies, media download/quarantine
Field-worker/organization/project resolution and authorization
Intake-session state machine, deterministic extraction, missing-field prompts, cancel/restart/help
Employee confirmation and optional manager-review queue
Duplicate/out-of-order webhook and media-correlation tests
### Phase 3: change, delivery, and approval domain, weeks 4-5
Minimal request command, money/tax engine, numbering, and versioning
Frozen canonical snapshot and secure public token
Outbound customer utility template, delivery states, and dashboard manual fallback
Public approval pages
Atomic decisions and race handling
Audit chain and receipt
Decision notifications to employee, owner, and customer
### Phase 4: evidence, dashboard, and production hardening, weeks 6-8
Owner request register, project/change dashboards, search, filters, and exports
PDF evidence worker and golden fixtures
Subscription/entitlement enforcement
File scanning and retention tasks
Backup/restore rehearsal
Security and tenant isolation review
Analytics, SLO dashboards, support tools
Terms/privacy/legal-copy review
Pilot migration and production launch
### P1 after proven usage, weeks 7-12
OTP A1 approval
Automated reminders
Localized templates
CSV/accounting export
Optional UPI deposit
Contractor-owned WhatsApp Embedded Signup only if central-number trust/onboarding demands it
## 15.2 Deliberately deferred
Contractor-owned WhatsApp Embedded Signup
A2 e-signature
Multiple/sequential approvers
Full invoices/GST filing
Native apps
Redis or dedicated event bus
Elasticsearch
WORM/external timestamping
AI drafting/OCR/translation
Multi-region active-active deployment
Public API/marketplace
Each deferral removes a material support, compliance, or infrastructure burden without weakening the initial validation proposition.
## 15.3 Engineering milestones and acceptance gates
| Milestone | Engineering acceptance | Product acceptance |
| --- | --- | --- |
| M0 prototype | Real change can be represented and PDF generated manually | Contractor permits use on a live project |
| M1 project core | Tenant tests pass; project/baseline/worker/assignment CRUD deployed | New business creates first project and employee in under 10 minutes |
| M2 WhatsApp intake | Signed webhook, inbox dedupe, session engine, media correlation, and authorization tests pass | Complete employee request reaches confirmation in under 60 seconds |
| M3 send | Frozen version/hash/token and customer utility-template job work | Confirmed request reaches customer or actionable failure state |
| M4 decision | Concurrent/idempotent tests and mobile E2E pass | At least 70% of viewed requests decide without support |
| M5 evidence | Golden PDF/audit verification passes | Contractors use record in invoice/closeout |
| M6 production | Restore drill, security review, alerts, runbooks pass | Three or more paying pilot organizations retained |

## 15.4 Lean architecture economics
At pilot scale, infrastructure should remain roughly INR 5,000-20,000 per month excluding founder labor and variable provider fees. This is a planning range, not a vendor quote.
Cost-control choices:
Managed auth rather than building account security.
One PostgreSQL database for records, search, queue, and outbox.
One API image and one worker image.
One central Cloud API/BSP number with usage-based template/media fees; defer per-contractor number onboarding.
Direct-to-object-storage uploads to avoid API bandwidth.
On-demand PDFs rather than pre-generating every preview.
PostgreSQL full-text search rather than a search cluster.
Usage-based error monitoring/hosting tiers.
Do not optimize away backups, tenant tests, audit integrity, private storage, or monitoring; those are core product functions, not enterprise polish.
## 15.5 Scaling stages
### Stage A: pilots to 50 organizations
One API instance, one worker, small managed PostgreSQL.
PostgreSQL queue, no Redis.
Central WhatsApp ingress/sending adapter with manual dashboard fallback.
On-demand evidence generation and simple polling.
Manual operational support.
Likely bottleneck: product usage and support, not compute.
### Stage B: 50-1,000 organizations
Horizontally scalable stateless API with connection pooling.
Two or more worker replicas with job leases.
Managed PITR, database metrics, storage lifecycle.
Scale WhatsApp webhook workers/account operations and add OTP where validated.
Read-model tables for dashboards.
Edge rate limiting for public routes.
Likely bottleneck: database connections, PDF worker memory, messaging/account operations.
### Stage C: 1,000-10,000 organizations
Separate PDF/document worker pool.
Redis/BullMQ or managed queue if PostgreSQL jobs create contention.
Partition high-volume audit/message events by month or hash.
Read replica for reporting.
Asynchronous export service and object-storage CDN derivatives.
Provider-routing layer for messaging/OTP resiliency.
Formal on-call, security review, restore drills, support tooling.
Likely bottleneck: message throughput, event volume, large customer exports, support access governance.
### Stage D: 10,000+ organizations
Extract notifications, documents, and integration sync based on measured load.
Managed event bus with schema registry; outbox remains the source.
Dedicated search index only if PostgreSQL search fails measured SLOs.
Regional deployment/read strategy and enterprise tenant isolation options.
WORM evidence storage and external timestamp roots if customer demand justifies.
Data warehouse fed by privacy-filtered change-data capture, never production analytical scans.
The approval write path should remain anchored to one authoritative region per tenant unless a demonstrated availability need justifies distributed consensus.
## 15.6 Migration triggers
| Current choice | Replace when | Replacement |
| --- | --- | --- |
| PostgreSQL jobs | Queue work materially delays OLTP or exceeds measured lease throughput | Managed queue or Redis/BullMQ |
| PostgreSQL search | p95 tenant search misses SLO after index/query tuning | OpenSearch/Meilisearch |
| Single database | Storage/IO/tenant risk exceeds vertical scaling | Read replicas, partitioning, then tenant shards |
| Shared object storage | Enterprise isolation/key requirements emerge | Per-tier bucket/account and customer-managed keys |
| Central WhatsApp sender | Sender trust or contractor branding blocks adoption | Embedded Signup/contractor WABA |
| Managed auth default | Enterprise SSO demand becomes material | SAML/OIDC enterprise add-on |
| Modular monolith | Independent scaling/ownership is evidenced | Extract only the specific module |

# 16. Unresolved decisions and launch gates
## 16.1 Decisions that require field evidence
| Decision | Recommended starting point | Evidence needed |
| --- | --- | --- |
| Subscription versus project pass | Offer both INR 499/month and INR 399/project | Usage frequency and paid conversion |
| Default assurance | A0 for low-risk MVP, optional A1 when available | Customer abandonment versus dispute concern |
| Baseline upload requirement | Optional but show “evidence strength incomplete” | Contractor ability to provide original agreement |
| Default languages | English UI, English/Hindi message templates | City/segment interviews |
| Central ExtraWork number versus contractor-owned numbers | Central number for MVP | Sender trust, Meta onboarding, support burden, contractor branding |
| One-shot syntax versus guided conversation | Support both; infer safely and ask only for missing fields | Completion time, correction rate, worker preference |
| Direct employee send versus manager review | Organization-configurable, direct by default | Owner-control concerns and added latency |
| Photo requirement | Strongly prompted; organization may require | Which request classes need visual evidence |
| Required customer authority field | Named approver plus contractor-entered authority note | Frequency of multi-party approval disputes |

## 16.2 Decisions requiring legal/provider review
Exact approval declaration and disclaimer
Evidence certificate/export format under current Indian evidence law
Retention default and legal-hold policy
Whether and when full IP address retention is proportionate
Data Fiduciary/processor allocation and subprocessor terms
GST display wording and boundary with invoice compliance
Payment structure so ExtraWork does not unintentionally become merchant of record
A2 e-sign provider and representation of its certificate
Meta template classification, opt-in record, and contractor-owned-number onboarding
Whether one central number can support the intended multi-tenant employee workflow under current Meta/BSP policy and quality limits
## 16.3 Launch blockers
Do not launch production until:
Every tenant repository has cross-tenant negative tests.
Approval races and idempotency are proven against real PostgreSQL.
Evidence snapshots and hashes have golden tests.
Files are private and scanned before public display.
Public links are absent from logs, analytics, and referrers.
Backups exist and one restore has been completed.
Monitoring alerts on decision failures and audit-integrity failures.
Legal counsel has reviewed approval copy, privacy/retention, and evidence claims.
A customer can export records even after subscription lapse.
At least three pilot businesses have paid for live use.
A production WhatsApp number, approved customer templates, verified webhook, media ingest, opt-in workflow, and provider failure runbook have passed end-to-end staging tests.
## 16.4 Final engineering recommendation
Build the smallest trustworthy WhatsApp approval pipeline, not a miniature ERP. The unique engineering asset is the combination of phone- and project-authorized employee intake, a deterministic low-friction conversation, canonical change snapshots, no-account customer review, accurately described identity assurance, and a tamper-evident evidence history. WhatsApp is core transport, but provider-specific behavior remains behind an adapter. Payments, e-signature, accounting sync, AI, and broad field approvals remain later modules until paid usage proves value.
# Appendix A. Event catalogue
Core domain events:
organization.created.v1
membership.invited.v1
field_worker.created.v1
field_worker.project_assigned.v1
field_worker.project_revoked.v1
project.created.v1
project.baseline_recorded.v1
project.baseline_amended.v1
intake.session_started.v1
intake.field_recorded.v1
intake.media_received.v1
intake.validation_failed.v1
intake.confirmed.v1
intake.cancelled.v1
intake.expired.v1
change_order.created.v1
change_order.draft_updated.v1
change_order.version_frozen.v1
change_order.sent.v1
approval.request_viewed.v1
approval.otp_sent.v1
approval.phone_verified.v1
approval.decided.v1
change_order.revision_requested.v1
change_order.superseded.v1
change_order.expired.v1
change_order.cancelled.v1
document.evidence_generated.v1
message.send_requested.v1
message.status_changed.v1
payment.requested.v1
payment.status_changed.v1
project.closed.v1
project.export_generated.v1
data.retention_due.v1
data.deleted.v1
support.access_granted.v1
support.access_revoked.v1
integrity.mismatch_detected.v1
integrity.projection_rebuilt.v1
Events are versioned contracts. Add fields compatibly; breaking payload changes require a new event version.
# Appendix B. API command checklist
Every state-changing endpoint must answer:
Who is the actor and organization?
Is the resource loaded through tenant scope?
Is the action authorized?
Is the command schema valid?
Is an idempotency key required?
Is optimistic or pessimistic locking required?
What domain invariant can fail?
What audit event is written?
What outbox side effects follow?
What data must be redacted from logs?
What stable error codes may the client handle?
Can the action be safely retried?
# Appendix C. Source and standards register
Product/market references informing scope:
Government of India, Press Information Bureau, “Unincorporated Construction Sector Comes into Focus,” 10 April 2026: https://www.pib.gov.in/PressReleaseDetail.aspx?PRID=2250808&lang=1&reg=22
Al-Qershi and Kishore, “Claim Causes and Types in Indian Construction Industry - Contractor's Perspective,” 2017: https://pubs.sciepub.com/ajcea/5/5/3/
Deloitte/Autodesk, “State of Digital Adoption in the Construction Industry 2026”: https://www.deloitte.com/au/en/services/economics/perspectives/state-digital-adoption-construction-industry.html
Onsite pricing and product scope: https://onsiteteams.com/onsite-pricing/
Zoho WhatsApp quotation acceptance: https://www.zoho.com/us/billing/help/integrations/whatsapp-integration.html
Beam change-order management: https://www.trybeam.com/change-order-management
Technical/provider references:
Meta WhatsApp Cloud API getting started: https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
Meta WhatsApp webhook overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
Meta WhatsApp Business Platform pricing: https://whatsappbusiness.com/products/platform-pricing/
Razorpay webhook validation and idempotency: https://razorpay.com/docs/webhooks/validate-test/
Legal/privacy references for counsel review:
Information Technology Act, 2000, Section 10A, electronic contracts: https://www.indiacode.nic.in/show-data?actid=AC_CEN_45_76_00001_200021_1517807324077&orderno=14&sectionId=13023&sectionno=10A
Information Technology Act, 2000, Section 5, electronic signatures: https://www.indiacode.nic.in/show-data?actid=AC_CEN_45_76_00001_200021_1517807324077&orderno=6&sectionId=13015&sectionno=5
Digital Personal Data Protection Act, 2023: https://www.meity.gov.in/content/digital-personal-data-protection-act-2023
Digital Personal Data Protection Rules, 2025: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025
Interpretation note: Provider APIs, pricing, policy, and Indian legal commencement/requirements can change. The integration adapters, terms versions, and compliance register are designed so these dependencies can be updated without altering historical evidence.