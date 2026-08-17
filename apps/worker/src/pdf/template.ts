import type { EvidenceViewModel } from '@extrawork/application';

/**
 * Evidence pack template `evidence-pdf-v1`.
 *
 * Report §8.5 fixes the contents: cover summary and disclaimer, project
 * baseline reference, the exact change snapshot, line items/totals/schedule,
 * attachment digests, decision details and achieved assurance, chronological
 * event history, and manifest digest plus generation metadata.
 *
 * Report §4.4 additionally requires every PDF to display the business name,
 * project number, change number, version, state, assurance level and
 * generation timestamp.
 *
 * ANY user-visible change here REQUIRES a new template version and a golden
 * review (report §14.4, §14.5) — `golden/evidence.test.ts` extracts this text
 * and will fail if a price, version or decision silently disappears.
 *
 * Everything is inlined: no external CSS, fonts or images. The renderer blocks
 * outbound requests, so a remote reference would render as nothing at all.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

/** Wraps a long hex digest so it cannot overflow the page box. */
function digest(value: string): string {
  return `<span class="digest">${e(value.replace(/(.{32})/g, '$1​'))}</span>`;
}

export function renderEvidenceHtml(model: EvidenceViewModel): string {
  const r = model.render;
  const decided = r.decision !== null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${e(r.changeNumber)} v${r.versionNumber} — evidence pack</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
    color: #10151c;
  }
  h1 { font-size: 17pt; margin: 0 0 2mm; }
  h2 {
    font-size: 11pt;
    margin: 7mm 0 2mm;
    padding-bottom: 1.2mm;
    border-bottom: 1px solid #c9d3de;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #33445c;
  }
  .muted { color: #5a6b80; }
  .cover { border: 1.5px solid #10151c; padding: 5mm; }
  .cover-head { display: flex; justify-content: space-between; gap: 6mm; }
  .org { font-size: 13pt; font-weight: 700; }
  .facts { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  .facts td { padding: 1.1mm 0; vertical-align: top; }
  .facts td:first-child { width: 42mm; color: #5a6b80; }
  .status {
    display: inline-block;
    border: 1.2px solid #10151c;
    padding: 0.8mm 2.4mm;
    font-weight: 700;
    font-size: 9.5pt;
    /* Status is never colour-only: the label itself carries the meaning
       (report §6.9 / WCAG 2.2 AA). */
  }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 2mm; }
  table.lines th, table.lines td {
    border-bottom: 1px solid #dbe3ec;
    padding: 1.7mm 1.5mm;
    text-align: left;
    font-size: 9.5pt;
  }
  table.lines th { background: #eef2f7; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.03em; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .totals { margin-top: 3mm; width: 92mm; margin-left: auto; border-collapse: collapse; }
  .totals td { padding: 1.2mm 1.5mm; }
  .totals td.num { text-align: right; white-space: nowrap; }
  .totals tr.grand td { border-top: 1.5px solid #10151c; font-weight: 700; font-size: 11.5pt; }
  .scope { white-space: pre-wrap; }
  .box { border: 1px solid #c9d3de; padding: 3.5mm; margin-top: 2mm; }
  .box.solid { background: #f5f8fb; }
  .digest { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 7.5pt; word-break: break-all; }
  .disclaimer { font-size: 8.8pt; color: #33445c; }
  .events { width: 100%; border-collapse: collapse; font-size: 8.8pt; }
  .events th, .events td { border-bottom: 1px solid #e6ecf3; padding: 1.2mm 1.5mm; text-align: left; }
  .warn { border: 1.5px solid #8a1c1c; background: #fdf2f2; padding: 3mm; margin-top: 3mm; }
  footer { margin-top: 7mm; border-top: 1px solid #c9d3de; padding-top: 2.5mm; font-size: 8pt; color: #5a6b80; }
  .avoid-break { break-inside: avoid; }
</style>
</head>
<body>

<section class="cover avoid-break">
  <div class="cover-head">
    <div>
      <div class="org">${e(r.organizationName)}</div>
      ${r.organizationLegalName ? `<div class="muted">${e(r.organizationLegalName)}</div>` : ''}
      ${r.organizationGstin ? `<div class="muted">GSTIN ${e(r.organizationGstin)}</div>` : ''}
    </div>
    <div style="text-align:right">
      <h1>Change record</h1>
      <div class="status">${e(r.statusLabel)}</div>
    </div>
  </div>

  <table class="facts">
    <tr><td>Change number</td><td><strong>${e(r.changeNumber)}</strong> &nbsp; version ${r.versionNumber}</td></tr>
    <tr><td>Project</td><td><strong>${e(r.projectNumber)}</strong> — ${e(r.projectTitle)}</td></tr>
    <tr><td>Customer</td><td>${e(r.customerName)}</td></tr>
    <tr><td>State</td><td>${e(r.statusLabel)} (${e(r.status)})</td></tr>
    <tr><td>Assurance level</td><td>${e(r.assuranceLabel)}</td></tr>
    <tr><td>Generated</td><td>${e(r.generatedAt)}</td></tr>
  </table>
</section>

<h2>What this record is</h2>
<p class="disclaimer">${e(r.disclaimer)}</p>

<h2>Scope of the change</h2>
<div><strong>${e(r.title)}</strong></div>
<div class="scope">${e(r.scope)}</div>
${r.reason ? `<div class="box"><span class="muted">Reason recorded by the business:</span> ${e(r.reason)}</div>` : ''}

<h2>Commercial effect</h2>
${
  r.lineItems.length > 0
    ? `<table class="lines">
  <thead>
    <tr>
      <th>Description</th>
      <th class="num">Quantity</th>
      <th>Unit</th>
      <th class="num">Rate</th>
      <th class="num">Tax</th>
      <th class="num">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${r.lineItems
      .map(
        (line) => `<tr>
      <td>${e(line.description)}</td>
      <td class="num">${e(line.quantity)}</td>
      <td>${e(line.unit ?? '')}</td>
      <td class="num">${e(line.unitPrice)}</td>
      <td class="num">${e(line.taxRate)}</td>
      <td class="num">${e(line.total)}</td>
    </tr>`,
      )
      .join('\n    ')}
  </tbody>
</table>`
    : `<div class="box">No priced line items. This change records a schedule effect only.</div>`
}

<table class="totals avoid-break">
  <tr><td>Subtotal of this change</td><td class="num">${e(r.subtotalDelta)}</td></tr>
  <tr><td>Tax on this change</td><td class="num">${e(r.taxDelta)}</td></tr>
  <tr><td><strong>Total of this change</strong></td><td class="num"><strong>${e(r.totalDelta)}</strong></td></tr>
  <tr><td class="muted">Original contract total</td><td class="num muted">${e(r.baselineTotal)}</td></tr>
  <tr><td class="muted">Previously approved changes</td><td class="num muted">${e(r.priorApprovedDelta)}</td></tr>
  <tr class="grand"><td>Revised contract total</td><td class="num">${e(r.revisedContractTotal)}</td></tr>
</table>

<h2>Schedule effect</h2>
<table class="facts">
  <tr>
    <td>Change to programme</td>
    <td>${r.scheduleDeltaDays === 0 ? 'No change' : `${r.scheduleDeltaDays > 0 ? '+' : ''}${r.scheduleDeltaDays} day${Math.abs(r.scheduleDeltaDays) === 1 ? '' : 's'}`}</td>
  </tr>
  <tr>
    <td>Revised completion date</td>
    <td>${r.revisedCompletionDate ? e(r.revisedCompletionDate) : 'Not stated'}</td>
  </tr>
</table>

<h2>Approver and assurance</h2>
<table class="facts">
  <tr><td>Intended approver</td><td>${e(r.approverName)}</td></tr>
  <tr><td>Contact on record</td><td>${e(r.approverMaskedContact)}</td></tr>
  <tr><td>Assurance achieved</td><td>${e(r.assuranceLabel)}</td></tr>
</table>
<div class="box"><p style="margin:0">${e(r.assuranceStatement)}</p></div>
<div class="box solid"><p style="margin:0"><strong>Limitation of this evidence.</strong> ${e(r.assuranceLimitation)}</p></div>

<h2>Decision</h2>
${
  decided && r.decision
    ? `<table class="facts avoid-break">
  <tr><td>Decision</td><td><strong>${e(r.decision.type)}</strong></td></tr>
  <tr><td>Name typed by approver</td><td>${e(r.decision.signerName)}</td></tr>
  <tr><td>Recorded at</td><td>${e(r.decision.occurredAt)}</td></tr>
  <tr><td>Receipt reference</td><td>${e(r.decision.receiptId)}</td></tr>
</table>
<div class="box"><span class="muted">Statement accepted at the time of the decision:</span><br>${e(r.decision.declarationText)}</div>
${r.decision.comment ? `<div class="box"><span class="muted">Comment from the approver:</span><br>${e(r.decision.comment)}</div>` : ''}`
    : `<div class="box">No decision has been recorded for this version. This pack documents what was sent, not an outcome.</div>`
}

<h2>Attachments</h2>
${
  r.attachments.length > 0
    ? `<table class="lines">
  <thead><tr><th>File</th><th>Type</th><th class="num">Size</th><th>SHA-256</th></tr></thead>
  <tbody>
    ${r.attachments
      .map(
        (a) => `<tr>
      <td>${e(a.filename)}</td>
      <td>${e(a.mimeType)}</td>
      <td class="num">${e(a.byteSize)}</td>
      <td>${digest(a.sha256)}</td>
    </tr>`,
      )
      .join('\n    ')}
  </tbody>
</table>
<p class="disclaimer">The digests above identify the exact files shown to the approver. The files themselves are held in private storage and are supplied separately on request.</p>`
    : `<div class="box">No attachments were included with this version.</div>`
}

<h2>Event history</h2>
<table class="events">
  <thead><tr><th>#</th><th>Event</th><th>When</th><th>Actor</th></tr></thead>
  <tbody>
    ${r.events
      .map(
        (ev) => `<tr>
      <td>${ev.sequence}</td>
      <td>${e(ev.type)}</td>
      <td>${e(ev.occurredAt)}</td>
      <td>${e(ev.actor)}</td>
    </tr>`,
      )
      .join('\n    ')}
  </tbody>
</table>

${
  r.chainVerified
    ? ''
    : `<div class="warn"><strong>Integrity warning.</strong> The audit chain for this record did not verify at the time this pack was generated. Treat the event history above as unconfirmed and contact the business before relying on this document.</div>`
}

<h2>Integrity</h2>
<table class="facts">
  <tr><td>Content digest</td><td>${digest(r.canonicalSha256)}</td></tr>
  <tr><td>Manifest digest</td><td>${digest(r.manifestSha256)}</td></tr>
  <tr><td>Final event hash</td><td>${digest(r.terminalEventHash)}</td></tr>
  <tr><td>Audit chain</td><td>${r.chainVerified ? 'Verified at generation time' : 'FAILED verification'}</td></tr>
</table>
<p class="disclaimer">
  The content digest is a SHA-256 over the frozen, canonically serialised record of what was sent.
  Recomputing it from the same record reproduces the same value, so a later alteration is detectable.
  These digests show that the stored record has not been modified since it was frozen. They do not,
  by themselves, prove the time at which the record existed.
</p>

<footer>
  ${e(r.organizationName)} &middot; ${e(r.changeNumber)} v${r.versionNumber} &middot; ${e(r.projectNumber)}
  &middot; ${e(r.statusLabel)} &middot; ${e(r.assuranceLabel)}<br>
  Generated ${e(r.generatedAt)} &middot; template ${e(r.templateVersion)}
  &middot; canonicalizer ${e(r.canonicalizerVersion)} &middot; terms ${e(r.termsVersion)}
</footer>

</body>
</html>`;
}
