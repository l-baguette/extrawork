# Paste-to-Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner paste the WhatsApp message their site lead sent them, have it parsed into a prefilled change order, and record which employee raised it — delivering employee intake with no Meta account.

**Architecture:** The intake parser already exists, is forgiving by design, and is unit-tested. It lives in `@extrawork/domain`, which `apps/web` is lint-barred from importing, so the parse happens behind a new read-only API endpoint. The endpoint writes nothing: the owner reviews the reading before anything is created. Attribution reuses the existing `change_order_versions.raised_by_employee_id` column that WhatsApp intake already populates.

**Tech Stack:** Fastify 5, Zod 3, Next.js 15 App Router, Vitest (`unit` and `integration` projects), PostgreSQL 16.

**Spec:** `docs/superpowers/specs/2026-09-14-tier-1-pilot-readiness-design.md` (section C)

## Global Constraints

- `apps/web` may import **only** `@extrawork/contracts`. The parser is in `@extrawork/domain` and must stay server-side.
- Dependency direction is lint-enforced: `domain <- application <- api/worker`.
- Money is integer minor units (paise), `bigint` in the domain. `parseFloat` and `Math.round` are lint errors in `domain`, `application` and `db`. Minor-unit values cross the wire as strings, following `packages/contracts/src/api/common.ts`.
- Any route schema change requires `pnpm openapi`; CI fails on drift.
- The `integration` project needs a real PostgreSQL at `TEST_DATABASE_URL`. It runs single-fork and truncates between tests — do not add parallelism.
- Run `pnpm verify` before considering the feature done.

---

### Task 1: The parse endpoint

**Files:**

- Create: `packages/contracts/src/api/intake.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/routes/intake.ts`
- Modify: `apps/api/src/app.ts` (register the route beside the others)
- Test: `tests/unit/intake-parse-endpoint.test.ts`

**Interfaces:**

- Consumes: `parseIntakeMessage`, `validateIntake`, `matchProject`, `type MatchCandidate`, `type MatchOutcome`, `type ParsedIntake`, `type IntakeValidation` from `@extrawork/domain`
- Produces:
  - `ParseIntakeRequestSchema` — `{ text: string; projectId?: string }`
  - `ParseIntakeResponseSchema` / `ParseIntakeResponseDto`
  - `toParseResponse(parsed, validation, outcome): ParseIntakeResponseDto` — the pure mapping function, exported from `apps/api/src/routes/intake.ts` so it can be unit-tested without a server

`MatchOutcome` is `{ kind: 'MATCHED'; project } | { kind: 'ASSUMED'; project } | { kind: 'AMBIGUOUS'; candidates } | { kind: 'NONE' }`, and `MatchCandidate` is `{ id, projectNumber, title, customerName }`.

- [ ] **Step 1: Write the contracts**

Create `packages/contracts/src/api/intake.ts`:

```typescript
import { z } from 'zod';
import { UuidSchema } from '../primitives.js';

/**
 * Pasting a field message into the dashboard.
 *
 * The same parser that will read a WhatsApp message reads this, so an owner
 * running a pilot before the Cloud API is connected gets the same forgiving
 * behaviour — labels in any order, Hinglish synonyms, "1.5 lakh" — and the
 * same refusal to guess at an ambiguous amount.
 *
 * This endpoint writes nothing. It reads a message and reports what it found.
 */
export const ParseIntakeRequestSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  /** Narrows the project match when the owner has already chosen one. */
  projectId: UuidSchema.optional(),
});
export type ParseIntakeRequest = z.infer<typeof ParseIntakeRequestSchema>;

export const ParsedProjectMatchSchema = z.object({
  kind: z.enum(['MATCHED', 'ASSUMED', 'AMBIGUOUS', 'NONE']),
  projectId: UuidSchema.nullable(),
  projectNumber: z.string().nullable(),
  /** Populated only for AMBIGUOUS, so the owner can choose. */
  candidates: z.array(
    z.object({
      projectId: UuidSchema,
      projectNumber: z.string(),
      title: z.string(),
      customerName: z.string(),
    }),
  ),
});

export const ParseIntakeResponseSchema = z.object({
  description: z.string().nullable(),
  reason: z.string().nullable(),
  /** Integer paise as a decimal string; null when absent or unreadable. */
  amountMinor: z.string().nullable(),
  /** The amount exactly as typed, so the owner can see what was misread. */
  amountRaw: z.string().nullable(),
  days: z.number().int().nullable(),
  project: ParsedProjectMatchSchema,
  /** Fields the owner still has to supply. */
  missing: z.array(z.enum(['company', 'project', 'description', 'reason', 'amount', 'days'])),
  /** Human-readable problems, such as an amount with two defensible readings. */
  problems: z.array(z.string()),
  /** Lines the parser could not attribute to any field. */
  unrecognized: z.array(z.string()),
});
export type ParseIntakeResponseDto = z.infer<typeof ParseIntakeResponseSchema>;
```

