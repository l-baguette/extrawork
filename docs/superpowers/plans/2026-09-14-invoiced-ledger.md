# Unbilled Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a contractor mark approved extra work as invoiced, and turn the dashboard's "unbilled" tile from a count that can never go down into a rupee figure that does.

**Architecture:** The invoiced mark lives on `change_order_versions` as columns deliberately left outside the freeze guard's allowlist, following the precedent documented for `origin` and `raised_by_employee_id`: provenance, not terms, and outside the canonical snapshot so the digest the customer agreed to never changes. The mutable columns carry current state; two new append-only audit events carry the history of who claimed what.

**Tech Stack:** PostgreSQL 16, Drizzle 0.38, Fastify 5, Zod 3, Next.js 15, Vitest (`unit` and `integration` projects).

**Spec:** `docs/superpowers/specs/2026-09-14-tier-1-pilot-readiness-design.md` (section B)

## Global Constraints

- Money is integer minor units (paise), `bigint` end to end. `parseFloat` and `Math.round` are lint errors in `domain`, `application` and `db`.
- Every repository method takes a `TenantContext` and scopes on `organization_id`. A method without it is a bug.
- `audit_events` and `decisions` are append-only by trigger and by role privilege. Never write an UPDATE or DELETE against them.
- The freeze guard in `0013_critical_integrity_guards.sql:67-85` lists the frozen _terms_ columns explicitly. The new columns must **not** be added to that list, and the migration must say why.
- Any route schema change requires `pnpm openapi`; CI fails on drift.
- The `integration` project needs a real PostgreSQL at `TEST_DATABASE_URL`, runs single-fork, and truncates between tests. Do not add parallelism.
- Run `pnpm verify` before considering the feature done.

---

### Task 1: Schema and audit events

**Files:**

- Create: the next migration in `packages/db/migrations/` (check `ls packages/db/migrations` for the highest number)
- Modify: `packages/db/src/schema/index.ts` (the `changeOrderVersions` definition, near line 366)
- Modify: `packages/contracts/src/events.ts`
- Test: `tests/integration/invoiced-marks.test.ts`

**Interfaces:**

- Produces: `change_order_versions.invoiced_at`, `.invoice_reference`, `.invoiced_by_user_id`; event codes `CHANGE_ORDER_INVOICED` and `CHANGE_ORDER_INVOICE_CLEARED`

- [ ] **Step 1: Write the migration**

```sql
-- Invoiced marks.
--
-- These three columns are bookkeeping about an approved change, not terms of
-- it. They are deliberately NOT added to versions_freeze_guard()'s frozen
-- column list, for the same reason `origin` and `raised_by_employee_id` are
-- not: they sit outside the canonical snapshot, so the digest the customer
-- agreed to does not move when the contractor records that they have billed
-- for the work. The guard's transition rules still apply, so only a version
-- already in a terminal APPROVED state can carry one.
--
-- History lives in the append-only audit chain (change_order.invoiced.v1 and
-- change_order.invoice_cleared.v1), not in these columns, which hold current
-- state only and may be cleared.

ALTER TABLE change_order_versions
  ADD COLUMN invoiced_at timestamptz,
  ADD COLUMN invoice_reference text,
  ADD COLUMN invoiced_by_user_id uuid REFERENCES users(id);

-- A reference without a mark is meaningless, and a mark needs an author.
ALTER TABLE change_order_versions
  ADD CONSTRAINT change_order_versions_invoiced_coherent
    CHECK (
      (invoiced_at IS NULL AND invoice_reference IS NULL AND invoiced_by_user_id IS NULL)
      OR (invoiced_at IS NOT NULL AND invoiced_by_user_id IS NOT NULL)
    );

-- The unbilled total scans approved-and-unmarked rows on every dashboard load.
CREATE INDEX change_order_versions_unbilled_idx
  ON change_order_versions (organization_id, project_id)
  WHERE status = 'APPROVED' AND invoiced_at IS NULL;
```

Mirror the three columns in `packages/db/src/schema/index.ts` so Drizzle does not drift from the SQL.

