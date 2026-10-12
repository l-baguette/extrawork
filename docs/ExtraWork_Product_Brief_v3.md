# ExtraWork — Product Brief

**Version 3.0 — 12 October 2026**

_ExtraWork is still the working name. Whether the product takes an Indian or an
English name is undecided._

## What ExtraWork is

ExtraWork is a simple organisation and management system for interior designers
and architects running residential projects in India, shared with the
construction company that builds the work and the homeowner who pays for it.

Residential interiors and construction still run on phone calls, scattered
WhatsApp threads and memory. Drawings live in one chat, quotes in another, site
photos on somebody's phone, and a change agreed on a call exists only in the
memory of the people on it. ExtraWork gives each project one shared place for
all of it: the customer, the contract value and its history, the timeline, the
people, the drawings, spreadsheets and photos, and one dedicated record of every
change request.

The construction company and the homeowner send requests and files over
WhatsApp with almost no effort. The designer reviews what comes in before
anything reaches the client. A defensible approval record is a real side
benefit, but the core value is organisation and visibility for an unorganised
sector.

## The underlying idea

Everything goes through the designer or architect. They already sit between the
homeowner and the people on site; ExtraWork makes that position the shape of
the software rather than asking anyone to change how they work.

- **Each project is a folder.** Plans and drawings, contracts and quotes, site
  photos, bills, things sent on WhatsApp, and the approvals and change records,
  with each folder visible only to the people it should be.
- **WhatsApp is the channel for everyone who is not the designer.** Site staff
  and homeowners send one message. ExtraWork works out the project, files the
  content or raises the request, tells the designer, and replies with a one-word
  correction in case it guessed wrong.
- **The designer is the only one who changes the record.** Others propose; the
  designer completes, prices and sends, or sets aside.
- **The homeowner never needs an account.** A project link shows them the whole
  record whenever they want it, and each change comes with its own approval
  link.
- **Minimal friction beats feature count.** Nothing is added that makes a site
  supervisor type more or a homeowner sign up.

## Who uses it

### Designer or architect (primary user)

The interior designer or architect, often running several residential projects
at once from a small practice, uses the ExtraWork web app on a laptop or a
phone to:

- Create projects with the customer, address, description, dates, original
  contract value and the first set of drawings.
- Keep each project's files in folders, choose who sees each folder, and link
  to Google Drive, Dropbox or OneDrive folders instead of moving files.
- Review every request that comes in from site, from collaborators or from the
  homeowner; add the room, type of work, price, time impact and justification;
  and send it to the homeowner or dismiss it.
- Turn a pasted WhatsApp message from a contractor into a draft request.
- See every request across every project, sorted by what needs their attention.
- Follow the contract value as changes are approved, and mark approved changes
  as invoiced.
- Keep milestones and completion dates on one timeline across projects, with
  reminders by email or in their phone's calendar.
- Invite people from other firms, add the site team by WhatsApp number, and
  share the homeowner's project link.

The designer's firm owns the workspace. Partners and staff can be owners,
admins, designers (granted specific projects), accounts (read and mark
invoiced) or viewers.

### Construction company

The construction company can use the platform directly, in two ways:

- **As a collaborator** in the designer's workspace: the owner or project lead
  signs in, sees only the projects shared with them, raises requests for the
  designer's review, and uploads files, links and notes. They cannot edit or
  send a request or manage folders.
- **As its own workspace**, for a construction or design-and-build firm that
  runs projects itself. A firm that wants its site team's requests to go
  straight to the homeowner, as in the earlier product, can switch request
  routing to send automatically.

One person can belong to several workspaces and switch between them.

### Site team

Supervisors, foremen and other site staff are identified only by their WhatsApp
number. They never log in. They send text, photos or PDFs about a project; a
message with a price, a time impact or change language becomes a request for
the designer, and anything else is saved to the project's "From WhatsApp"
folder. The same foreman can be on several designers' rosters.

### Homeowner

The homeowner receives a project link with no account and no app. It shows the
project summary, the contract value and its history, every request sent to them
and its status, the approval records, the files the designer has shared with
them, and the milestones. From it they can ask for a change. Each sent request
also has its own approval link, where they approve, decline or ask for a
revision after confirming their name. On WhatsApp they can send requests and
files, and reply "contracts" to get a fresh link to their project.

### Collaborating architecture firm or consultant

An architecture firm, structural consultant or other professional working with
the designer joins as a collaborator with the same access as the construction
company: shared projects only, raise requests, add files.

## End-to-end workflow

1. The designer signs up and gets a free beta workspace.
2. The designer creates a project: customer, address, description, start and
   expected completion, original contract value, and drawings. The project
   starts with default folders.
3. The designer adds the site team by WhatsApp number, invites the construction
   company and any other firms by email, and shares the project link with the
   homeowner.
4. During the work, the site team and the homeowner message the ExtraWork
   WhatsApp number. ExtraWork identifies the sender, works out the project
   (asking once if it cannot tell), and either saves the content to the project
   or raises a request. Collaborators raise requests in the web app; the
   homeowner can also ask from their project page.
