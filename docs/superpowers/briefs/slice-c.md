# Slice C — The project as a folder, and the timeline

Worktree: `/home/claude/wt-c` · branch `feat/ws-c-workspace` · reserved migration number if you
need one: `0026_c_<what>.sql`.

Read `/home/claude/briefs/common.md` first. This slice implements spec decisions D10, D11, D12,
D14 and the notes' "folder-like structure", "uploads when building a new project", "link to
Google Drive", "timeline / collated calendar / notifications of completion dates", "tracking of
timelines and calendar" and "floor plans".

## You own

- `packages/files/src/**` (validation, scanner routing), `packages/config/src/index.ts`
  (`MAX_UPLOAD_BYTES` default) and `.env.example`.
- `packages/application/src/files/service.ts`, `apps/api/src/routes/files.ts`.
- `packages/db/src/repositories/{workspace,milestones,calendar}.ts` (fill; keep
  `ensureDefaultFolders` / `systemFolderId` behaviour — slice D depends on them),
  `packages/db/src/repositories/files.ts` (additions only).
- `packages/application/src/{workspace,timeline}/service.ts`.
- `apps/api/src/routes/{workspace,timeline}.ts`, `apps/api/src/openapi/paths/{workspace,timeline}.ts`.
- `apps/worker/src/jobs/reminders.ts`, the scheduling line in `apps/worker/src/jobs/maintenance.ts`,
  `apps/worker/src/jobs/files.ts` if scanning needs it.
- New pure modules you create, e.g. `packages/domain/src/calendar/ics.ts`.
- Web: `.../projects/[id]/files/**`, `.../projects/[id]/timeline/**`, `.../app/timeline/**` (new),
  `.../app/settings/notifications/**` (new), `.../projects/new/**` (new-project form),
  `apps/web/src/features/composer/attachment-picker.tsx` and `attachment-upload.ts` (type lists
  only), new `apps/web/src/lib/*` helpers.
- Tests for all of the above.

Do NOT edit: project repository/service/routes, change orders, dashboard, requests pages,
composer logic (slice B); collaboration/settings/site team (slice A); intake/WhatsApp (slice D).
Default folders are created LAZILY (on workspace read, on upload, and by slice D on WhatsApp
filing) precisely so you never need to touch project creation.

## Build

### Files (D10, D11)

- `packages/files` validation for the new allowlist in `packages/contracts/src/api/files.ts`:
  - Office Open XML (`xlsx`/`docx`/`pptx`): a ZIP (`PK\x03\x04`) whose central directory/local
    headers contain `[Content_Types].xml` and the format's main part (`xl/workbook.xml`,
    `word/document.xml`, `ppt/presentation.xml`); refuse anything containing `vbaProject.bin`
    or a macro-enabled content type, with a message telling the person to save without macros.
    Detect the subtype from content; the declared type must match.
  - Legacy OLE2 (`D0 CF 11 E0 A1 B1 1A E1`) is refused with: "Older .xls/.doc files can carry
    macros. Save it as .xlsx or .docx and upload it again."
  - CSV / TXT: valid UTF-8 (BOM allowed), no NUL bytes; text is ambiguous so accept the declared
    `text/csv` or `text/plain` when the bytes are text.
  - DWG: header `AC10..`/`AC1.` (first 4 bytes `AC10` or `AC1` + digit); DXF: text whose first
    few KB contain the `SECTION` / `HEADER` or `ENTITIES` group structure.
  - Keep every existing image/PDF rule and test. Non-image types never go to the image decoder.
  - Unit tests for each accept/refuse rule with tiny synthetic fixtures built in the test.
- Downloads of non-image files are always attachments with `X-Content-Type-Options: nosniff`
  (local driver serve route and S3 signed-URL response headers); images keep their sanitised
  derivative path.
- `MAX_UPLOAD_BYTES` default 50 MiB (config, `.env.example`, any docs that state 15 MB); per-type
  caps from `MAX_FILE_BYTES` still apply.
- `FileService` upload creation: purpose `PROJECT_DOCUMENT` requires a `projectId` and
  `document:upload` on that project (collaborators may upload); `CHANGE_ATTACHMENT` stays limited
  to `CHANGE_ATTACHMENT_MIME_TYPES`; both check the workspace quota
  (`organizations.storage_quota_bytes` vs `storageUsedBytes` + declared size) →
  `STORAGE_QUOTA_EXCEEDED`.
- Web: the composer's `attachment-picker.tsx` accepts `CHANGE_ATTACHMENT_MIME_TYPES`; the
  pre-flight in `attachment-upload.ts` falls back to `UPLOAD_EXTENSION_TYPES` when the browser
  reports '' or `application/octet-stream` (keep `tests/unit/attachment-upload.test.ts` green,
  add cases). A reusable `apps/web/src/lib/project-upload.ts` for project documents (presign →
  PUT → complete → poll → add document), reusing the composer's pure helpers rather than copying
  them.

