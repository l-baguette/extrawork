<!-- converted from ExtraWork_Product_Requirements_Document_v2.0.docx -->

PRODUCT REQUIREMENTS DOCUMENT
ExtraWork
Owner Dashboard, WhatsApp Employee Intake, and Customer Approval
| Version | 2.0 \| 14 August 2026 |
| --- | --- |
| Status | Implementation-ready MVP product baseline |
| Audience | Founder, product, design, engineering, legal, and pilot partners |

Source-of-truth product decision
The business owner uses one web dashboard. Authorized field employees submit requests through WhatsApp only. Customers receive a WhatsApp message and decide from a secure no-account webpage.
| MVP objective: An owner can set up a project and employee in under ten minutes; an employee can confirm a complete request in under one minute; a customer can decide it in under two minutes. |
| --- |


## Document map
Executive product specification
Problem and opportunity
Users and jobs to be done
Product principles and scope
Complete user experience
Functional requirements
Contract, evidence, and assurance model
Notifications and WhatsApp requirements
Information architecture and reporting
Non-functional requirements
Metrics, pricing, and go-to-market
Release plan, acceptance criteria, and open decisions
# 1. Executive product specification
## 1.1 Product
ExtraWork converts informal requests for work outside an original project agreement into structured, numbered, versioned change requests. The employee should be able to submit a normal request in under one minute from WhatsApp. The customer should be able to understand and decide it in under two minutes from a secure mobile webpage.
The system provides three connected surfaces:
Owner dashboard: company setup, customers, projects, employees, project permissions, request templates, request register, documents, exports, billing, and later analytics.
Employee WhatsApp intake: sender authentication, project resolution, minimal data collection, photographs, validation, correction prompts, confirmation, and status notifications.
Customer approval page: exact frozen request, commercial and time effects, photographs, approval wording, approve/decline/revision actions, and read-only receipt.
## 1.2 Primary customer
The initial buyer is the owner or operations manager of an Indian interior-renovation or turnkey fit-out firm with roughly 5-30 employees, several concurrent jobs, project values commonly above INR 5 lakh, and recurring customer-directed changes.
Adjacent customers include modular-kitchen businesses, fabricators, painters, electrical and plumbing contractors, HVAC and solar installers, repair firms, and other project businesses where field conditions or customer requests change scope after an agreement is signed.
Avoid government contracting, large EPC projects, individual low-value handymen, and businesses that require complex multi-level BOQ approval in the first release.
## 1.3 Value proposition
| Get the customer's documented permission for extra cost and time before work begins, through WhatsApp, without teaching employees or customers another app. |
| --- |

The business gains faster decisions, clearer billing, fewer misunderstandings, a searchable change ledger, and better evidence. The customer gains transparency and a simple way to confirm exactly what is being changed.
## 1.4 Product analogues and differentiation
| Product/workflow | What is reused | What ExtraWork changes |
| --- | --- | --- |
| Beam, Houzz Pro, 247Pro and other change-order tools | Project-linked changes, approval states, evidence, PDF | India pricing, WhatsApp employee intake, no employee/customer app, narrower scope |
| Onsite and Powerplay | Indian construction variation and approval concepts | Standalone micro-SaaS instead of full ERP implementation |
| Zoho estimates/quotes | Mobile customer acceptance and eventual invoicing handoff | Amends an existing project; captures schedule effect, version history, and prior baseline |
| WhatsApp plus PDF/paper | Familiar communication behavior | Authentication, required fields, controlled templates, frozen versions, audit trail, retrieval |