- [ ] **Step 2: Add the event codes**

In `packages/contracts/src/events.ts`, beside the other `CHANGE_ORDER_*` entries, following the existing `CONSTANT: 'change_order.value.v1'` convention:

```typescript
CHANGE_ORDER_INVOICED: 'change_order.invoiced.v1',
CHANGE_ORDER_INVOICE_CLEARED: 'change_order.invoice_cleared.v1',
```

If that file also maps topics to outbox jobs, do **not** add these to it: marking an invoice sends nothing and schedules nothing.

- [ ] **Step 3: Write the failing test**

Create `tests/integration/invoiced-marks.test.ts`. Use the same harness as `tests/integration/versioning-and-evidence.test.ts` for seeding an approved change order.

```typescript
import { describe, expect, it } from 'vitest';

describe('invoiced marks', () => {
  it('marks an approved version as invoiced with a reference and an author', async () => {
    // Seed an approved version. Mark it with reference 'INV-2026-114'.
    // Assert invoiced_at is set, the reference round-trips, and
    // invoiced_by_user_id is the acting user.
  });

  it('clears a mark without losing the history', async () => {
    // Mark, then clear. Assert the columns are null again and that both
    // change_order.invoiced.v1 and change_order.invoice_cleared.v1 are present
    // in audit_events for that aggregate.
  });

  // The freeze guard permits these columns by design. This test is what keeps
  // that true if somebody later extends the guard's frozen list by reflex.
  it('still refuses a terms edit on the same row', async () => {
    // Mark the version invoiced (must succeed), then attempt to UPDATE
    // total_delta_minor on that row and assert it raises restrict_violation.
  });

  it('refuses a mark on a version that is not approved', async () => {
    // Seed a SENT version and assert the mark is rejected.
  });
});
```

Fill in each body against the real testkit helpers. The comments state the assertion each test must make; a test that does not assert it is not done.

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm db:migrate && pnpm exec vitest run --project integration tests/integration/invoiced-marks.test.ts`
Expected: FAIL — no repository method exists yet.

- [ ] **Step 5: Commit the schema**

```bash
git add packages/db/migrations/ packages/db/src/schema/index.ts packages/contracts/src/events.ts \
  tests/integration/invoiced-marks.test.ts
git commit -m "Record that approved work has been billed, outside the frozen columns"
```

---

### Task 2: Repository, authorization and service

**Files:**

- Modify: `packages/db/src/repositories/change-orders.ts` (beside `markIntakeOrigin`, near line 811)
- Modify: `packages/domain/src/authz/policy.ts` (the `Action` union near line 42, role grants near line 85)
- Modify: `packages/application/src/change-orders/service.ts`
- Test: `tests/unit/authz.test.ts`, `tests/integration/invoiced-marks.test.ts`

**Interfaces:**

- Produces:

  - `ChangeOrderRepository.setInvoiced(tx, ctx, versionId, { reference, userId }): Promise<boolean>`
  - `ChangeOrderRepository.clearInvoiced(tx, ctx, versionId): Promise<boolean>`
  - `Action` gains `'change_order:invoice'`
  - `ChangeOrderService.markInvoiced(ctx, changeOrderId, reference)` and `.clearInvoiced(ctx, changeOrderId)`

- [ ] **Step 1: Add the authorization action**

Add `'change_order:invoice'` to the `Action` union beside the other `change_order:*` entries, then grant it to `OWNER` and `ADMIN` only.

Do **not** grant it to `FINANCE` in this change. FINANCE is currently a deliberately read-only role — it holds no write action at all — and giving it its first one is a separate decision about what that role means, not something to slip in here. Raise it as a question instead of deciding it silently.

Extend the matrix assertions in `tests/unit/authz.test.ts` to cover the new action for every role, following how the existing actions are asserted there.

- [ ] **Step 2: Add the repository methods**

```typescript
/**
 * Records that an approved change has been billed.
 *
 * Deliberately not part of the frozen terms — see the migration comment. The
 * WHERE clause repeats `status = 'APPROVED'` so a race with a status change
 * cannot leave a mark on a version that is no longer approved; the freeze
 * guard would not catch that, because these columns sit outside its list.
 */
