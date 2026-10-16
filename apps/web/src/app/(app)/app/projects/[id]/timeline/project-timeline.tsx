'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import {
  MILESTONE_KIND_LABELS,
  type CalendarEventDto,
  type MilestoneDto,
  type MilestoneKind,
  type ProjectDto,
} from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';
import { formatDay, relativeDay } from '@/lib/calendar';
import { Agenda } from '@/components/agenda';

/**
 * The project's Timeline tab (spec 2026-10-12, D14).
 *
 * Milestones first, because they are the part people edit; then the dates
 * the system already knows — start, completion, approval links about to
 * lapse, decisions — so nobody re-enters them as milestones.
 */

const KINDS = Object.keys(MILESTONE_KIND_LABELS) as MilestoneKind[];

interface Draft {
  title: string;
  kind: MilestoneKind;
  dueDate: string;
  notes: string;
  clientVisible: boolean;
}

const EMPTY: Draft = { title: '', kind: 'MILESTONE', dueDate: '', notes: '', clientVisible: true };

function errorText(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message || fallback : fallback;
}

function sortMilestones(items: MilestoneDto[]): MilestoneDto[] {
  return [...items].sort((a, b) =>
    a.dueDate === b.dueDate ? a.title.localeCompare(b.title) : a.dueDate < b.dueDate ? -1 : 1,
  );
}

export function ProjectTimeline({
  project,
  today,
  initialMilestones,
  canManage,
  events,
  eventsFailed,
}: {
  project: ProjectDto;
  today: string;
  initialMilestones: MilestoneDto[];
  canManage: boolean;
  events: CalendarEventDto[];
  eventsFailed: boolean;
}) {
  const [milestones, setMilestones] = useState(() => sortMilestones(initialMilestones));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replace = (next: MilestoneDto) =>
    setMilestones((items) => sortMilestones(items.map((m) => (m.id === next.id ? next : m))));

  async function toggle(milestone: MilestoneDto): Promise<void> {
    setError(null);
    try {
      replace(
        await api<MilestoneDto>(`/v1/milestones/${milestone.id}`, {
          method: 'PATCH',
          body: { completed: milestone.completedAt === null },
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'That milestone could not be updated.'));
    }
  }

  async function remove(milestone: MilestoneDto): Promise<void> {
    if (!globalThis.confirm?.(`Delete the milestone “${milestone.title}”?`)) return;
    setError(null);
    try {
      await api(`/v1/milestones/${milestone.id}`, { method: 'DELETE' });
      setMilestones((items) => items.filter((m) => m.id !== milestone.id));
    } catch (caught) {
      setError(errorText(caught, 'That milestone could not be deleted.'));
    }
  }

  const open = milestones.filter((m) => m.completedAt === null);
  const done = milestones.filter((m) => m.completedAt !== null);
  // Milestones are listed above; the agenda holds everything else.
  const otherEvents = events.filter((event) => event.kind !== 'MILESTONE');
  const revised =
    project.revisedCompletionDate &&
    project.revisedCompletionDate !== project.expectedCompletionDate
      ? project.revisedCompletionDate
      : null;

  return (
    <div className="timeline">
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="card">
        <h2>Key dates</h2>
        <dl className="kv">
          <dt>Work starts</dt>
          <dd>{project.startDate ? formatDay(project.startDate, { year: true }) : 'Not set'}</dd>
          <dt>Expected completion</dt>
          <dd>
            {project.expectedCompletionDate
              ? `${formatDay(project.expectedCompletionDate, { year: true })} · ${relativeDay(project.expectedCompletionDate, today)}`
              : 'Not set'}
          </dd>
          {revised ? (
            <>
              <dt>Revised completion</dt>
              <dd>
                {formatDay(revised, { year: true })} · {relativeDay(revised, today)}
                <span className="small muted"> (moved by approved changes)</span>
              </dd>
            </>
          ) : null}
        </dl>
        <p className="hint" style={{ marginBottom: 0 }}>
          Everyone on the project is reminded before these dates unless they turn reminders off in{' '}
          <Link href="/app/settings/notifications">notification settings</Link>.
        </p>
      </section>

      <section className="card">
        <div className="row-between">
          <h2 style={{ marginBottom: 0 }}>Milestones</h2>
          {canManage && !adding ? (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setAdding(true)}
            >
              Add milestone
            </button>
          ) : null}
        </div>

        {adding ? (
          <MilestoneForm
            initial={EMPTY}
            submitLabel="Add milestone"
            onCancel={() => setAdding(false)}
            onSubmit={async (draft) => {
              const created = await api<MilestoneDto>(`/v1/projects/${project.id}/milestones`, {
                method: 'POST',
                body: toBody(draft),
              });
              setMilestones((items) => sortMilestones([...items, created]));
              setAdding(false);
            }}
          />
        ) : null}

        {milestones.length === 0 ? (
          <p className="muted small" style={{ marginTop: 'var(--s3)', marginBottom: 0 }}>
            {canManage
              ? 'No milestones yet. Add site visits, deliveries, payments and the handover so everyone sees what is next.'
              : 'No milestones yet.'}
          </p>
        ) : (
          <ul className="timeline-list">
            {[...open, ...done].map((milestone) =>
              editingId === milestone.id ? (
                <li key={milestone.id}>
                  <MilestoneForm
                    initial={{
                      title: milestone.title,
                      kind: milestone.kind,
                      dueDate: milestone.dueDate,
                      notes: milestone.notes ?? '',
                      clientVisible: milestone.clientVisible,
                    }}
                    submitLabel="Save"
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (draft) => {
                      replace(
                        await api<MilestoneDto>(`/v1/milestones/${milestone.id}`, {
                          method: 'PATCH',
                          body: { ...toBody(draft), notes: draft.notes.trim() || null },
                        }),
                      );
                      setEditingId(null);
                    }}
                  />
                </li>
              ) : (
                <MilestoneRow
                  key={milestone.id}
                  milestone={milestone}
                  today={today}
                  canManage={canManage}
                  onToggle={() => void toggle(milestone)}
                  onEdit={() => setEditingId(milestone.id)}
                  onDelete={() => void remove(milestone)}
                />
              ),
            )}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Everything dated on this project</h2>
        {eventsFailed ? (
          <p className="small muted">The project&apos;s other dates could not be loaded.</p>
        ) : otherEvents.length === 0 ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Nothing else dated in the six months either side of today.
          </p>
        ) : (
          <Agenda events={otherEvents} today={today} />
        )}
        <p className="hint" style={{ marginBottom: 0 }}>
          All your projects together are on the <Link href="/app/timeline">Timeline</Link>.
        </p>
      </section>
    </div>
  );
}