ExtraWork is not based on Cost Plus Drugs or GoodRx; those are examples of the broader localization thesis, not product models for this workflow.
# 2. Problem and opportunity
## 2.1 User problem
Small contractors frequently begin additional work after a customer call or informal WhatsApp exchange. Later, the parties may disagree about whether the work was included, who authorized it, how much it cost, whether it caused delay, or which version was accepted.
The failure has five components:
Scope ambiguity: “I thought this was included.”
Price ambiguity: the work was discussed but the amount or tax was not clear.
Schedule ambiguity: the customer approved the work but later disputes the delay.
Authority ambiguity: a relative, designer, tenant, or site contact requested work without authority.
Evidence fragmentation: scope, photographs, price, approval, and invoice appear in different calls, chats, documents, and devices.
A plain WhatsApp “yes” can be useful evidence but often does not identify the full proposal, exact version, revised price, schedule effect, authorized approver, or original project. ExtraWork must therefore create more structure without becoming slower than WhatsApp.
## 2.2 Evidence that the problem exists
A published contractor-focused Indian construction study ranked extra-work claims as the most frequent claim type in its sample, with owner changes, quantity differences, and scope changes among important causes. The study is older and not limited to small renovators, so it establishes the underlying problem rather than SMB willingness to pay: https://pubs.sciepub.com/ajcea/5/5/3/
The Government of India reported an estimated 10.27 lakh unincorporated construction establishments. This is a broad upper universe, not the serviceable market: https://www.pib.gov.in/PressReleaseDetail.aspx?PRID=2250808&lang=1&reg=22
Deloitte and Autodesk's APAC construction research reported material continued use of paper and incomplete cloud adoption. It supports a digitization gap but is not an India-only microbusiness sample: https://www.deloitte.com/au/en/services/economics/perspectives/state-digital-adoption-construction-industry.html
WhatsApp is already a standard business-communication surface in India. This makes adoption plausible but does not prove willingness to pay for structured approvals.
There is no trustworthy national annual count of Indian extra-work lawsuits. Arbitration may be confidential and court records are not consistently classified by this claim type. The product case must be validated through recent-project interviews and paid pilots, not a fabricated dispute count.
## 2.3 Why current alternatives are insufficient
| Alternative | Strength | Failure ExtraWork addresses |
| --- | --- | --- |
| Call or verbal approval | Fast | No complete attributable record |
| WhatsApp chat | Familiar and free | Context fragmented; ambiguous version, authority, totals, and retrieval |
| Revised PDF/quotation | Clearer commercial document | Manual production, inconsistent follow-up, weak project ledger |
| Google Form | Structured and cheap | Poor contractor workflow, generic presentation, limited version/evidence logic |
| Billing software | Estimate and invoice acceptance | Usually treats request as a new quote rather than an amendment to an active project |
| Construction ERP | Broad capability | Too expensive, complex, and slow for small firms seeking one narrow workflow |

