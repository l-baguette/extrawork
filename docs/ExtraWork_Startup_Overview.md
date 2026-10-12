# ExtraWork — Startup Brief

> Superseded in part by `ExtraWork_Product_Brief_v3.md` (October 2026): the primary user is now the designer or architect; see that document.

_September 2026. Sources: ExtraWork PRD v2.0, Technical Design Report v2.0, August 2026 engineering handoffs._

## 1. What it is

ExtraWork is a WhatsApp-based change-order and approval ledger for small Indian interior-renovation and fit-out contractors, built to turn an out-of-scope work request — normally a phone call or a loose WhatsApp exchange — into a numbered, versioned, timestamped record that the customer explicitly approves, declines, or sends back for revision before the work is billed. The purpose of this product is to streamline and simplify the process of sending and approving requests in construction or other projects, while preventing any potential disputes from the client through rigorous documentation. At the same time, the service operates within the existing Indian infrastructure of WhatsApp, allowing for requests to be sent and accepted without needing on-the-ground employees or construction managers to handle new apps or websites. The goal is minimal friction and confusion for the company owner, the construction leads, and the client regarding any changes or additions to a project.

## 2. The problem

Extra work is authorized informally and rarely recorded in a form that survives a later disagreement: the site lead calls or messages the client, the client agrees, and the crew begins. Five failures follow: ambiguity about scope, price, schedule impact and the approver's authority, plus evidence fragmented across calls, chats, photographs and invoices. A request such as "add four concealed points in the master bedroom, ₹15,000, two days" therefore leaves the contractor holding a chat thread rather than a record, and the cost of the resulting dispute falls on him.

## 3. Target customer

The buyer is the owner or operations manager of an Indian interior-renovation or fit-out firm with 5–30 employees, several concurrent projects, and project values above ₹5 lakh. Adjacent segments include modular-kitchen firms, fabricators, painters, and electrical, plumbing and solar contractors; government contracting, large EPC work and solo tradesmen are excluded. Three parties use it and only the first pays: the owner works from a web dashboard, the field employee submits through WhatsApp alone, and the client approves through a secure link without registering.

## 4. How it works

1. The owner creates a project with its customer and approver, then assigns the employees who may raise requests against it.
2. An employee sends the change, reason, cost, time impact and photographs over WhatsApp, and an incomplete message prompts only for what is missing.
3. ExtraWork matches the sender's number to an authorized employee on that project, asks them to confirm a validated summary, and creates a numbered, versioned change order with totals calculated on the server.
4. The version is frozen and hashed, and the contractor shares a single-use link with the client from their own number.
5. The client reviews the request, price, schedule effect and photographs on a mobile page, then approves, declines or requests a revision.
6. The decision, its audit events and the revised project total commit in one transaction, producing an evidence PDF and a permanent receipt page.

## 5. Current stage

The application is built and runs end to end, comprising an API, a web dashboard, a background worker and one PostgreSQL database. It supports onboarding, project and employee management, change-order versioning, freeze-and-send, the no-account approval page, atomic decisions, evidence PDFs and an append-only audit chain, and the most recent verification run passed 535 of 535 automated tests.

Four items remain before launch. Live WhatsApp is not connected, because the adapter exists in code but the Meta account, templates and webhook are unconfigured. No hosting provider has been selected, billing is modelled but not wired to a payment provider, and Indian counsel has not reviewed the approval wording or evidentiary claims.

## 6. Business model

The contractor pays and the client is never billed. The pricing below is an experiment rather than a settled model, and the open question is whether per-project pricing suits episodic usage better than a subscription.

| Plan         | Price                       | For                 |
| ------------ | --------------------------- | ------------------- |
| Free trial   | First 3 completed decisions | Evaluation          |
| Project Pass | ₹399 per project / 90 days  | Episodic contractor |
| Solo         | ₹499 / month                | Owner-operator      |
| Team         | ₹999–1,499 / month          | Multi-employee firm |
| Pay as used  | ~₹49 per completed decision | Low-frequency user  |

## 7. Market thesis

The segment is attractive because the problem recurs on every project, and one unbilled change on a ₹6 lakh renovation is a meaningful loss for a firm of this size. Adoption requires no new behaviour, since WhatsApp is already the channel these conversations use. India suits the product because it must be priced an order of magnitude below Western change-order software, and the base of small project businesses is large even after discounting the Government of India's count of 10.27 lakh unincorporated construction establishments. The realistic starting base is narrower still: fit-out firms in two or three metros.

## 8. Competition

The status quo is the real competitor; each software alternative fails on cost, scope, or requiring an app.

| Alternative                             | Strength           | Where it fails                                 |
| --------------------------------------- | ------------------ | ---------------------------------------------- |
| Phone call or WhatsApp as-is            | Free and familiar  | Version, authority and retrieval all ambiguous |
| Revised PDF quote                       | Clear document     | Manual, no project ledger                      |
| Billing software (Zoho)                 | Handles acceptance | Treats a change as a new quote                 |
| Western tools (Beam, Houzz Pro, 247Pro) | Mature workflow    | Western pricing, an app for every party        |
| Indian ERPs (Onsite, Powerplay)         | Local fit          | Full implementation for one workflow           |

## 9. Validated versus hypothesis

What is validated is the engineering rather than the market. The workflow runs end to end under a passing test suite, and the commitments that make the record defensible — frozen versions, an append-only audit trail, integer money and atomic decisions — are implemented and tested rather than merely specified. An Indian construction-claims study supports the problem, though it is older and not renovation-specific.

The commercial case remains hypothesis. I have not established willingness to pay, the correct pricing shape, the best sub-segment or city, an acquisition channel beyond founder-led pilots, or retention. Whether a documented approval improves payment outcomes in the field is untested, and the legal weight of the record awaits counsel review.