async setInvoiced(
  tx: TransactionContext,
  ctx: TenantContext,
  versionId: string,
  input: { reference: string | null; userId: string },
): Promise<boolean> {
  const result = await tx.db.execute(sql`
    UPDATE change_order_versions
       SET invoiced_at = now(),
           invoice_reference = ${input.reference},
           invoiced_by_user_id = ${input.userId}::uuid
     WHERE id = ${versionId}::uuid
       AND organization_id = ${ctx.organizationId}::uuid
       AND status = 'APPROVED'
  `);
  return (result.rowCount ?? 0) > 0;
}

async clearInvoiced(
  tx: TransactionContext,
  ctx: TenantContext,
  versionId: string,
): Promise<boolean> {
  const result = await tx.db.execute(sql`
    UPDATE change_order_versions
       SET invoiced_at = NULL, invoice_reference = NULL, invoiced_by_user_id = NULL
     WHERE id = ${versionId}::uuid
       AND organization_id = ${ctx.organizationId}::uuid
  `);
  return (result.rowCount ?? 0) > 0;
}
```

- [ ] **Step 3: Add the service methods**

In `packages/application/src/change-orders/service.ts`, add `markInvoiced` and `clearInvoiced`. Each one:

1. Calls `authorize(ctx.actor, 'change_order:invoice', { organizationId, projectId })`.
2. Loads the current version through the tenant-scoped repository and rejects with `VALIDATION_FAILED` if its status is not `APPROVED`.
3. In one `uow.transaction`, performs the update and appends the audit event. A `false` return from the repository means the row was not approved after all — throw rather than reporting success.

Follow the decide path in `packages/application/src/approvals/` for the exact `AuditEventInput` shape and the `app.repos.audit.append(tx, ctx, [...])` call. Do not invent an event payload shape.

The payload carries the reference and nothing more. Do not put the rupee amount in it: the amount already lives on the frozen version, and duplicating it into an audit event creates a second figure that can disagree with the first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/authz.test.ts && pnpm exec vitest run --project integration tests/integration/invoiced-marks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/change-orders.ts packages/domain/src/authz/policy.ts \
  packages/application/src/change-orders/service.ts tests/unit/authz.test.ts \
  tests/integration/invoiced-marks.test.ts
git commit -m "Let an owner mark approved work billed, and take it back"
```

---

### Task 3: The endpoints

**Files:**

- Modify: `apps/api/src/routes/change-orders.ts`
- Modify: `packages/contracts/src/api/change-orders.ts`

**Interfaces:**

- Produces: `POST /v1/change-orders/:id/invoicing` with body `{ invoiceReference?: string }`; `DELETE /v1/change-orders/:id/invoicing`; `MarkInvoicedSchema` in contracts

- [ ] **Step 1: Add the request schema**

```typescript
/**
 * The contractor's own invoice number, free text because it comes from
 * whatever software or book they already bill from. It is a label for finding
 * the record later, not a key into anything.
 */
export const MarkInvoicedSchema = z.object({
  invoiceReference: ShortTextSchema.optional(),
});
export type MarkInvoicedInput = z.infer<typeof MarkInvoicedSchema>;
```

- [ ] **Step 2: Add the routes**

In `apps/api/src/routes/change-orders.ts`, following that file's existing route style — the `write` rate limiter, `app.requireAuth`, and `app.requireWrite`:

```typescript
app.post('/v1/change-orders/:id/invoicing', { preHandler: write }, async (request, reply) => {
  const auth = await app.requireAuth(request, reply);
  // A write, so it is gated by the subscription like every other write. A
  // lapsed organization can still read and export its records.
  app.requireWrite(request, 'change_order:invoice');
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const { invoiceReference } = MarkInvoicedSchema.parse(request.body ?? {});
  await app.services.changeOrders.markInvoiced(auth, id, invoiceReference ?? null);
  return reply.status(204).send();
});

app.delete('/v1/change-orders/:id/invoicing', { preHandler: write }, async (request, reply) => {
  const auth = await app.requireAuth(request, reply);
  app.requireWrite(request, 'change_order:invoice');
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  await app.services.changeOrders.clearInvoiced(auth, id);
  return reply.status(204).send();
});
```