## 2.4 Commercial hypothesis
The buyer will pay INR 499-1,499 per month or INR 399 per active project if ExtraWork documents enough previously unapproved work, reduces conflict, or saves administrative time. The central risk is not buildability; it is whether informal WhatsApp is “good enough” and whether a low-priced product can acquire customers cheaply.
# 3. Users and jobs to be done
## 3.1 Organization owner
Job: Set up the business once, control who can submit requests, monitor all projects and decisions, and retrieve evidence without training field employees on software.
Required capabilities:
Sign up and authenticate.
Enter legal/display name, address, GST/tax preferences, timezone, logo, and contact details.
Select or edit the approval template and mandatory business wording.
Create, edit, close, and archive projects.
Add customers and authorized approvers with WhatsApp-capable phone numbers.
Add employees by name and phone number.
Assign/revoke employees per project.
Set whether an employee may submit directly or requires manager review.
View every request and its current state.
Filter/search by project, employee, customer, status, and date.
Open request history, attachments, delivery events, and evidence PDF.
Create a revision, cancel an undecided request, send reminders, and export records.
Configure notifications and later view analytics.
## 3.2 Administrator or project manager
Job: Operate assigned projects and employees without controlling billing or ownership. Permissions are role- and project-scoped.
## 3.3 Authorized field employee
Job: Request customer authorization immediately from the site with the smallest possible amount of typing.
The employee has no ExtraWork password or application in the MVP. Their WhatsApp phone number is registered by the owner. They can submit only for active projects to which they are assigned.
The employee must supply only:
Project reference, unless safely inferred.
What extra work is required.
Why it is extra.
Total extra cost.
Time impact: none or number of days.
Photographs when relevant; strongly prompted but not always mandatory.
Company, employee identity, customer, approver, date, request number, project totals, terms, template version, and audit information are filled automatically.
## 3.4 Customer/authorized approver
Job: Understand the request and make a clear decision without installing software, creating an account, or deciphering a full construction ERP.
The customer can approve, decline, or request a revision. The customer must see the price and schedule effect before any affirmative decision and must not encounter preselected consent or a hidden decline option.
## 3.5 Finance user
Job: Find approved extras, reconcile them with invoices, and export records. Finance can read approved evidence but cannot rewrite scope or decisions.
## 3.6 ExtraWork support operator
Job: Diagnose delivery or account problems without unrestricted access to customer documents. Content access is disabled by default and, when necessary, time-bound and audited.
# 4. Product principles and scope
## 4.1 Product principles
WhatsApp is the employee interface. No employee app or account is required.
One dashboard is the owner's control plane. Avoid fragmented admin tools.
Infer before asking. Phone number identifies the employee and organization; a sole active project can be inferred.
Ask only for what is missing. Never reject a nearly complete message with a generic “resend correctly.”
Confirm before customer delivery. The employee or configured manager sees a concise summary.
Customer needs no account. A secure link opens a neutral, mobile-first decision page.
Sent versions are frozen. Changes create a revision; approved records are never edited in place.
Use honest legal language. ExtraWork produces a record of assent and evidence; it does not guarantee enforceability.
Remain an approval layer. Do not become a full ERP.
Preserve a fallback. Failed automated delivery must not destroy the underlying request.
## 4.2 MVP scope
P0 requirements:
Owner/admin authentication and onboarding.
Organizations, customers, approvers, projects, employees, and project assignments.
Dedicated ExtraWork WhatsApp Business Platform number.
Inbound message/photo webhook ingestion.
Registered-phone authentication and project authorization.
One-shot parsing plus guided missing-field collection.
Request preview and employee confirmation in WhatsApp.
Optional owner/manager review policy.
Numbered change request, frozen version, secure token, and customer delivery.
Customer approve/decline/request-revision page.
Typed name, authority confirmation, and optional drawn signature evidence.
Status updates and confirmations.
Owner dashboard, search, filters, project register, version history, and evidence PDF.
Private attachment storage, audit events, retention controls, backups, and monitoring.
Operational fallback to copy secure link or resend from dashboard.
## 4.3 Deferred scope
Native employee, owner, or customer mobile apps.
Full estimating, invoicing, GST filing, accounting, payroll, attendance, inventory, procurement, and scheduling.
AI-generated scopes, prices, or legal clauses.
Voice-note transcription until usage proves it is necessary.
Multi-party and sequential customer approvals.
Aadhaar signing or qualified/licensed electronic signature as the default.
UPI deposits, accounting integrations, and customer-owned WhatsApp numbers.
Advanced analytics beyond core operational summaries.
Government and large-enterprise change-order compliance.
# 5. Complete user experience
## 5.1 Owner onboarding
The owner should reach a usable state in under ten minutes.
Create account by email magic link or other managed authentication.
Enter business display name, legal name if different, business phone, location, and timezone.
Select simple tax behavior: price includes tax, price excludes tax, or tax not shown. Advanced line-item tax is hidden.
Review the default approval wording and accept that mandatory legal/privacy clauses cannot be deleted.
Create the first project: project name/code, customer, approver phone, baseline amount if known, and expected end date if useful.
Add an employee's name and WhatsApp number; assign the employee to the project.
Send a WhatsApp activation/instruction message to the employee or display a QR/deep link for the employee to initiate the chat.
Show a test-request walkthrough and dashboard readiness checklist.
## 5.2 Project setup
Required fields:
Project name.
Unique short project code generated by ExtraWork and editable if unique.
Customer display name.
Authorized approver name and E.164 phone number.
Status: active, on hold, closed, or archived.
Recommended but optional:
Site/location.
Baseline contract amount.
Original quotation/contract attachment.
Expected completion date.
Tax treatment.
Customer language.
Authority note, such as owner or company representative.
An employee can be assigned to multiple projects. Revoking an assignment stops new submissions immediately but does not remove historical attribution.
## 5.3 Employee WhatsApp fast path
The system accepts a concise one-shot request. The first line may contain EW and a project code; labels are recommended but the parser tolerates normal text.
EW P-104
Add four concealed electrical points in the master bedroom.
Reason: Customer requested
Cost: 15000
Time: 2 days
Photos can be attached to the same message or immediately following messages in the active intake session.
If the employee has exactly one active assigned project, the project may be inferred and confirmed. The company is inferred from the registered phone. If the phone belongs to workers in more than one organization, ExtraWork prompts a company choice and never guesses.
## 5.4 Employee guided path
If the message is incomplete, ExtraWork preserves all valid information and asks one short question at a time:
ExtraWork: I found project P-104 and the work description. What is the total extra cost?
Employee: 15000
ExtraWork: Will this add time?
[No delay] [+1 day] [+2 days] [Other]
Validation errors must be specific:
“I found two active projects named Whitefield. Reply 1 or 2.”
“The cost needs a number, for example 15000.”
“You are registered with ABC Interiors but are not assigned to P-104. Ask your manager to add you.”
“This project is closed. Your manager can reopen it from the dashboard.”
The system must not ask the employee to retype fields it has already accepted.
## 5.5 Employee confirmation
Before customer delivery, the bot sends:
Ready to send for approval
Project: P-104 — Sharma Residence
Work: Add four concealed electrical points in the master bedroom
Reason: Customer requested
Extra cost: INR 15,000
Extra time: 2 days
Photos: 2