### Folders and documents (D10, D12)

- Repository + service per `packages/contracts/src/api/workspace.ts`: workspace view (folders
  in position order with live documents; default folders ensured), create/rename/reorder/change
  visibility/delete folder (`FOLDER_PROTECTED` for system folders — rename allowed, delete and
  visibility change of WHATSAPP not; `FOLDER_NOT_EMPTY`; `FOLDER_NAME_TAKEN`), add a FILE (an
  uploaded `file_objects` row of this org, this project, purpose PROJECT_DOCUMENT), LINK (https
  only; detect GOOGLE_DRIVE for drive.google.com/docs.google.com, DROPBOX, ONEDRIVE for
  onedrive.live.com / 1drv.ms / \*.sharepoint.com) or NOTE; rename/annotate/move; soft delete;
  download (CLEAN only, short-lived signed URL, attachment disposition).
- Visibility: COLLABORATOR members never see INTERNAL folders or their documents (not in the
  list, 404 on direct access); they can add to PROJECT/CLIENT folders; `canManage` means
  `document:manage` (designer roles). Every check is server-side.
- Notify on additions: to EVERYONE on the project for PROJECT/CLIENT folders, to DESIGNERS for
  INTERNAL ones, never the actor (`DOCUMENT_ADDED` / `NOTE_ADDED`, link to the Files tab).
  Audit `PROJECT_DOCUMENT_ADDED` / `PROJECT_DOCUMENT_REMOVED` with aggregate type `project`
  (check `repositories/audit.ts` rules for project aggregates).
- Routes per the spec table; `GET /v1/projects/:id/workspace`.
- Web Files tab: folders with their visibility label (`FOLDER_VISIBILITY_LABELS`) and counts;
  document rows with a type label (`MIME_TYPE_LABELS`), title, who added it and when, size, scan
  state, and actions (download / open link, rename, move, delete with confirm); "Upload files"
  (multiple, drag-and-drop on desktop, picker on phones, per-file progress and readable
  rejections), "Add link" (paste a Google Drive/Dropbox/any https link), "Add note"; folder
  management for designers; the virtual "Approvals & change records" folder as a card linking to
  the Requests tab; storage used vs quota. Phone-first.

### Timeline (D14)

- Milestones CRUD (`milestone:manage` designers; read for everyone on the project).
- `GET /v1/calendar?from&to&projectId`: events across projects the actor can access — project
  start, expected completion, revised completion when approved changes moved it, milestones,
  approval-link expiries of requests waiting on the client, decisions in range. Stable ids.
- Private ICS feed: `GET/POST/DELETE /v1/calendar/feed` (POST creates or rotates and returns the
  URL once: `${API_PUBLIC_URL}/public/v1/calendar/{token}.ics`), and the public
  `GET /public/v1/calendar/:token` (accept with or without `.ics`): system-scoped token lookup,
  404 for revoked tokens or when the user's membership is no longer ACTIVE, then the same event
  computation for that user's current grants; window: 60 days back to 18 months ahead; RFC 5545
  (all-day `DTSTART;VALUE=DATE`, stable `UID`, escaping, 75-octet line folding, CRLF),
  `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`,
  rate-limited. Put the ICS serialiser in a pure module with unit tests.
- Due reminders: `SEND_DUE_REMINDERS` scheduled daily from `scheduleRecurringJobs` (dedupe key
  per day); for open milestones and project completion dates falling within each recipient's
  `reminder_lead_days` (only users with `completion_reminders` on), write `MILESTONE_DUE` /
  `COMPLETION_DUE` notifications with `dedupeKey` `due:{kind}:{id}:{date}` via
  `NotificationService.notifyUsers` (email follows preferences). Integration-test the dedupe.
- Web: `/app/timeline` — month grid and agenda views, project filter, previous/next/today, events
  linking to their project or request; a card to add the private feed to Google/Apple Calendar
  (create → copy URL + two-line instructions; rotate; turn off). Project Timeline tab:
  milestones (add/edit/complete/delete for designers), plus the project's own dated events.
- `/app/settings/notifications`: email on/off, completion reminders on/off, lead days (0–30),
  and the calendar-feed card.

### New project form

`/app/projects/new`: add description, address line, start date (if missing) and an optional
"Plans, drawings, BOQs, photos" picker. After the project is created: read its workspace (which
creates the default folders), upload each chosen file into the PLANS folder with per-file
progress, then go to the project. A failed upload must not lose the project — show what failed
and link to the Files tab. Add a one-line hint that collaborators can be invited from the Team
tab.

## Done means

Typecheck clean for every package you touched, lint and format clean, the new tests pass, the
broad suite passes (minus the two known golden failures), `pnpm openapi` regenerated, everything
committed.
