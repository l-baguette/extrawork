'use client';

import Link from 'next/link';
import { useCallback, useId, useRef, useState } from 'react';
import {
  FOLDER_VISIBILITY_LABELS,
  type DocumentDownloadDto,
  type FolderVisibility,
  type ProjectDocumentDto,
  type ProjectFolderDto,
  type ProjectWorkspaceDto,
} from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  documentTypeLabel,
  formatBytes,
  scanStateLabel,
  storageSummary,
} from '@/lib/files-display';
import {
  UPLOAD_STAGE_LABELS,
  describeUploadFailure,
  uploadProjectFile,
  type UploadStage,
} from '@/lib/project-upload';
import { acceptAttribute, PROJECT_FILE_TYPES } from '@/features/composer/attachment-upload';
import { IconFolder, IconLink, IconDocument, IconUpload } from '@/components/icons';

/**
 * The Files tab — spec 2026-10-12, D10–D12.
 *
 * Phone-first: one "Add" panel at the top (upload, paste a link, jot a note)
 * aimed at one folder, then the folders as ruled sections. Everyone on the
 * project may add; only designers rename, move, remove and manage folders,
 * and the server decides both — this component only hides what would be
 * refused anyway.
 */

type AddMode = 'UPLOAD' | 'LINK' | 'NOTE';

interface QueuedUpload {
  key: string;
  name: string;
  size: number;
  stage: UploadStage;
  fraction: number | null;
  error: string | null;
}

const VISIBILITIES: FolderVisibility[] = ['INTERNAL', 'PROJECT', 'CLIENT'];

function errorText(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) return caught.message || fallback;
  return fallback;
}

export function FilesWorkspace({
  projectId,
  initial,
}: {
  projectId: string;
  initial: ProjectWorkspaceDto;
}) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<string>(
    () => initial.folders.find((f) => f.systemKey === 'PLANS')?.id ?? initial.folders[0]?.id ?? '',
  );

  const refresh = useCallback(async () => {
    try {
      setView(await api<ProjectWorkspaceDto>(`/v1/projects/${projectId}/workspace`));
    } catch (caught) {
      setError(errorText(caught, 'The folder list could not be refreshed.'));
    }
  }, [projectId]);

  const storage = storageSummary(view.storage);
  const target = view.folders.find((f) => f.id === targetFolderId) ?? view.folders[0];

  return (
    <div className="files">
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}{' '}
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {view.canUpload && target ? (
        <AddPanel
          projectId={projectId}
          folders={view.folders}
          target={target}
          onTargetChange={setTargetFolderId}
          onAdded={refresh}
        />
      ) : null}

      <div className="files-storage" aria-label="Workspace storage">
        <div className="row-between small">
          <span className="muted">Workspace storage</span>
          <span className="tabular">{storage.text}</span>
        </div>
        <div
          className="files-meter"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={view.storage.quotaBytes}
          aria-valuenow={view.storage.usedBytes}
          aria-valuetext={storage.text}
          data-full={storage.nearlyFull ? 'true' : undefined}
        >
          <span style={{ width: `${(storage.fraction * 100).toFixed(1)}%` }} />
        </div>
      </div>

      <Link className="files-approvals" href={`/app/projects/${projectId}/requests`}>
        <IconDocument />
        <span className="files-approvals-body">
          <strong>Approvals &amp; change records</strong>
          <span className="small muted">
            {view.approvals.requestCount === 0
              ? 'No change requests yet. Every request and decision is kept here automatically.'
              : `${view.approvals.requestCount} request${view.approvals.requestCount === 1 ? '' : 's'}, ${view.approvals.decidedCount} decided. Kept automatically; open the Requests tab.`}
          </span>
        </span>
      </Link>

      <div className="files-folders">
        {view.folders.map((folder) => (
          <FolderSection
            key={folder.id}
            folder={folder}
            folders={view.folders}
            canManageFolders={view.canManageFolders}
            onChanged={refresh}
            onError={setError}
            onAddHere={() => {
              setTargetFolderId(folder.id);
              globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
            }}
            canUpload={view.canUpload}
          />
        ))}
      </div>

      {view.canManageFolders ? <NewFolderForm projectId={projectId} onCreated={refresh} /> : null}
    </div>
  );
}

// --- Adding -------------------------------------------------------------------------