[Send to customer] [Change something] [Cancel]
If organization policy requires manager review, the button creates AWAITING_MANAGER_REVIEW; otherwise it freezes and sends the request. The employee cannot alter company terms or customer details through WhatsApp.
## 5.6 Customer delivery
ExtraWork sends a pre-approved WhatsApp utility template to the recorded approver. The message identifies the contractor and project and contains a secure link. The business must record the customer's WhatsApp communication basis/opt-in as required by current platform rules. If automated sending fails, the owner receives an alert and can copy/share the secure link manually.
No message may claim the request was delivered merely because an API call was queued. Dashboard states distinguish queued, provider accepted, delivered, read where available, and failed.
## 5.7 Customer review and decision
The secure page displays:
Contractor name, logo, and contact.
Project name/code and a minimal location summary.
Request number and version.
Exact change description and reason.
Photographs and captions.
Additional cost, tax presentation, and total.
Time impact and revised completion date if available.
Baseline/revised project total when configured.
Approval declaration and template version.
Expiry time if any.
Approve, Decline, and Request revision with equal clarity.
For approval, require:
Typed name.
Checkbox confirming the person is authorized and approves the displayed work, price, and time impact.
Optional drawn signature if the business enables it.
OTP only when the request policy requires A1 assurance.
A drawn mark is stored as evidence but not called a certified electronic signature. The page must accurately state the achieved assurance level.
## 5.8 Decision completion
The first valid terminal decision wins. On success:
Freeze the decision and revoke the active approval token.
Update the request status.
Apply the price delta to the project's approved-change total if approved.
Generate an evidence PDF asynchronously.
Send the customer a receipt/status message.
Notify the submitting employee and owner/admin.
Keep the customer page available as a read-only receipt.
Decline and revision request do not update approved project totals. A revision request can include a comment; the business creates a new version, and the previous version remains visible as superseded.
## 5.9 Owner request register
The dashboard shows:
Request number and title.
Project/customer.
Submitting employee.
Cost and time impact.
Current version and status.
Created, sent, viewed, and decided timestamps.
Delivery state.
Next required action.
Filters: project, customer, employee, status, date, cost range, and evidence readiness. Search supports request number, project, customer, and description.
# 6. Functional requirements
## 6.1 Organization and settings
| ID | Requirement | Priority |
| --- | --- | --- |
| ORG-01 | Owner can create and edit organization profile | P0 |
| ORG-02 | Owner can configure display/tax/template/notification defaults | P0 |
| ORG-03 | Mandatory approval and privacy clauses cannot be removed | P0 |
| ORG-04 | Every template change creates a version | P0 |
| ORG-05 | Owner can configure direct send versus manager review | P0 |
| ORG-06 | Owner can view plan, limits, and billing status | P1 |