Check how `app.requireWrite` is called elsewhere — in `apps/api/src/routes/files.ts` it takes `(request, 'file:upload')` — and match it.

- [ ] **Step 3: Expose the state on reads**

The change-order detail response (the route near line 111 that already assembles line items, attachments, approver, versions and decision) gains:

```typescript
invoicedAt: version.invoicedAt?.toISOString() ?? null,
invoiceReference: version.invoiceReference,
```

Add the same two fields to the corresponding response schema so the UI can show current state without a second call.

- [ ] **Step 4: Regenerate and verify**

Run: `pnpm openapi && pnpm --filter @extrawork/api typecheck`
Expected: no errors; `docs/openapi/openapi.json` gains the two paths.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/change-orders.ts packages/contracts/src/api/change-orders.ts \
  docs/openapi/openapi.json
git commit -m "Expose marking an approved change as invoiced"
```

---

### Task 4: Make the dashboard figure true

The current tile is wrong, not merely thin: `count(DISTINCT project_id) WHERE status = 'APPROVED'` counts every project that has ever had an approved extra, and is labelled "Approved extras not yet invoiced".

**Files:**

- Modify: `packages/db/src/repositories/reporting.ts` (`DashboardData` near line 16, the `dashboard` query near line 28)
- Modify: `packages/contracts/src/api/projects.ts` (`DashboardSchema` near line 161)
- Modify: `apps/web/src/app/(app)/app/dashboard/page.tsx` (the tile near line 96)
- Test: `tests/integration/invoiced-marks.test.ts`

**Interfaces:**

- Produces: `DashboardData` loses `projectsWithUnbilledApprovedExtras` and gains `unbilledApprovedTotalMinor: bigint` and `unbilledApprovedCount: number`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/invoiced-marks.test.ts`:

```typescript
describe('unbilled total', () => {
  it('falls by the value of a change when it is marked invoiced', async () => {
    // Seed two approved changes on one project, +15000 and +8400 rupees.
    // Read the dashboard: unbilledApprovedTotalMinor is 2_340_000 paise and
    // unbilledApprovedCount is 2.
    // Mark the first invoiced. Read again: 840_000 paise and a count of 1.
  });

  it('counts a declined change as neither billed nor unbilled', async () => {
    // A DECLINED version must not appear in the total at all.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project integration tests/integration/invoiced-marks.test.ts`
Expected: FAIL — `unbilledApprovedTotalMinor` does not exist.

- [ ] **Step 3: Replace the query**

In `packages/db/src/repositories/reporting.ts`, replace the `projects_unbilled` sub-select with:

```sql
(SELECT COALESCE(SUM(total_delta_minor), 0) FROM change_order_versions
  WHERE organization_id = ${ctx.organizationId}::uuid
    ${grantFilter}
    AND status = 'APPROVED'
    AND invoiced_at IS NULL)::text AS unbilled_total,
(SELECT count(*) FROM change_order_versions
  WHERE organization_id = ${ctx.organizationId}::uuid
    ${grantFilter}
    AND status = 'APPROVED'
    AND invoiced_at IS NULL)::text AS unbilled_count
```

Map them as `BigInt(row?.unbilled_total ?? '0')` and `Number.parseInt(row?.unbilled_count ?? '0', 10)`, and update `DashboardData` and the row type accordingly. Remove `projectsWithUnbilledApprovedExtras` entirely rather than leaving it beside the new fields — a wrong figure that nothing renders is a trap for the next reader.

Record the known limitation in a comment:

