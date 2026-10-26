'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  WORK_CATEGORY_LABELS,
  type EmployeeDto,
  type ParseIntakeResponse,
  type ProjectSummaryDto,
  type ProposalResultDto,
} from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { formatMoney, formatScheduleDelta } from '@/lib/format';

/**
 * Paste a WhatsApp message — Tier 1 C (spec 2026-09-14 section C), adapted to
 * the review flow of spec 2026-10-12: a contractor messaged the designer
 * directly, the designer pastes it here, sees what was read and what is
 * missing, and turns it into a request in their own review queue.
 *
 * Nothing is written by "Read the message" (`POST /v1/intake/parse` is
 * read-only). "Create request for review" raises a proposal marked `pasted`
 * (origin PASTED) attributed to the site-team member who sent it, so the
 * register says who asked however it arrived. The designer then prices and
 * sends it from the composer exactly like a request raised on WhatsApp.
 */

/** Fields the parser reports missing, in the words of this card. */
const MISSING_LABELS: Record<string, string> = {
  description: 'what the work is',
  project: 'which project',
  amount: 'a price (you can add it when you review)',
  days: 'extra days',
  reason: 'why it is needed',
  company: 'which firm',
};

export function PasteMessageCard({
  projects,
  employees,
}: {
  projects: ProjectSummaryDto[];
  employees: EmployeeDto[];
}) {
  const router = useRouter();
  const createKey = useRef(newIdempotencyKey());
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [reading, setReading] = useState<ParseIntakeResponse | null>(null);
  const [busy, setBusy] = useState<'read' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(ProposalResultDto & { projectId: string }) | null>(null);

  // The project the request would go to: the one chosen, else the one the
  // message named. The server never guesses between two (spec D6), so a
  // message that matches nothing leaves this empty until someone picks.
  const targetProjectId = projectId || reading?.project?.id || '';
  const target = projects.find((p) => p.id === targetProjectId) ?? null;
  const currency = target?.currency ?? 'INR';

  // Only someone on the project may be credited with raising it; the server
  // enforces the same rule.
  const raisers = useMemo(
    () =>
      employees.filter(
        (e) =>
          e.status === 'ACTIVE' &&
          (e.allProjects || (targetProjectId !== '' && e.projectIds.includes(targetProjectId))),
      ),
    [employees, targetProjectId],
  );
  const raiserValid = employeeId === '' || raisers.some((e) => e.id === employeeId);

  const description = reading?.description?.trim() ?? '';
  // A proposal takes a non-negative amount and at most a year either way; a
  // figure outside that is left for the designer to set in the composer.
  const amountMinor =
    reading?.amountMinor !== null && reading?.amountMinor !== undefined && reading.amountMinor >= 0
      ? reading.amountMinor
      : null;
  const days =
    reading?.days !== null && reading?.days !== undefined && Math.abs(reading.days) <= 365
      ? reading.days
      : null;
  const missing = (reading?.missing ?? []).filter(
    // The project is answered by the select once one is chosen.
    (field) => !(field === 'project' && targetProjectId !== ''),
  );
  const canCreate =
    reading !== null && description !== '' && targetProjectId !== '' && raiserValid && !busy;

  async function read(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy('read');
    setError(null);
    setCreated(null);
    try {
      const result = await api<ParseIntakeResponse>('/v1/intake/parse', {
        method: 'POST',
        body: { text: trimmed, ...(projectId ? { projectId } : {}) },
      });
      setReading(result);
      createKey.current = newIdempotencyKey();
    } catch (caught) {
      setReading(null);
      setError(caught instanceof ApiError ? caught.message : 'The message could not be read.');
    } finally {
      setBusy(null);
    }
  }

  async function create(): Promise<void> {
    if (!reading || !canCreate) return;
    setBusy('create');
    setError(null);
    try {
      const result = await api<ProposalResultDto>(`/v1/projects/${targetProjectId}/proposals`, {
        method: 'POST',
        idempotencyKey: createKey.current,
        body: {
          description,
          ...(reading.reason ? { reason: reading.reason } : {}),
          ...(reading.room ? { room: reading.room } : {}),
          ...(reading.workCategory ? { workCategory: reading.workCategory } : {}),
          ...(amountMinor !== null && amountMinor > 0 ? { amountMinor } : {}),
          ...(days !== null && days !== 0 ? { scheduleDeltaDays: days } : {}),
          ...(employeeId ? { raisedByEmployeeId: employeeId } : {}),
          pasted: true,
          attachmentIds: [],
        },
      });
      setCreated({ ...result, projectId: targetProjectId });
      setText('');
      setReading(null);
      setEmployeeId('');
      createKey.current = newIdempotencyKey();
      router.refresh();
    } catch (caught) {
      createKey.current = newIdempotencyKey();
      setError(caught instanceof ApiError ? caught.message : 'The request could not be created.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel panel-pad paste-card" aria-labelledby="paste-heading">
      <h2 id="paste-heading" className="paste-card-title">
        Paste a WhatsApp message
      </h2>
      <p className="small muted">
        A contractor sent you a change directly? Paste it here. Nothing is saved until you create
        the request, and nothing reaches the homeowner until you send it.
      </p>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {created ? (
        <div className="banner banner-info" role="status">
          <strong>{created.number}</strong> is in your review queue.{' '}
          <Link
            href={`/app/projects/${created.projectId}/changes/new?changeOrderId=${created.changeOrderId}`}
          >
            Review &amp; price it now
          </Link>{' '}
          · <Link href={`/app/changes/${created.changeOrderId}`}>Open</Link>
        </div>
      ) : null}

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void read();
        }}
      >
        <div>
          <label htmlFor="paste-text">Message</label>
          <textarea
            id="paste-text"
            rows={4}
            maxLength={4000}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              // A reading describes the text it was made from, not this one.
              setReading(null);
            }}
            placeholder={'Bathroom: shift the basin 2 ft left\nAmount: 4500\nDays: 1'}
          />
        </div>

        <div className="grid-2">
          <div>
            <label htmlFor="paste-project">Project</label>
            <select
              id="paste-project"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setEmployeeId('');
              }}
            >
              <option value="">Work it out from the message</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectNumber} · {p.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="paste-raiser">Raised by</label>
            <select
              id="paste-raiser"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              disabled={targetProjectId === ''}
            >
              <option value="">
                {targetProjectId === '' ? 'Choose the project first' : 'Not on the site team'}
              </option>
              {raisers.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.companyName ? ` · ${e.companyName}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="actions">
          <button type="submit" className="btn" disabled={busy !== null || !text.trim()}>
            {busy === 'read' ? 'Reading…' : 'Read the message'}
          </button>
        </div>
      </form>

      {reading ? (
        <div className="stack paste-reading" aria-live="polite">
          <h3 className="paste-card-title">What was read</h3>
          <dl className="kv" style={{ marginBottom: 0 }}>
            <dt>Project</dt>
            <dd>
              {target
                ? `${target.projectNumber} · ${target.title}`
                : reading.project
                  ? `${reading.project.projectNumber} · ${reading.project.title}`
                  : 'Not clear — choose it above'}
            </dd>
            <dt>Work</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{description || '—'}</dd>
            <dt>Room or area</dt>
            <dd>{reading.room ?? '—'}</dd>
            <dt>Type of work</dt>
            <dd>{reading.workCategory ? WORK_CATEGORY_LABELS[reading.workCategory] : '—'}</dd>
            <dt>Amount</dt>
            <dd>{amountMinor !== null ? formatMoney(amountMinor, currency) : 'To price'}</dd>
            <dt>Schedule</dt>
            <dd>{days !== null ? formatScheduleDelta(days) : '—'}</dd>
            {reading.reason ? (
              <>
                <dt>Why</dt>
                <dd>{reading.reason}</dd>
              </>
            ) : null}
          </dl>

          {reading.problems.length > 0 ? (
            <div className="banner" role="status">
              <strong>Check these:</strong>
              <ul style={{ margin: 'var(--s1) 0 0', paddingLeft: '1.2rem' }}>
                {reading.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {missing.length > 0 ? (
            <p className="small muted" style={{ marginBottom: 0 }}>
              Not in the message:{' '}
              {missing.map((field) => MISSING_LABELS[field] ?? field).join(', ')}.
            </p>
          ) : null}

          {description === '' ? (
            <p className="field-error" role="alert">
              The message does not say what the work is, so there is nothing to raise yet.
            </p>
          ) : null}

          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canCreate}
              onClick={() => void create()}
            >
              {busy === 'create' ? 'Creating…' : 'Create request for review'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