## 6.2 Customers and projects
| ID | Requirement | Priority |
| --- | --- | --- |
| PROJ-01 | Create/edit/archive customer and approver | P0 |
| PROJ-02 | Normalize phone numbers to E.164 and confirm country | P0 |
| PROJ-03 | Create/edit/close/archive project with unique short code | P0 |
| PROJ-04 | Record baseline amount and original agreement attachment | P0, optional fields |
| PROJ-05 | Prevent silent baseline changes after first sent request | P0 |
| PROJ-06 | Track approved delta and revised total deterministically | P0 |
| PROJ-07 | Record WhatsApp opt-in/communication basis and source | P0 |

## 6.3 Employees and authorization
| ID | Requirement | Priority |
| --- | --- | --- |
| EMP-01 | Owner adds employee name and WhatsApp number | P0 |
| EMP-02 | Phone is unique within an organization; cross-org membership is explicit | P0 |
| EMP-03 | Owner assigns/revokes project submission permission | P0 |
| EMP-04 | Unauthorized phone receives a safe registration message without project data | P0 |
| EMP-05 | Employee identity and assignment are rechecked at final send | P0 |
| EMP-06 | Historical requests retain employee attribution after deactivation | P0 |

## 6.4 WhatsApp intake
| ID | Requirement | Priority |
| --- | --- | --- |
| WA-01 | Verify Meta webhook challenge and request signature | P0 |
| WA-02 | Deduplicate inbound messages by provider/account/message ID | P0 |
| WA-03 | Store normalized text/media metadata and minimal raw payload retention | P0 |
| WA-04 | Correlate sequential photos/messages to one intake session | P0 |
| WA-05 | Support one-shot structured and guided conversational intake | P0 |
| WA-06 | Infer company/employee and safe project context before prompting | P0 |
| WA-07 | Preserve valid fields and ask only for missing/ambiguous values | P0 |
| WA-08 | Confirm summary before freezing/sending | P0 |
| WA-09 | Support cancel, restart, help, and inactivity expiry | P0 |
| WA-10 | Handle duplicate/out-of-order webhook delivery idempotently | P0 |
| WA-11 | Support English; configurable Hindi templates later | P1 |
| WA-12 | Voice-note transcription is deferred | P2 |

## 6.5 Request creation and versioning
| ID | Requirement | Priority |
| --- | --- | --- |
| REQ-01 | Require description, reason, price, and time impact before send | P0 |
| REQ-02 | Photos are recommended; policy may make them mandatory | P0 |
| REQ-03 | Generate unique project-scoped request number | P0 |
| REQ-04 | Create deterministic commercial totals in integer paise | P0 |
| REQ-05 | Populate company/project/customer/employee/template data automatically | P0 |
| REQ-06 | Freeze canonical snapshot at send | P0 |
| REQ-07 | Editing after send creates a new version and revokes old link | P0 |
| REQ-08 | Approved/declined versions cannot be edited or deleted in place | P0 |
| REQ-09 | Dashboard can create manual request/revision as operational fallback | P0 |

## 6.6 Customer approval
| ID | Requirement | Priority |
| --- | --- | --- |
| APR-01 | No customer account or installation | P0 |
| APR-02 | Secure opaque token stored only as hash | P0 |
| APR-03 | Show exact frozen version and all decision-critical facts | P0 |
| APR-04 | Approve, decline, and request revision | P0 |
| APR-05 | Typed name and authority/assent checkbox | P0 |
| APR-06 | Optional drawn signature retained with snapshot | P0 optional |
| APR-07 | Optional OTP assurance | P1 or P0 for high-risk pilot policy |
| APR-08 | First terminal decision wins under concurrency | P0 |
| APR-09 | Superseded/expired/decided links show accurate read-only state | P0 |
| APR-10 | Customer can access receipt without exposing dashboard data | P0 |