function AddPanel({
  projectId,
  folders,
  target,
  onTargetChange,
  onAdded,
}: {
  projectId: string;
  folders: ProjectFolderDto[];
  target: ProjectFolderDto;
  onTargetChange: (folderId: string) => void;
  onAdded: () => Promise<void>;
}) {
  const [mode, setMode] = useState<AddMode>('UPLOAD');
  const folderSelectId = useId();

  return (
    <section className="card files-add" aria-label="Add to this project">
      <div className="files-add-head">
        <div className="segmented" role="tablist" aria-label="What to add">
          {(
            [
              ['UPLOAD', 'Upload files'],
              ['LINK', 'Add link'],
              ['NOTE', 'Add note'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              className="segmented-item"
              aria-selected={mode === value}
              aria-current={mode === value ? 'true' : undefined}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="files-add-target">
          <label htmlFor={folderSelectId} className="small">
            Into
          </label>
          <select
            id={folderSelectId}
            value={target.id}
            onChange={(event) => onTargetChange(event.target.value)}
          >
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Visible to: {FOLDER_VISIBILITY_LABELS[target.visibility].toLowerCase()}.
      </p>

      {mode === 'UPLOAD' ? (
        <UploadForm projectId={projectId} folderId={target.id} onAdded={onAdded} />
      ) : mode === 'LINK' ? (
        <LinkForm projectId={projectId} folderId={target.id} onAdded={onAdded} />
      ) : (
        <NoteForm projectId={projectId} folderId={target.id} onAdded={onAdded} />
      )}
    </section>
  );
}

function UploadForm({
  projectId,
  folderId,
  onAdded,
}: {
  projectId: string;
  folderId: string;
  onAdded: () => Promise<void>;
}) {
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const pending = useRef<Array<{ key: string; file: File; folderId: string }>>([]);

  const patch = (key: string, next: Partial<QueuedUpload>) =>
    setQueue((items) => items.map((item) => (item.key === key ? { ...item, ...next } : item)));

  // One file at a time: on a site connection, parallel uploads only make
  // every file slower and the first useful one later.
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let next = pending.current.shift(); next; next = pending.current.shift()) {
        const { key, file, folderId: into } = next;
        try {
          await uploadProjectFile(file, { projectId, folderId: into }, (progress) =>
            patch(key, { stage: progress.stage, fraction: progress.fraction }),
          );
          patch(key, { stage: 'DONE', fraction: null });
          await onAdded();
        } catch (caught) {
          patch(key, {
            stage: 'FAILED',
            fraction: null,
            error: describeUploadFailure(caught).message,
          });
        }
      }
    } finally {
      running.current = false;
    }
  }, [projectId, onAdded]);

  function enqueue(files: FileList | File[]): void {
    const picked = Array.from(files);
    if (picked.length === 0) return;
    const items = picked.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
    }));
    setQueue((current) => [
      ...current.filter((item) => item.stage !== 'DONE'),
      ...items.map(({ key, file }) => ({
        key,
        name: file.name,
        size: file.size,
        stage: 'WAITING' as const,
        fraction: null,
        error: null,
      })),
    ]);
    pending.current.push(...items.map((item) => ({ ...item, folderId })));
    void drain();
  }

  return (
    <div className="stack-tight">
      <div
        className="files-drop"
        data-dragging={dragging ? 'true' : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          enqueue(event.dataTransfer.files);
        }}
      >
        <IconUpload />
        <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <span className="small muted files-drop-hint">or drop them here</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={acceptAttribute(PROJECT_FILE_TYPES)}
          onChange={(event) => {
            if (event.target.files) enqueue(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      <p className="hint">
        Photos, PDFs, Excel, Word, PowerPoint, CSV, text and DWG/DXF drawings, up to 50 MB.
      </p>
      {queue.length > 0 ? (
        <ul className="files-queue" aria-live="polite">
          {queue.map((item) => (
            <li key={item.key} data-stage={item.stage}>
              <span className="files-queue-name">{item.name}</span>
              <span className="small muted tabular">{formatBytes(item.size)}</span>
              <span className="small files-queue-stage">
                {UPLOAD_STAGE_LABELS[item.stage]}
                {item.stage === 'UPLOADING' && item.fraction !== null
                  ? ` ${Math.trunc(item.fraction * 100)}%`
                  : ''}
              </span>
              {item.stage === 'UPLOADING' ? (
                <progress
                  max={1}
                  value={item.fraction ?? 0}
                  aria-label={`Uploading ${item.name}`}
                />
              ) : null}
              {item.error ? (
                <span className="field-error files-queue-error">{item.error}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LinkForm({
  projectId,
  folderId,
  onAdded,
}: {
  projectId: string;
  folderId: string;
  onAdded: () => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlId = useId();
  const titleId = useId();

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed.startsWith('https://')) {
      setError('Paste the full link, starting with https://');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/projects/${projectId}/documents`, {
        method: 'POST',
        body: {
          kind: 'LINK',
          folderId,
          url: trimmed,
          ...(title.trim() ? { title: title.trim() } : {}),
        },
      });
      setUrl('');
      setTitle('');
      await onAdded();
    } catch (caught) {
      setError(errorText(caught, 'The link could not be added.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack-tight" onSubmit={submit}>
      <div>
        <label htmlFor={urlId}>Link</label>
        <input
          id={urlId}
          type="url"
          inputMode="url"
          placeholder="https://drive.google.com/…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
        />
        <p className="hint">A Google Drive, Dropbox or OneDrive folder, or any https link.</p>
      </div>
      <div>
        <label htmlFor={titleId}>Name (optional)</label>
        <input id={titleId} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
        {busy ? 'Adding…' : 'Add link'}
      </button>
    </form>
  );
}

function NoteForm({
  projectId,
  folderId,
  onAdded,
}: {
  projectId: string;
  folderId: string;
  onAdded: () => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyId = useId();

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/projects/${projectId}/documents`, {
        method: 'POST',
        body: { kind: 'NOTE', folderId, body: body.trim() },
      });
      setBody('');
      await onAdded();
    } catch (caught) {
      setError(errorText(caught, 'The note could not be added.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack-tight" onSubmit={submit}>
      <div>
        <label htmlFor={bodyId}>Note</label>
        <textarea
          id={bodyId}
          rows={3}
          maxLength={4000}
          placeholder="Tile supplier confirmed delivery for Friday"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
        />
        <p className="hint">The first line becomes its title.</p>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
        {busy ? 'Adding…' : 'Add note'}
      </button>
    </form>
  );
}

// --- Folders ------------------------------------------------------------------------

function FolderSection({
  folder,
  folders,
  canManageFolders,
  canUpload,
  onChanged,
  onError,
  onAddHere,
}: {
  folder: ProjectFolderDto;
  folders: ProjectFolderDto[];
  canManageFolders: boolean;
  canUpload: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onAddHere: () => void;
}) {
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function patchFolder(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    try {
      await api(`/v1/folders/${folder.id}`, { method: 'PATCH', body });
      await onChanged();
    } catch (caught) {
      onError(errorText(caught, 'The folder could not be changed.'));
    } finally {
      setBusy(false);
    }
  }

  async function rename(): Promise<void> {
    const name = globalThis.prompt?.('Rename folder', folder.name)?.trim();
    if (!name || name === folder.name) return;
    await patchFolder({ name });
  }

  async function remove(): Promise<void> {
    if (!globalThis.confirm?.(`Delete the folder “${folder.name}”?`)) return;
    setBusy(true);
    try {
      await api(`/v1/folders/${folder.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (caught) {
      onError(errorText(caught, 'The folder could not be deleted.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="files-folder" open={folder.documentCount > 0 || undefined}>
      <summary>
        <IconFolder />
        <span className="files-folder-name">{folder.name}</span>
        <span className="files-folder-meta small muted">
          {FOLDER_VISIBILITY_LABELS[folder.visibility]} · {folder.documentCount}
        </span>
      </summary>

      <div className="files-folder-body">
        {folder.documents.length === 0 ? (
          <p className="small muted files-empty">Nothing here yet.</p>
        ) : (
          <ul className="files-docs">
            {folder.documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                folders={folders}
                onChanged={onChanged}
                onError={onError}
              />
            ))}
          </ul>
        )}

        <div className="files-folder-actions">
          {canUpload ? (
            <button type="button" className="btn btn-sm btn-quiet" onClick={onAddHere}>
              Add here
            </button>
          ) : null}
          {canManageFolders ? (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              aria-expanded={managing}
              onClick={() => setManaging((open) => !open)}
            >
              Manage folder
            </button>
          ) : null}
        </div>

        {canManageFolders && managing ? (
          <div className="files-manage">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void rename()}
            >
              Rename
            </button>
            {folder.systemKey === 'WHATSAPP' ? (
              <span className="small muted">Always shared with everyone on the project.</span>
            ) : (
              <label className="files-inline-select small">
                Visible to
                <select
                  value={folder.visibility}
                  disabled={busy}
                  onChange={(event) => void patchFolder({ visibility: event.target.value })}
                >
                  {VISIBILITIES.map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {FOLDER_VISIBILITY_LABELS[visibility]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {folder.systemKey ? null : (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={busy || folder.documentCount > 0}
                title={folder.documentCount > 0 ? 'Move or remove its files first' : undefined}
                onClick={() => void remove()}
              >
                Delete folder
              </button>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function DocumentRow({
  document,
  folders,
  onChanged,
  onError,
}: {
  document: ProjectDocumentDto;
  folders: ProjectFolderDto[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const scan = document.file ? scanStateLabel(document.file.scanStatus) : null;
  const downloadable = document.kind === 'FILE' && document.file?.scanStatus === 'CLEAN';

  async function download(): Promise<void> {
    setBusy(true);
    try {
      const result = await api<DocumentDownloadDto>(`/v1/documents/${document.id}/download`);
      // Attachments: the browser saves rather than navigates.
      globalThis.location.assign(result.downloadUrl);
    } catch (caught) {
      onError(errorText(caught, 'The file could not be downloaded.'));
    } finally {
      setBusy(false);
    }
  }

  async function update(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    try {
      await api(`/v1/documents/${document.id}`, { method: 'PATCH', body });
      await onChanged();
    } catch (caught) {
      onError(errorText(caught, 'That change could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function rename(): Promise<void> {
    const title = globalThis.prompt?.('Rename', document.title)?.trim();
    if (!title || title === document.title) return;
    await update({ title });
  }

  async function remove(): Promise<void> {
    if (!globalThis.confirm?.(`Remove “${document.title}” from this project?`)) return;
    setBusy(true);
    try {
      await api(`/v1/documents/${document.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (caught) {
      onError(errorText(caught, 'It could not be removed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="files-doc">
      <span className="files-doc-icon" aria-hidden="true">
        {document.kind === 'LINK' ? <IconLink /> : <IconDocument />}
      </span>
      <div className="files-doc-main">
        <div className="files-doc-title">
          {document.kind === 'LINK' && document.url ? (
            <a href={document.url} target="_blank" rel="noopener noreferrer">
              {document.title}
            </a>
          ) : (
            <span>{document.title}</span>
          )}
        </div>
        <div className="small muted files-doc-meta">
          <span className="files-type">{documentTypeLabel(document)}</span>
          {document.file ? (
            <span className="tabular">{formatBytes(document.file.byteSize)}</span>
          ) : null}
          <span>
            {document.addedByLabel ?? 'Someone'} · {formatDate(document.createdAt)}
          </span>
          {scan ? (
            <span className={`code code-${scan.tone}`} data-code={scan.code}>
              {scan.label}
            </span>
          ) : null}
        </div>
        {document.kind === 'NOTE' && document.body ? (
          <p className="files-note">{document.body}</p>
        ) : null}
        {document.notes ? <p className="small muted files-note">{document.notes}</p> : null}

        {more && document.canManage ? (
          <div className="files-manage">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void rename()}
            >
              Rename
            </button>
            <label className="files-inline-select small">
              Move to
              <select
                value={document.folderId}
                disabled={busy}
                onChange={(event) => void update({ folderId: event.target.value })}
              >
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
      <div className="files-doc-actions">
        {downloadable ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void download()}
          >
            Download
          </button>
        ) : document.kind === 'LINK' && document.url ? (
          <a className="btn btn-sm" href={document.url} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        ) : null}
        {document.canManage ? (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            aria-expanded={more}
            aria-label={`More actions for ${document.title}`}
            onClick={() => setMore((open) => !open)}
          >
            ⋯
          </button>
        ) : null}
      </div>
    </li>
  );
}

function NewFolderForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<FolderVisibility>('PROJECT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const visibilityId = useId();

  if (!open) {
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        New folder
      </button>
    );
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/projects/${projectId}/folders`, {
        method: 'POST',
        body: { name: name.trim(), visibility },
      });
      setName('');
      setOpen(false);
      await onCreated();
    } catch (caught) {
      setError(errorText(caught, 'The folder could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack-tight" onSubmit={submit}>
      <h3>New folder</h3>
      <div className="grid-2">
        <div>
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Electrical"
            required
          />
        </div>
        <div>
          <label htmlFor={visibilityId}>Visible to</label>
          <select
            id={visibilityId}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as FolderVisibility)}
          >
            {VISIBILITIES.map((value) => (
              <option key={value} value={value}>
                {FOLDER_VISIBILITY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? 'Creating…' : 'Create folder'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
