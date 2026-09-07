'use client';

import type { ChangeRegisterDto, ProjectDto } from '@extrawork/contracts';
import { formatDate, formatMoney, formatScheduleDelta } from '@/lib/format';

type Change = ChangeRegisterDto['changes'][number];

/**
 * Downloads a consolidated view of the whole contract — the original contract
 * plus every recorded change — as one print-ready document the owner can save
 * as a PDF.
 *
 * This is a convenience overview, not a new tamper-evident artefact: the
 * authoritative, signed record of each change is still its own evidence pack,
 * generated on the server and downloadable from the change. The document says so
 * in its footer, so it can never be mistaken for one.
 */
export function DownloadContract({ project, changes }: { project: ProjectDto; changes: Change[] }) {
  function download(): void {
    const html = buildContractHtml(project, changes);

    // Open the document in a new window and offer the print/"Save as PDF"
    // dialog. We need the window handle to write into it, so no `noopener`.
    const win = window.open('', '_blank');
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      window.setTimeout(() => {
        try {
          win.print();
        } catch {
          // The document is still on screen; the owner can print it manually.
        }
      }, 300);
      return;
    }

    // Pop-up blocked — fall back to downloading the document as a file.
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.projectNumber}-full-contract.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className="btn btn-secondary" onClick={download}>
      Download full contract
    </button>
  );
}

function humanStatus(status: string): string {
  return (status.charAt(0) + status.slice(1).toLowerCase()).replace(/_/g, ' ');
}

/** User text goes into a fresh document; escape it so it can't break out. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildContractHtml(project: ProjectDto, changes: Change[]): string {
  const t = project.totals;
  const generatedAt = new Date().toLocaleString('en-IN');
  const site = project.siteAddress?.city ? ` · ${esc(project.siteAddress.city)}` : '';

  const rows =
    changes.length === 0
      ? `<tr><td colspan="5" class="muted">No extra work has been recorded on this project.</td></tr>`
      : changes
          .map(
            (c) => `<tr>
      <td>
        <span class="ref">${esc(c.number)}${c.versionNumber > 1 ? ` v${c.versionNumber}` : ''}</span>
        <div class="muted small">${esc(c.title)}</div>
      </td>
      <td>${esc(humanStatus(c.status))}</td>
      <td class="num${c.totalDeltaMinor < 0 ? ' neg' : ''}">${esc(formatMoney(c.totalDeltaMinor, c.currency, { showSign: true }))}</td>
      <td class="num">${c.scheduleDeltaDays === 0 ? '—' : `${c.scheduleDeltaDays > 0 ? '+' : ''}${c.scheduleDeltaDays}`}</td>
      <td class="muted small">${c.sentAt ? esc(formatDate(c.sentAt)) : '—'}</td>
    </tr>`,
          )
          .join('\n');

  const pendingRow =
    t.pendingChangeCount > 0
      ? `<tr class="sub"><td>Awaiting a decision (${t.pendingChangeCount})</td><td class="num">${esc(formatMoney(t.pendingDeltaMinor, t.currency))}</td></tr>`
      : '';

  const completion = project.revisedCompletionDate
    ? ` Expected completion ${esc(formatDate(project.revisedCompletionDate))}.`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(project.projectNumber)} — full contract</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #ffffff; color: #14171c;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 11pt; line-height: 1.5;
  }
  .wrap { max-width: 800px; margin: 0 auto; padding: 24px; }
  .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
  .num { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .muted { color: #5c6470; }
  .small { font-size: 0.85em; }
  .neg { color: #8a1c1c; }
  h1 { font-size: 1.7rem; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 1rem; margin: 28px 0 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #333c49; border-bottom: 1px solid #e4e2db; padding-bottom: 5px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #14171c; padding-bottom: 16px; }
  .doc-ref { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; border: 1.5px solid #14171c; border-radius: 6px; padding: 6px 10px; white-space: nowrap; }
  .doc-ref .id { font-weight: 700; letter-spacing: 0.04em; }
  .doc-ref .meta { font-size: 0.62rem; letter-spacing: 0.12em; text-transform: uppercase; color: #333c49; }
  table { width: 100%; border-collapse: collapse; }
  .register td, .register th { border-bottom: 1px solid #e4e2db; padding: 8px 6px; text-align: left; vertical-align: top; }
  .register th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #333c49; background: #f6f5f2; }
  .register .ref { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 700; }
  .totals { width: 300px; margin-left: auto; margin-top: 4px; }
  .totals td { padding: 6px 6px; }
  .totals td:last-child { text-align: right; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
  .totals tr.sub td { color: #5c6470; font-size: 0.9em; }
  .totals tr.grand td { border-top: 3px double #14171c; font-weight: 700; font-size: 1.15rem; padding-top: 10px; }
  footer { margin-top: 32px; border-top: 1px solid #e4e2db; padding-top: 12px; font-size: 0.8rem; color: #5c6470; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>${esc(project.title)}</h1>
      <div class="muted">${esc(project.projectNumber)} · ${esc(project.customerName)}${site}</div>
    </div>
    <div class="doc-ref">
      <div class="id">${esc(project.projectNumber)}</div>
      <div class="meta">Full contract</div>
    </div>
  </header>

  <h2>Contract value</h2>
  <table class="totals">
    <tbody>
      <tr><td>Original contract</td><td>${esc(formatMoney(t.baselineTotalMinor, t.currency))}</td></tr>
      <tr class="sub"><td>Approved extras (${t.approvedChangeCount})</td><td>${esc(formatMoney(t.approvedDeltaMinor, t.currency, { showSign: true }))}</td></tr>
      ${pendingRow}
      <tr class="grand"><td>Revised contract total</td><td>${esc(formatMoney(t.revisedTotalMinor, t.currency))}</td></tr>
    </tbody>
  </table>
  <p class="muted small">${esc(formatScheduleDelta(t.approvedScheduleDeltaDays))} from approved changes.${completion}</p>

  <h2>Change register</h2>
  <table class="register">
    <thead>
      <tr><th>Change</th><th>Status</th><th class="num">Value</th><th class="num">Days</th><th>Sent</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <footer>
    <p>Generated ${esc(generatedAt)} · ExtraWork.</p>
    <p>This is a consolidated overview of the contract. The authoritative, tamper-evident record of
    each change is its own signed evidence pack, available from that change.</p>
  </footer>
</div>
</body>
</html>`;
}