## 6.7 Evidence, documents, and exports
| ID | Requirement | Priority |
| --- | --- | --- |
| EVD-01 | Append-only material audit events | P0 |
| EVD-02 | Hash canonical snapshot, attachments, and event chain | P0 |
| EVD-03 | Generate versioned evidence PDF after decision | P0 |
| EVD-04 | PDF includes proposal, attachments, decision, assurance, and chronology | P0 |
| EVD-05 | Project change register and CSV/PDF export | P0 |
| EVD-06 | Subscription lapse preserves read/export access to historical evidence | P0 |

# 7. Contract, evidence, and assurance model
## 7.1 Generated document
The generated request is a project amendment/change authorization, not a standalone generic quotation. It should include:
Business legal/display identity and contact.
Customer/approver identity as stored.
Project and original agreement/baseline reference.
Request number, version, and date.
Exact extra work and reason.
Price, tax presentation, schedule impact, and revised total where available.
Photographs/attachments.
Approval declaration, authority statement, exclusions, and template version.
Decision, signer name, assurance level, timestamps, and evidence metadata after completion.
Owner customization is allowed for branding, payment wording, warranty notes, and optional clauses. The system retains protected clauses required for attribution, consent, privacy, versioning, and honest assurance.
## 7.2 Assurance levels
| Level | Evidence | Product representation |
| --- | --- | --- |
| A0 secure-link assent | Link token, recorded destination, typed name, checkbox, timestamp, device/user-agent and proportionate network metadata | Record of assent; bearer-link attribution limits disclosed |
| A1 phone-verified assent | A0 plus OTP to recorded approver number | Phone-verified assent |
| A2 licensed e-signature | External provider ceremony, certificate, and signed artifact | Licensed/provider electronic signature, described according to provider/legal review |