```typescript
// Single-currency by construction: this sums minor units across an
// organization that may in principle hold projects in more than one currency.
// Mixed-currency reporting is a known gap on the Medium remediation list, and
// the figure is labelled with the organization's default currency.
```

- [ ] **Step 4: Update the contract and the tile**

In `packages/contracts/src/api/projects.ts`, replace `projectsWithUnbilledApprovedExtras: z.number().int()` with:

```typescript
unbilledApprovedTotalMinor: z.number().int(),
unbilledApprovedCount: z.number().int(),
```

Minor units cross the wire as `z.number().int()` here to match `approvedValueThisMonthMinor`, its neighbour in the same schema.

In `apps/web/src/app/(app)/app/dashboard/page.tsx`, the tile becomes the rupee figure, formatted with the existing helper in `apps/web/src/lib/format.ts`:

```tsx
<StatTile
  label="Not yet invoiced"
  value={formatMoney(data.unbilledApprovedTotalMinor)}
  note={`${data.unbilledApprovedCount} approved change${data.unbilledApprovedCount === 1 ? '' : 's'}`}
/>
```

Match the actual tile component name and the actual `formatMoney` signature in those files — read both rather than assuming.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run --project integration tests/integration/invoiced-marks.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate and commit**

```bash
pnpm openapi
git add packages/db/src/repositories/reporting.ts packages/contracts/src/api/projects.ts \
  "apps/web/src/app/(app)/app/dashboard/page.tsx" docs/openapi/openapi.json \
  tests/integration/invoiced-marks.test.ts
git commit -m "Show the rupees not yet invoiced, and let the number fall"
```

---

### Task 5: The reports ledger

**Files:**

- Create: `apps/web/src/app/(app)/app/reports/invoice-mark.tsx`
- Modify: `apps/web/src/app/(app)/app/reports/page.tsx`

- [ ] **Step 1: Write the mark control**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

/**
 * Marks one approved change as billed.
 *
 * The reference is optional and free text because it comes from whatever the
 * contractor already bills from. It exists to answer "which invoice was this
 * on?" six months later, which is the question that actually gets asked.
 */
export function InvoiceMark({
  changeOrderId,
  invoicedAt,
  invoiceReference,
}: {
  changeOrderId: string;
  invoicedAt: string | null;
  invoiceReference: string | null;
}): JSX.Element {
  const router = useRouter();
  const [reference, setReference] = useState(invoiceReference ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(method: 'POST' | 'DELETE'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/change-orders/${changeOrderId}/invoicing`, {
        method,
        body: method === 'POST' ? { invoiceReference: reference || undefined } : undefined,
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update the invoiced mark.');
    } finally {
      setBusy(false);
    }
  }

  if (invoicedAt) {
    return (
      <span className="small">
        Invoiced{invoiceReference ? ` · ${invoiceReference}` : ''}{' '}
        <button type="button" className="btn" disabled={busy} onClick={() => void submit('DELETE')}>
          Undo
        </button>
        {error ? <span role="alert"> {error}</span> : null}
      </span>
    );
  }

  return (
    <span className="small">
      <input
        type="text"
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        placeholder="Invoice no. (optional)"
        aria-label="Invoice number"
      />
      <button type="button" className="btn" disabled={busy} onClick={() => void submit('POST')}>
        Mark invoiced
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}
```

- [ ] **Step 2: Render the ledger**

In `apps/web/src/app/(app)/app/reports/page.tsx`, add a section listing approved changes with their value, decision date, and an `<InvoiceMark />` per row, with the unbilled total at the top. Follow the page's existing `serverGet` data-fetching style rather than introducing a client fetch.

- [ ] **Step 3: Verify by hand**

Run: `pnpm dev`, open `http://localhost:3000/app/reports`, mark a change invoiced with a reference, and confirm the dashboard total falls by that change's value and Undo restores it.

- [ ] **Step 4: Full verification**

Run: `pnpm verify`
Expected: format, lint, typecheck and every Vitest project pass. The integration project needs PostgreSQL running.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/app/reports/"
git commit -m "List what is approved and unbilled, with the mark beside it"
```
