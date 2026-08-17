# ExtraWork — Product Brief

**Version 2.0 — 14 August 2026**

## What ExtraWork is

ExtraWork is a WhatsApp-first B2B software service for small Indian contractors and project-based service businesses. It helps a business obtain a customer's documented permission before performing work that falls outside the original project scope.

Instead of relying on calls, scattered WhatsApp messages, memory, or a revised quotation sent after the work is completed, ExtraWork turns a short field message into a clear, project-linked change request. The customer can review and decide from a secure webpage without installing an app or creating an account. ExtraWork then preserves exactly what was proposed, what the customer decided, and when the decision occurred.

The first target customers are small and medium-sized renovation, interior, fit-out, fabrication, electrical, plumbing, painting, HVAC, solar, and installation businesses. The best initial wedge is residential renovation and interiors, where mid-project changes are common and each unapproved change can be financially meaningful.

## The underlying idea

ExtraWork adapts the digital construction “change order” workflow already used in Western contractor software to the way Indian small businesses actually operate:

- WhatsApp is the field interface.
- The owner controls everything from one simple web dashboard.
- Employees need no ExtraWork app or account.
- Customers need no ExtraWork app or account.
- The request is optimized for speed, local pricing, mobile devices, and small-business workflows.

The product is not a construction ERP, accounting system, general e-signature platform, or project-management suite. Its narrow job is to make extra-work authorization fast, clear, attributable, and easy to retrieve later.

## Who uses it

### Business owner or administrator

The paying customer uses one ExtraWork website to:

- Create and manage projects.
- Record the customer and authorized approver for each project.
- Add employees by name and WhatsApp phone number.
- Assign each employee to the projects for which they may submit requests.
- Configure business details, approval language, taxes, branding, and notification preferences.
- View every draft, incomplete, sent, viewed, approved, declined, revision-requested, expired, or cancelled request.
- Open the exact request, approval record, photographs, event history, and evidence PDF.
- Correct a draft or create a new version when a sent request must change.
- Export project change registers and approved extra-work records.

### Field employee

The employee interacts only through WhatsApp. Their registered phone number is their identity for submitting requests; they should not normally have to type the company name.

The fastest one-message submission contains:

1. Project code or project name, unless ExtraWork can infer the employee's only active project.
2. A precise description of the extra work.
3. The reason: customer requested, unforeseen site condition, or contractor recommended.
4. Total additional cost.
5. Time impact: none or a number of additional days.
6. Supporting photographs, strongly encouraged but not universally mandatory.

Example:

```text
EW P-104
Add four concealed electrical points in the master bedroom.
Reason: Customer requested
Cost: 15000
Time: 2 days
[photos attached]
```

ExtraWork also supports a guided conversation. If the employee sends an incomplete or unstructured message, the bot asks only for the missing item instead of forcing the employee to retype everything. Before sending anything to the customer, the bot returns a compact summary and asks the employee to confirm.

### Customer or authorized approver

The customer receives a WhatsApp message identifying the contractor, project, requested change, and a secure ExtraWork link. The linked page shows the exact extra work, price, schedule effect, photographs, revised project total when configured, and approval terms.

The customer can:

- Approve.
- Decline.
- Request a revision and add a short comment.

The customer confirms their name and authority and provides an affirmative action. A drawn signature may be collected as additional evidence, but it is not represented as a government-certified electronic signature. Higher-value requests can later require phone OTP verification or a licensed e-signature provider.

## End-to-end workflow

1. The owner signs up on the website and enters the company's information.
2. The owner creates a project, enters the client/approver's WhatsApp number, and assigns authorized employees.
3. An authorized employee sends the ExtraWork WhatsApp number a short request and photographs.
4. ExtraWork authenticates the sender from the WhatsApp phone number, resolves the company and project, and confirms that the employee is authorized for that project.
5. ExtraWork validates the description, reason, cost, time impact, and attachments. It asks only for missing or ambiguous information.
6. The employee reviews a concise WhatsApp summary and confirms it.
7. ExtraWork creates a numbered, versioned contract-change record using the company's configured template and the project's stored information.
8. ExtraWork freezes that version, creates a secure approval link, and sends the client an approved WhatsApp utility template.
9. The client reviews the request and approves, declines, or requests revision.
10. ExtraWork atomically records the decision, locks the decided version, updates project totals, and generates an evidence PDF.
11. The employee, company owner, and customer receive the appropriate confirmation. The owner can find the record at any time in the dashboard.

The customer page does not disappear after use. It becomes a read-only receipt or status page. Approved and declined versions cannot be silently edited; any correction creates a new linked version or reversal.

## Core product value

ExtraWork helps the contractor establish:

- **What changed:** a specific description tied to an existing project.
- **Why it changed:** customer request, site condition, or recommendation.
- **What it costs:** an explicit amount and applicable tax treatment.
- **What it does to the schedule:** no delay or a defined time impact.
- **Who requested and approved it:** identified employee and intended client approver.
- **Which version was accepted:** a frozen, numbered record.
- **When events occurred:** submission, delivery, view, decision, and document timestamps.
- **What evidence existed:** photographs, message events, decision details, and hashes.

The product strengthens the business's evidence trail and reduces scope and payment disputes. It does not guarantee that every record is legally enforceable. Authority, the original agreement, clarity, consent, applicable tax/stamp requirements, fraud, and other legal issues can still affect enforceability. Indian counsel should approve the customer-facing wording and evidence-export design before commercial launch.

## MVP scope

The first production version includes:

- Owner website onboarding and authentication.
- Company, client, project, employee, and project-assignment management.
- One dedicated ExtraWork WhatsApp intake number.
- Employee phone-number authentication.
- One-shot and guided WhatsApp request creation.
- Text and image ingestion, validation, correlation, and retry handling.
- Configurable approval template with protected mandatory clauses.
- Secure no-account customer approval pages.
- Approve, decline, and request-revision decisions.
- Versioning, audit events, project totals, evidence PDFs, search, and exports.
- WhatsApp confirmations and operational email fallback.
- Security, privacy, retention, logging, backups, and administrative controls.

The MVP deliberately excludes native mobile apps, payroll, attendance, inventory, procurement, scheduling, general accounting, full GST invoicing, AI-generated legal or pricing content, a contractor marketplace, and complex enterprise approval chains.

## Later expansion

Once the extra-work workflow is proven, the same low-friction approval infrastructure can support material substitutions, site instructions, schedule extensions, milestone sign-offs, snag-list completion, handover acceptance, and deposits against approved work. Analytics can later show approval rates, decision time, approved extra-work value, employee/project patterns, and unbilled approvals.

The product should remain an approval layer rather than expanding into a full construction ERP. Its advantage is that it can be explained in minutes, configured quickly, and used from the communication tool employees already understand.