The optional drawn signature does not by itself move a request to A2.
## 7.3 Legal limitation
Section 10A of India's Information Technology Act states that contracts are not unenforceable solely because proposal and acceptance occurred electronically: https://www.indiacode.nic.in/show-data?actid=AC_CEN_45_76_00001_200021_1517807324077&orderno=14&sectionId=13023&sectionno=10A
This does not cure an invalid underlying agreement, lack of authority, unclear scope, coercion, fraud, or required formalities. ExtraWork must never market records as automatically “court-proof” or guaranteed enforceable. Indian contract and evidence counsel must review the template, retention policy, assent ceremony, and evidence export before commercial launch.
# 8. Notifications and WhatsApp requirements
## 8.1 Required messages
Employee activation/help.
Missing information or ambiguity prompt.
Unauthorized/not-assigned response.
Employee preview and send confirmation.
Manager review request when enabled.
Customer new-request utility template.
Customer reminder utility template.
Customer decision receipt/status.
Employee and owner decision notification.
Delivery failure and manual-fallback alert.
## 8.2 Platform requirements
The MVP requires a Meta WhatsApp Business Platform/Cloud API number or an approved Business Solution Provider. Incoming messages arrive through verified webhooks. Media must be downloaded using provider-authorized media URLs, validated, and moved to private storage. Customer-initiated and employee-initiated conversations have provider-defined messaging windows; business-initiated customer messages generally require approved templates. These are operational dependencies, not optional technical polish.
Provider API versions, pricing, template categories, opt-in rules, and quality limits change. ExtraWork must isolate them behind adapters and configuration and revalidate them before launch. Official starting references:
https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
https://whatsappbusiness.com/products/platform-pricing/
## 8.3 Delivery states
Internal states: DRAFT, AWAITING_CONFIRMATION, AWAITING_MANAGER_REVIEW, QUEUED, PROVIDER_ACCEPTED, DELIVERED, READ, FAILED, VIEWED, APPROVED, DECLINED, REVISION_REQUESTED, EXPIRED, CANCELLED, SUPERSEDED.
Messaging delivery state and request decision state are stored separately. A customer can open a copied link even if provider delivery status is unknown.
# 9. Information architecture and reporting
## 9.1 Owner navigation
Dashboard
Requests
Projects
Customers
Employees
Templates
Reports/Exports
Settings
The dashboard prioritizes pending operational action rather than analytics decoration.
## 9.2 Initial dashboard cards
Requests awaiting employee confirmation.
Requests awaiting manager review.
Requests sent and awaiting customer decision.
Delivery failures.
Approved extra-work value this month.
Recent decisions.
Projects with approved but unexported/unbilled changes.
## 9.3 Later analytics
Approval/decline/revision rate.
Median time to customer decision.
Approved extra-work value by month/project/employee.
Average change value and time impact.
Delivery and view conversion.
Requests requiring correction or manager intervention.
Approved changes not exported or marked invoiced.
Analytics are P1/P2 and must not delay the request register or trustworthy evidence.
# 10. Non-functional requirements
## 10.1 Usability
Owner completes first project and employee setup in under ten minutes.
Repeat employee submission reaches confirmation in under 60 seconds when information is complete.
Customer can decide in under two minutes without assistance.
Bot messages are short, explicit, and actionable.
Common failures preserve progress.
## 10.2 Performance and availability
Customer page p75 LCP below 2.5 seconds on typical Indian 4G.
Core API p95 under 500 ms excluding provider and PDF work.
MVP availability target 99.5%; production target 99.9% for approval surface.
Decision write commits before success is displayed.
Messaging, PDF, and analytics failures never roll back a committed decision.
## 10.3 Security
Tenant isolation at every repository and API boundary.
Verified Meta webhook signature and message deduplication.
Registered employee phone plus project assignment authorization.
Public tokens are high-entropy, hashed at rest, scoped, revocable, and absent from logs.
Files are private, size/type validated, malware scanned, and served through short-lived URLs.
Role-based owner/admin/project/finance access.
Append-only decided versions and audit events at runtime-database privilege level.
Rate limits, CSRF protection, secure cookies, secrets management, dependency scanning, and incident runbooks.
## 10.4 Privacy and governance
The service processes phone numbers, names, site details, photographs, contract information, device/network metadata, and decisions. Apply purpose limitation, minimization, retention configuration, export, correction, deletion, and legal-hold workflows. Public pages show only what is needed to make the decision. Do not send customer material to AI providers in the MVP.
The Digital Personal Data Protection Act and 2025 Rules require current legal review and operational mapping of Data Fiduciary/processor responsibilities:
https://www.meity.gov.in/content/digital-personal-data-protection-act-2023
https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025
# 11. Metrics, pricing, and go-to-market
## 11.1 North-star metric
Approved extra-work value documented per active business.
Supporting metrics:
Contact to interview, demo, pilot, and paid conversion.
Owner time to first project/employee/request.
Employee intake completion rate and median completion time.
Percentage completed in one message versus guided prompts.
Requests per active project/business.
Provider delivery, page view, and decision rates.
Median time to decision.
Approved value and self-reported recovered/uncontested value.
30-, 90-, and 180-day retention.
Founder support minutes per organization.
CAC, ARPU, gross margin, and payback.
## 11.2 Pricing experiment
| Plan | Indicative price | Intended user |
| --- | --- | --- |
| Free trial | First 3 completed decisions | Evaluation |
| Project Pass | INR 399 per project/90 days | Episodic contractor |
| Solo | INR 499/month | Owner-operator |
| Team | INR 999-1,499/month | Multi-employee contractor |
| Pay as used | Approximately INR 49/completed decision | Low-frequency business |