Add to `packages/contracts/src/index.ts`, beside the other API exports:

```typescript
export * from './api/intake.js';
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/intake-parse-endpoint.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseIntakeMessage, validateIntake, type MatchOutcome } from '@extrawork/domain';
import { toParseResponse } from '../../apps/api/src/routes/intake.js';

const NO_PROJECT: MatchOutcome = { kind: 'NONE' };

const MATCHED: MatchOutcome = {
  kind: 'MATCHED',
  project: {
    id: '11111111-1111-4111-8111-111111111111',
    projectNumber: 'P-104',
    title: '3BHK interior fit-out',
    customerName: 'Anita Rao',
  },
};

describe('toParseResponse', () => {
  it('reads a complete one-shot message', () => {
    const parsed = parseIntakeMessage(
      [
        'EW P-104',
        'Add four concealed electrical points in the master bedroom.',
        'Reason: Customer requested',
        'Cost: 15000',
        'Time: 2 days',
      ].join('\n'),
    );
    const validation = validateIntake(parsed, { projectResolved: true, requiresProject: true });
    const response = toParseResponse(parsed, validation, MATCHED);

    expect(response.description).toContain('concealed electrical points');
    expect(response.amountMinor).toBe('1500000');
    expect(response.days).toBe(2);
    expect(response.project.kind).toBe('MATCHED');
    expect(response.project.projectNumber).toBe('P-104');
    expect(response.missing).toEqual([]);
    expect(response.problems).toEqual([]);
  });

  // The parser must never pick a number for an ambiguous amount, because a
  // mis-parsed price silently becomes the price in a contract.
  it('reports an ambiguous amount as a problem rather than a figure', () => {
    const parsed = parseIntakeMessage('Extra loft shutter work\nCost: 15-20k');
    const validation = validateIntake(parsed, { projectResolved: true, requiresProject: true });
    const response = toParseResponse(parsed, validation, MATCHED);

    expect(response.amountMinor).toBeNull();
    expect(response.amountRaw).toBe('15-20k');
    expect(response.problems.join(' ')).toContain('could not read the amount');
  });

  it('lists what is missing from a bare message', () => {
    const parsed = parseIntakeMessage('extra work');
    const validation = validateIntake(parsed, { projectResolved: false, requiresProject: true });
    const response = toParseResponse(parsed, validation, NO_PROJECT);

    expect(response.missing).toContain('description');
    expect(response.missing).toContain('project');
    expect(response.missing).toContain('amount');
    expect(response.project.projectId).toBeNull();
  });

  it('offers the candidates when the project name is ambiguous', () => {
    const parsed = parseIntakeMessage('Site: Tower\nRepaint the lobby\nCost: 8000');
    const validation = validateIntake(parsed, { projectResolved: false, requiresProject: true });
    const response = toParseResponse(parsed, validation, {
      kind: 'AMBIGUOUS',
      candidates: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          projectNumber: 'P-101',
          title: 'Tower 3 lobby',
          customerName: 'Mehta Developers',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          projectNumber: 'P-108',
          title: 'Tower 4 lobby',
          customerName: 'Mehta Developers',
        },
      ],
    });

    expect(response.project.kind).toBe('AMBIGUOUS');
    expect(response.project.projectId).toBeNull();
    expect(response.project.candidates).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/intake-parse-endpoint.test.ts`