5. Every request waits for the designer. It is numbered by project
   (`P-0004-R03` is the third request on project P-0004). The designer
   completes it and sends it, or dismisses it with a reason.
6. Sending freezes the version and gives the homeowner a private approval link.
7. The homeowner approves, declines or asks for a revision. A revision becomes
   a new version; the old link stops working.
8. The decision, its audit events and the updated contract value are recorded
   together, and a PDF of exactly what the homeowner saw and decided is
   generated.
9. The designer's firm marks approved changes as invoiced when they are billed.
10. Throughout, the designer is notified of everything that arrives, the
    timeline shows what is due, and everyone sees the record they are allowed
    to see.

## Core product value

For the designer:

- **One place per project.** Drawings, quotes, photos, notes and WhatsApp
  messages filed under the right project, with the name of whoever added them.
- **Control.** Nothing reaches the client until the designer has checked it.
- **Visibility.** Every request across every project, what is waiting on whom,
  what is due this week, what the contract value is now.
- **Less chasing.** Site staff and homeowners keep using WhatsApp; the designer
  stops being the person who forwards photos between groups.

For the construction company and the homeowner:

- **No new app.** WhatsApp and a link.
- **A clear answer.** The homeowner sees exactly what they are agreeing to, at
  what price and with what delay; the contractor can see where each request
  stands.

The approval record, as a side benefit:

- **What changed, why, where and for how much:** description, justification,
  room, type of work, price and time impact, frozen once sent.
- **Who raised it, who sent it and who decided it,** with timestamps for
  sending, opening and deciding.
- **A downloadable PDF** with a tamper-evident audit trail.

This record is kept so that nobody has to rely on memory. It is not a licensed
or government-recognised electronic signature, and it does not decide whether a
contract is enforceable. Indian counsel should approve the customer-facing
wording before commercial launch.

## MVP scope

The MVP, as designed in the October 2026 spec, includes:

- Designer onboarding, workspaces, and switching between workspaces.
- Projects with customer, address, description, dates, contract value and
  contract-value history.
- Project folders with visibility levels, file upload (images, PDF, Office
  documents, CSV/TXT, DWG/DXF), links and notes, 2 GiB per workspace.
- Collaborators by email invitation, with project-level access.
- Site-team roster by WhatsApp number.
- Requests routed through designer review, numbered per project, with room and
  type of work; dismiss; paste-to-draft; the invoiced mark.
- The existing freeze, send, approve/decline/revise, evidence PDF and audit
  chain, unchanged.
- WhatsApp as a project channel: sender identification across workspaces,
  commands, project resolution, request-or-content classification, one-word
  corrections. Runs in the simulator until live WhatsApp is connected.
- Homeowner project portal with "ask for a change".
- Milestones, a timeline across projects, email reminders and a private
  calendar feed.
- In-app notifications and email preferences.
- A free beta plan for founding firms.

## Later expansion

- **From single projects to firms.** Better tools for practices running many
  projects at once: workload across designers, reports across projects.
- **Deeper file handling** if the beta asks for it: Google Drive sync rather
  than links, in-browser editing, file version history.
- **Phone notifications** beyond the calendar feed.
- **Paid plans** once the beta shows what firms value. Billing code exists and
  stays dormant.
- **An ecosystem** around the projects, possibly a marketplace for parts and
  services, with ads or affiliate links only if they serve the designer.
- **Licensed e-signature** where a customer contract requires it. The existing
  secure-link record and one-time code options are unchanged.

## What it deliberately is not

- Not a construction ERP, accounting system or GST invoicing tool. The invoiced
  mark records that a change was billed; billing happens elsewhere.
- Not a general file-sharing service: a safe allowlist of file types, stored
  privately and downloaded, never rendered in the browser.
- Not a messaging app. WhatsApp stays the conversation; ExtraWork files what
  matters from it.
- Not a licensed e-signature platform.
- Not a scheduling or procurement suite. Milestones and completion dates, not
  Gantt charts or purchase orders.
- Not a native mobile app. The web app works on a phone; everyone else uses
  WhatsApp and links.

## What changed from v2

| v2 (14 August 2026)                                   | v3 (12 October 2026)                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A change-order ledger for small contractors           | An organisation system for designers and architects, with the change record as one part |
| The contractor's owner is the paying customer         | The designer or architect is the primary user; the construction company collaborates    |
| Field employees' requests go straight to the customer | Every request goes through the designer first (automatic sending stays as an option)    |
| WhatsApp is a request form for employees              | WhatsApp is a project channel for site staff and homeowners: requests, files and notes  |
| One employee belongs to one company                   | One person can work with several firms; ambiguity is resolved by asking                 |
| The customer sees one approval page per request       | The homeowner also has a project link showing the whole record                          |
| Projects hold change requests and photos              | Projects hold folders of drawings, quotes, photos, notes and links, plus milestones     |
| Request numbers do not show the project (`CO-0007`)   | Request numbers carry the project (`P-0004-R03`)                                        |
| Paid plans after a short free trial                   | Free for founding firms during the beta; monetisation later                             |
| The legal record is the product                       | Organisation is the product; the legal record is a side benefit and is unchanged        |