Pricing must account for WhatsApp template/media fees, support, storage, and payment costs. The actual experiment should test whether project-based pricing fits episodic usage better than subscription-only pricing.
## 11.3 Validation thresholds
Before a broad production build:
Contact 100 qualified renovation/interior firms.
Complete 30 last-project interviews.
Run at least 5 live concierge pilots.
Obtain at least 3 payments of INR 499 or more.
More than half of activated trials submit at least 3 requests within 30 days.
At least 70% of viewed requests reach a decision without support.
Contractors report that the structured record is meaningfully better than a normal WhatsApp “yes.”
# 12. Release plan, acceptance criteria, and open decisions
## 12.1 Build order
Concierge prototype: dashboard mock, manual WhatsApp intake, generated customer page, and evidence PDF.
Foundation: organizations, users, employees, customers, projects, permissions, templates, audit/outbox.
WhatsApp ingress: verified webhook, message/media normalization, employee/project resolution, session engine.
Intake flow: extraction, guided prompts, confirmation, manager review.
Request engine: numbering, totals, snapshot/version, token, customer page.
Decision engine: concurrency, idempotency, receipts, project projections.
Documents and dashboard: evidence PDF, request register, search, filters, exports.
Hardening: billing/entitlements, privacy, backups, monitoring, restore test, legal/template approval.
## 12.2 MVP acceptance criteria
Owner can create a business, project, approver, employee, and assignment without support.
A message from an unregistered or unauthorized phone cannot create or view project data.
A complete employee request is correctly captured and confirmed in under 60 seconds.
An incomplete request preserves valid information and asks only for missing fields.
Photos sent in the active session attach to the correct request and tenant.
Duplicate/out-of-order webhooks do not create duplicate requests, files, or messages.
The customer receives a valid secure link or the owner receives an actionable failure alert.
The customer can approve, decline, or request revision without an account.
Concurrent decisions produce exactly one terminal result.
Sent and decided versions cannot be edited; revisions revoke the prior link.
Approved totals and evidence PDFs match the exact frozen snapshot.
Every material event is attributable and timestamped.
Historical evidence remains readable/exportable after employee removal or subscription lapse.
Cross-tenant negative tests, backup restore, webhook signature tests, and evidence golden tests pass.
## 12.3 Genuine open decisions
| Decision | Starting recommendation | Validation needed |
| --- | --- | --- |
| Dedicated ExtraWork number vs contractor-owned numbers | One ExtraWork number for MVP | Trust, brand recognition, onboarding friction, Meta constraints |
| One-shot syntax vs fully guided flow | Support both; show guided example at activation | Completion time and field error rate |
| Direct send vs manager review | Configurable per organization, direct by default | Owner control concerns and latency |
| Photo requirement | Strong prompt; owner may make required | Request types where photos add evidence |
| A0 vs OTP A1 default | A0 initially, configurable A1 for high values | Customer abandonment and legal/customer expectations |
| Drawn signature | Optional evidence, not default requirement | Mobile friction and perceived trust |
| Tax/revised total display | Simple organization policy | Contractor practices and customer confusion |
| Customer WhatsApp opt-in process | Capture at project setup with source and date | Counsel/Meta review and pilot workflow |
| English/Hindi/local languages | English first, template localization after interviews | City and segment demand |

## 12.4 Launch blockers
Do not claim production readiness until:
WhatsApp Business account, production number, approved templates, webhook verification, and opt-in process work end to end.
Legal counsel approves approval wording, template customization boundaries, evidence export, privacy notice, and retention.
Cross-tenant and employee-project authorization tests pass.
Decision races, idempotency, duplicate webhooks, and photo correlation are proven using real PostgreSQL.
Public tokens and customer data are excluded from logs and analytics.
Files are private and safely processed.
Backups exist and a restore has been completed.
Monitoring alerts on decision, webhook, queue, delivery, and audit-integrity failures.
Three businesses have paid to use live requests.
## 12.5 Final product recommendation
Build ExtraWork as a narrow, trustworthy WhatsApp approval pipeline. The decisive product advantage is not sophisticated contract drafting; it is removing almost all field friction while preserving a structured, frozen, project-linked record. The owner's dashboard, employee WhatsApp conversation, and customer approval page must work as one system. Everything else should be deferred until it measurably improves activation, decision completion, retention, or revenue.