Expected: FAIL — cannot resolve `intake.js`.

- [ ] **Step 4: Write the route**

Create `apps/api/src/routes/intake.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { ParseIntakeRequestSchema, type ParseIntakeResponseDto } from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import {
  matchProject,
  parseIntakeMessage,
  validateIntake,
  type IntakeValidation,
  type MatchCandidate,
  type MatchOutcome,
  type ParsedIntake,
} from '@extrawork/domain';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * Reads a pasted field message.
 *
 * Deliberately a read: it creates nothing, so a double-click or a retry cannot
 * produce two change orders. The owner reviews what was read, corrects it in
 * the composer, and the ordinary create path applies every server-side rule as
 * usual.
 */
export function toParseResponse(
  parsed: ParsedIntake,
  validation: IntakeValidation,
  outcome: MatchOutcome,
): ParseIntakeResponseDto {
  const resolved =
    outcome.kind === 'MATCHED' || outcome.kind === 'ASSUMED' ? outcome.project : null;

  return {
    description: parsed.description,
    reason: parsed.reason,
    amountMinor: parsed.amountMinor === null ? null : parsed.amountMinor.toString(),
    amountRaw: parsed.amountRaw,
    days: parsed.days,
    project: {
      kind: outcome.kind,
      projectId: resolved?.id ?? null,
      projectNumber: resolved?.projectNumber ?? null,
      candidates:
        outcome.kind === 'AMBIGUOUS'
          ? outcome.candidates.map((candidate) => ({
              projectId: candidate.id,
              projectNumber: candidate.projectNumber,
              title: candidate.title,
              customerName: candidate.customerName,
            }))
          : [],
    },
    missing: validation.missing,
    problems: validation.problems,
    unrecognized: parsed.unrecognized,
  };
}

function matchedById(candidates: readonly MatchCandidate[], projectId: string): MatchOutcome {
  const project = candidates.find((candidate) => candidate.id === projectId);
  return project ? { kind: 'MATCHED', project } : { kind: 'NONE' };
}

export async function registerIntakeRoutes(
  app: FastifyInstance,
  _appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });

  app.post('/v1/intake/parse', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const input = ParseIntakeRequestSchema.parse(request.body);

    const parsed = parseIntakeMessage(input.text);

    // Match against the projects this tenant actually has. Listing through the
    // tenant-scoped repository is what keeps a pasted project name from
    // resolving to somebody else's site.
    const projects = await app.repos.projects.listForMatching(auth.tenant);
    const candidates: MatchCandidate[] = projects.map((project) => ({
      id: project.id,
      projectNumber: project.projectNumber,
      title: project.title,
      customerName: project.customerName,
    }));

    const outcome: MatchOutcome = input.projectId
      ? matchedById(candidates, input.projectId)
      : matchProject(parsed.project, candidates);

    const validation = validateIntake(parsed, {
      projectResolved: outcome.kind === 'MATCHED' || outcome.kind === 'ASSUMED',
      requiresProject: true,
    });

    return reply.send(toParseResponse(parsed, validation, outcome));
  });
}
```

If `app.repos.projects` has no `listForMatching`, use whatever listing method it already exposes and map its rows. Read `packages/db/src/repositories/projects.ts` first — do not add a repository method if an existing one serves, and if you do add one it must take a `TenantContext` like every other method on that repository.

Register it in `apps/api/src/app.ts` alongside the other `register*Routes` calls.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit tests/unit/intake-parse-endpoint.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Regenerate OpenAPI and commit**

