'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ChangeOrderSummaryDto, InvoicingDto } from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';

/**
 * The unbilled ledger — Tier 1 B (spec 2026-09-14 section B). Approved
 * changes nobody has billed yet, each with an inline "Mark invoiced" that
 * takes the firm's own invoice number, and the recently marked ones with
 * "Clear" for a mark made by mistake.
 *
 * The mark is bookkeeping about the record, never a term of it: it sits
 * outside the frozen snapshot, and the audit chain keeps who marked or
 * cleared what. Only owner, admin and accounts may mark (`change_order:invoice`);
 * everyone else who can read reports sees the same list without the controls.
 */
export function UnbilledLedger({
  unbilled,
  invoiced,
  canInvoice,
}: {
  unbilled: ChangeOrderSummaryDto[];
  invoiced: ChangeOrderSummaryDto[];
  canInvoice: boolean;
}) {
  const router = useRouter();
  const [references, setReferences] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One currency per firm today; mixed-currency reporting is a known,
  // accepted limitation of Tier 1 B.
  const currency = unbilled[0]?.currency ?? invoiced[0]?.currency ?? 'INR';
  const total = unbilled.reduce((sum, row) => sum + row.totalDeltaMinor, 0);

  async function run(id: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  function mark(row: ChangeOrderSummaryDto): void {
    const reference = (references[row.id] ?? '').trim();
    void run(row.id, async () => {
      await api<InvoicingDto>(`/v1/change-orders/${row.id}/invoicing`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: reference ? { invoiceReference: reference } : {},
      });
      setReferences((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    });
  }

  function clear(row: ChangeOrderSummaryDto): void {
    void run(row.id, () =>
      api(`/v1/change-orders/${row.id}/invoicing`, {
        method: 'DELETE',
        idempotencyKey: newIdempotencyKey(),
      }),
    );
  }

  return (
    <section className="panel panel-pad ledger" id="unbilled" aria-labelledby="unbilled-heading">
      <div className="row-between">
        <h2 id="unbilled-heading">Approved, not invoiced</h2>
        <strong className="tabular">{formatMoney(total, currency)}</strong>
      </div>
      <p className="small muted">
        {unbilled.length === 0
          ? 'Every approved change has been marked as invoiced.'
          : `${unbilled.length} approved change${unbilled.length === 1 ? '' : 's'} to bill.`}
        {canInvoice ? ' Mark each one once it is on an invoice.' : ''}
      </p>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {unbilled.length > 0 ? (
        <ul className="ledger-list">
          {unbilled.map((row) => (
            <li key={row.id} className="ledger-row">
              <div className="ledger-what">
                <Link href={`/app/changes/${row.id}`}>
                  <strong className="mono">{row.number}</strong>
                </Link>{' '}
                {row.title}
                <div className="small muted">
                  {row.projectNumber} {row.projectTitle} · approved {formatDate(row.decidedAt)}
                </div>
              </div>
              <div
                className={`ledger-amount tabular ${row.totalDeltaMinor < 0 ? 'amount-negative' : ''}`}
              >
                {formatMoney(row.totalDeltaMinor, row.currency)}
              </div>
              {canInvoice ? (
                <form
                  className="ledger-action"
                  onSubmit={(event) => {
                    event.preventDefault();
                    mark(row);
                  }}
                >
                  <label className="sr-only" htmlFor={`invoice-ref-${row.id}`}>
                    Invoice number for {row.number} (optional)
                  </label>
                  <input
                    id={`invoice-ref-${row.id}`}
                    type="text"
                    maxLength={100}
                    value={references[row.id] ?? ''}
                    onChange={(event) =>
                      setReferences((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                    placeholder="Invoice no. (optional)"
                  />
                  <button type="submit" className="btn btn-sm" disabled={busy !== null}>
                    {busy === row.id ? 'Marking…' : 'Mark invoiced'}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {invoiced.length > 0 ? (
        <>
          <h3 className="ledger-subhead">Recently invoiced</h3>
          <ul className="ledger-list">
            {invoiced.map((row) => (
              <li key={row.id} className="ledger-row">
                <div className="ledger-what">
                  <Link href={`/app/changes/${row.id}`}>
                    <strong className="mono">{row.number}</strong>
                  </Link>{' '}
                  {row.title}
                  <div className="small muted">
                    {row.projectNumber} {row.projectTitle} · invoiced {formatDate(row.invoicedAt)}
                  </div>
                </div>
                <div
                  className={`ledger-amount tabular ${row.totalDeltaMinor < 0 ? 'amount-negative' : ''}`}
                >
                  {formatMoney(row.totalDeltaMinor, row.currency)}
                </div>
                {canInvoice ? (
                  <div className="ledger-action">
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      disabled={busy !== null}
                      onClick={() => clear(row)}
                    >
                      {busy === row.id ? 'Clearing…' : 'Clear'}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