function toBody(draft: Draft) {
  return {
    title: draft.title.trim(),
    kind: draft.kind,
    dueDate: draft.dueDate,
    clientVisible: draft.clientVisible,
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
  };
}

function MilestoneRow({
  milestone,
  today,
  canManage,
  onToggle,
  onEdit,
  onDelete,
}: {
  milestone: MilestoneDto;
  today: string;
  canManage: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const complete = milestone.completedAt !== null;
  const overdue = !complete && milestone.dueDate < today;
  return (
    <li className="timeline-item" data-complete={complete ? 'true' : undefined}>
      {canManage ? (
        <input
          type="checkbox"
          className="timeline-check"
          checked={complete}
          onChange={onToggle}
          aria-label={complete ? `Reopen ${milestone.title}` : `Mark ${milestone.title} done`}
        />
      ) : (
        <span
          className={`code code-${complete ? 'approved' : overdue ? 'declined' : 'waiting'}`}
          data-code={complete ? 'A' : overdue ? 'D' : 'W'}
          aria-label={complete ? 'Done' : overdue ? 'Overdue' : 'Open'}
        />
      )}
      <div className="timeline-item-main">
        <div className="timeline-item-title">{milestone.title}</div>
        <div className="small muted">
          {MILESTONE_KIND_LABELS[milestone.kind]} · {formatDay(milestone.dueDate, { year: true })} ·{' '}
          {complete ? (
            'done'
          ) : overdue ? (
            <strong className="error-text">overdue</strong>
          ) : (
            relativeDay(milestone.dueDate, today)
          )}
          {milestone.clientVisible ? '' : ' · not shown to the homeowner'}
        </div>
        {milestone.notes ? <p className="small timeline-notes">{milestone.notes}</p> : null}
      </div>
      {canManage ? (
        <div className="actions">
          <button type="button" className="btn btn-sm btn-quiet" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={onDelete}>
            Delete
          </button>
        </div>
      ) : null}
    </li>
  );
}

function MilestoneForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (caught) {
      setError(errorText(caught, 'The milestone could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="timeline-form stack-tight" onSubmit={submit}>
      <div>
        <label htmlFor={`${id}-title`}>What</label>
        <input
          id={`${id}-title`}
          value={draft.title}
          maxLength={160}
          placeholder="Modular kitchen delivery"
          onChange={(event) => set('title', event.target.value)}
          required
        />
      </div>
      <div className="grid-2">
        <div>
          <label htmlFor={`${id}-date`}>Due</label>
          <input
            id={`${id}-date`}
            type="date"
            value={draft.dueDate}
            onChange={(event) => set('dueDate', event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor={`${id}-kind`}>Kind</label>
          <select
            id={`${id}-kind`}
            value={draft.kind}
            onChange={(event) => set('kind', event.target.value as MilestoneKind)}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {MILESTONE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-notes`}>Notes (optional)</label>
        <input
          id={`${id}-notes`}
          value={draft.notes}
          maxLength={2000}
          onChange={(event) => set('notes', event.target.value)}
        />
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.clientVisible}
          onChange={(event) => set('clientVisible', event.target.checked)}
        />
        <span>Show to the homeowner</span>
      </label>
      {error ? <p className="field-error">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