```bash
pnpm openapi
git add packages/contracts/src/api/intake.ts packages/contracts/src/index.ts \
  apps/api/src/routes/intake.ts apps/api/src/app.ts \
  tests/unit/intake-parse-endpoint.test.ts docs/openapi/openapi.json
git commit -m "Read a pasted field message with the parser intake already uses"
```

---

### Task 2: Attribution to the employee who raised it

**Files:**

- Modify: `packages/contracts/src/api/change-orders.ts` (`CreateChangeOrderSchema`, near line 32)
- Modify: `packages/application/src/change-orders/service.ts` (the create path)
- Modify: `packages/db/src/repositories/change-orders.ts` (`markIntakeOrigin`, near line 811)
- Create: the next migration in `packages/db/migrations/`
- Test: `tests/integration/paste-attribution.test.ts`

**Interfaces:**

- Consumes: `CreateChangeOrderInput` from `@extrawork/contracts`
- Produces: `CreateChangeOrderInput` gains `raisedByEmployeeId?: string`; persisted to `change_order_versions.raised_by_employee_id` with `origin = 'PASTED'`

- [ ] **Step 1: Write the migration**

The `origin` column was added by `0005_whatsapp_intake.sql:144-145` as
`text NOT NULL DEFAULT 'WEB' CHECK (origin IN ('WEB', 'WHATSAPP', 'IMPORT'))`.
Confirm the real constraint name first:

```bash
psql "$DATABASE_URL" -c "\d change_order_versions" | grep -i origin
```

Then create the next migration in sequence (`ls packages/db/migrations` for the
highest number, use the one after it):

```sql
-- A pasted request is neither typed from scratch in the dashboard nor received
-- over WhatsApp. Recording it as 'WEB' would make the two indistinguishable in
-- reports, and the point of attribution is being able to say which site lead
-- raised what.

ALTER TABLE change_order_versions
  DROP CONSTRAINT IF EXISTS change_order_versions_origin_check;

ALTER TABLE change_order_versions
  ADD CONSTRAINT change_order_versions_origin_check
    CHECK (origin IN ('WEB', 'WHATSAPP', 'IMPORT', 'PASTED'));
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/paste-attribution.test.ts`. Follow the harness used by
`tests/integration/intake-service.test.ts` for seeding an organization, project
and employee — do not invent a new fixture style.

```typescript
import { describe, expect, it } from 'vitest';

describe('pasted change order attribution', () => {
  it('records the employee who raised it and marks the origin as pasted', async () => {
    // Seed an org, a project, and an employee assigned to that project.
    // Create a change order through the normal create path with
    // raisedByEmployeeId set to that employee.
    // Assert change_order_versions.raised_by_employee_id equals that employee
    // and origin = 'PASTED'.
  });

  // Attribution is evidence, not decoration: claiming a site lead raised
  // something they had no access to would be worse than no attribution.
  it('refuses an employee who is not assigned to that project', async () => {
    // Seed an employee assigned to project A, create against project B naming
    // that employee, and assert the call is rejected.
  });

  it('leaves origin as WEB when no employee is named', async () => {
    // The ordinary composer path must be unchanged.
  });
});
```

Fill in each body against the actual testkit helpers. The comments state the
assertion each test must make; a test that does not assert it is not done.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run --project integration tests/integration/paste-attribution.test.ts`
Expected: FAIL — `raisedByEmployeeId` is not accepted.

- [ ] **Step 4: Extend the schema, repository and service**

In `packages/contracts/src/api/change-orders.ts`, add to `CreateChangeOrderSchema`:

```typescript
/**
 * The site employee who raised this, when the owner is recording a request
 * that reached them over WhatsApp. Provenance, not a term: it stays outside
 * the canonical snapshot, exactly as the WhatsApp intake path treats it.
 */
raisedByEmployeeId: UuidSchema.optional(),
```

In `packages/db/src/repositories/change-orders.ts`, generalise `markIntakeOrigin`
to take the origin value rather than hardcoding `'WHATSAPP'`, keeping its
existing doc comment about provenance-not-terms intact:

```typescript
async markIntakeOrigin(
  tx: TransactionContext,
  ctx: TenantContext,
  versionId: string,
  employeeId: string,
  origin: 'WHATSAPP' | 'PASTED' = 'WHATSAPP',
): Promise<void> {
```

with the SQL using `SET origin = ${origin}`. Update the one existing caller in
the intake path to pass `'WHATSAPP'` explicitly rather than relying on the
default, so the value is visible at both call sites.

In the create path in `packages/application/src/change-orders/service.ts`, when
`raisedByEmployeeId` is present:

1. Load the employee through the tenant-scoped repository.
2. Assert the employee is assigned to this project. Reuse the grant logic in
   `packages/application/src/employees/service.ts` — `resolveProjectIds` around
   line 182 — rather than writing a second copy. Reject with `FORBIDDEN` if not.
3. Inside the same transaction as the create, call `markIntakeOrigin(..., 'PASTED')`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm db:migrate && pnpm exec vitest run --project integration tests/integration/paste-attribution.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
pnpm openapi
git add packages/contracts/src/api/change-orders.ts packages/application/src/change-orders/service.ts \
  packages/db/src/repositories/change-orders.ts packages/db/migrations/ \
  tests/integration/paste-attribution.test.ts docs/openapi/openapi.json
git commit -m "Record which site lead raised a pasted request"
```

---

### Task 3: The paste card

**Files:**

- Create: `apps/web/src/app/(app)/app/requests/paste-message.tsx`
- Modify: `apps/web/src/app/(app)/app/requests/page.tsx`

**Interfaces:**

- Consumes: `ParseIntakeResponseDto` from `@extrawork/contracts`; `api`, `ApiError` from `@/lib/api`; the draft-store helpers from `@/features/composer/draft-store`
- Produces: `<PasteMessage projects employees />`

- [ ] **Step 1: Check the draft store's key convention**

Run: `sed -n '1,60p' apps/web/src/features/composer/draft-store.ts`
The composer reads its local draft by a key derived from the project. Use the
same helper to write the prefilled draft; do not construct that key by hand in
a second place.

- [ ] **Step 2: Write the component**

Create `apps/web/src/app/(app)/app/requests/paste-message.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ParseIntakeResponseDto } from '@extrawork/contracts';
import { api, ApiError } from '@/lib/api';

/**
 * Turns a forwarded WhatsApp message into a prefilled change order.
 *
 * This is the same parser the live WhatsApp intake will use, on the same page
 * inbound requests will land on, so the two converge rather than becoming two
 * ways of doing one thing. It creates nothing: the owner sees what was read,
 * fixes what was wrong, and the ordinary composer applies every server rule.
 */
export function PasteMessage({
  projects,
  employees,
}: {
  projects: Array<{ id: string; projectNumber: string; title: string }>;
  employees: Array<{ id: string; name: string; role: string | null }>;
}): JSX.Element {
  const router = useRouter();
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [result, setResult] = useState<ParseIntakeResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function parse(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<ParseIntakeResponseDto>('/v1/intake/parse', {
          method: 'POST',
          body: { text, projectId: projectId || undefined },
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not read that message.');
    } finally {
      setBusy(false);
    }
  }

  const resolvedProjectId = projectId || result?.project.projectId || '';

  return (
    <section className="card" aria-labelledby="paste-heading">
      <h2 id="paste-heading">Paste a message</h2>
      <p className="small muted">
        Paste what your site lead sent you. Anything it cannot read, you fill in next.
      </p>

      <label className="field">
        <span>Message</span>
        <textarea
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            'EW P-104\nAdd four concealed points, master bedroom\nCost: 15000\nTime: 2 days'
          }
        />
      </label>

      <label className="field">
        <span>Project</span>
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">Work it out from the message</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.projectNumber} · {project.title}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Raised by</span>
        <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
          <option value="">Not recorded</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
              {employee.role ? ` · ${employee.role}` : ''}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn"
        disabled={busy || text.trim().length === 0}
        onClick={() => void parse()}
      >
        {busy ? 'Reading' : 'Read this message'}
      </button>

      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="banner" role="status">
          <p>
            <strong>Read:</strong> {result.description ?? 'no description'}
            {result.amountMinor
              ? ` · ₹${(Number(result.amountMinor) / 100).toLocaleString('en-IN')}`
              : ''}
            {result.days === null ? '' : ` · ${result.days} days`}
          </p>
          {result.problems.map((problem) => (
            <p key={problem} className="small">
              {problem}
            </p>
          ))}
          {result.missing.length > 0 ? (
            <p className="small muted">You will need to add: {result.missing.join(', ')}.</p>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={!resolvedProjectId}
            onClick={() => {
              // Hand the reading to the composer through the local draft store
              // the composer already restores from, rather than inventing a
              // second prefill mechanism in the query string.
              stashDraft(resolvedProjectId, result, employeeId);
              router.push(`/app/projects/${resolvedProjectId}/changes/new`);
            }}
          >
            Open in composer
          </button>
          {!resolvedProjectId ? (
            <p className="small muted">Choose a project before opening the composer.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
```

Implement `stashDraft` in this file using the draft-store helpers from Step 1. It
writes a `ComposerValues`-shaped draft with `title` from the first line of the
description, `scope` from the description, `reason`, `scheduleDeltaDays` from
`days`, and `raisedByEmployeeId`. Leave `lineItems` empty and show the parsed
amount to the owner rather than fabricating a line item — the parsed figure is a
total, and inventing a quantity and unit price to reach it would be guessing at
the commercial detail the server is authoritative about.

- [ ] **Step 3: Render it on the requests page**

In `apps/web/src/app/(app)/app/requests/page.tsx`, fetch the project and employee
lists with the existing `serverGet` helper (`GET /v1/projects` and
`GET /v1/employees`, both of which already exist) and render
`<PasteMessage projects={...} employees={...} />` above the existing inbound list.

- [ ] **Step 4: Verify by hand**

Run: `pnpm dev`, open `http://localhost:3000/app/requests`, paste the four-line
example, and confirm the reading is correct and "Open in composer" lands on a
prefilled composer.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/app/requests/"
git commit -m "Let an owner paste what the site lead sent, instead of retyping it"
```

---

### Task 4: Carry the attribution through the composer

**Files:**

- Modify: `apps/web/src/features/composer/schema.ts`
- Modify: `apps/web/src/features/composer/composer.tsx`

- [ ] **Step 1: Add the field to the form schema**

In both `ComposerSchema` and `StoredComposerSchema`, add:

```typescript
raisedByEmployeeId: z.string().optional(),
```

and to `EMPTY_COMPOSER`:

```typescript
raisedByEmployeeId: undefined,
```

`StoredComposerSchema` must accept it, or the stashed draft is rejected as a
stale shape and the prefill silently vanishes — the failure mode is a composer
that opens empty with no error, which is the hardest kind to diagnose.

- [ ] **Step 2: Send it**

In `toApiPayload`, include `raisedByEmployeeId` so the create call carries it. It
is create-only: `UpdateDraftSchema` does not accept it, because provenance is set
once when the record is born.

- [ ] **Step 3: Show it in step 3**

Render a read-only line in step 3 ("Time and approver") naming who raised this
when the value is set, so the owner sees the attribution before sending rather
than discovering it on the evidence pack afterwards.

- [ ] **Step 4: Full verification**

Run: `pnpm verify`
Expected: format, lint, typecheck and every Vitest project pass. The integration
project needs PostgreSQL running.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/composer/
git commit -m "Carry the site lead's name from the paste through to the record"
```
