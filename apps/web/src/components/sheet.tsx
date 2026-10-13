import Link from 'next/link';
import { IconChevron } from './icons';

/**
 * The sheet primitives every page is built from.
 *
 * One row grammar across changes, projects, employees and inbound messages is
 * what makes this feel like one document rather than seven screens that happen
 * to share a stylesheet. A schedule earns its legibility by never varying its
 * columns, and the same holds here: mark on the left, code beside it, subject
 * in the middle, figure right-aligned.
 */

export function SheetTop({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="sheet-top">
      <div className="sheet-top-inner">
        <div className="sheet-title-block">
          <h1>{title}</h1>
          {meta ? <div className="sheet-sub">{meta}</div> : null}
        </div>
        {actions ? <div className="sheet-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Block({
  title,
  action,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="block">
      {title ? (
        <div className="block-head">
          <h2 className="section-title">{title}</h2>
          {action ? <div className="block-head-action">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Schedule({
  columns,
  children,
}: {
  columns: [string, string, string, string, string];
  children: React.ReactNode;
}) {
  return (
    <div className="schedule">
      <div className="schedule-head" role="presentation">
        <span>{columns[0]}</span>
        <span>{columns[1]}</span>
        <span>{columns[2]}</span>
        <span>{columns[3]}</span>
        <span>{columns[4]}</span>
        <span />
      </div>
      {children}
    </div>
  );
}

/**
 * One schedule row. `href` makes the whole row the target rather than a link
 * buried inside it — a 56px row is a far easier thing to hit than a number, and
 * the affordance is the row, so the hit area should be too.
 */
export function ScheduleRow({
  mark,
  code,
  title,
  sub,
  amount,
  amountNote,
  href,
}: {
  mark: React.ReactNode;
  code: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  amount: React.ReactNode;
  amountNote?: React.ReactNode;
  href?: string;
}) {
  const inner = (
    <>
      <span className="schedule-mark">{mark}</span>
      <span>{code}</span>
      <span className="schedule-title">
        {title}
        {sub ? <span className="schedule-sub"> · {sub}</span> : null}
      </span>
      <span className="schedule-amount">{amount}</span>
      <span className="schedule-note">{amountNote ?? ''}</span>
      {href ? <IconChevron className="schedule-chevron" /> : <span />}
    </>
  );

  if (!href) return <div className="schedule-row">{inner}</div>;
  return (
    <Link className="schedule-row" href={href}>
      {inner}
    </Link>
  );
}

export function Figure({
  label,
  value,
  note,
  small = false,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="figure">
      <div className="stat-label">{label}</div>
      <span className={small ? 'stat-value stat-value-sm' : 'stat-value'}>{value}</span>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

/**
 * An empty schedule keeps its ruling, so the shape of what will arrive is
 * legible before the first row exists. A blank panel with a sentence in it
 * teaches nothing about what the table is for.
 */
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-inner">
        <h3>{title}</h3>
        {children ? <p>{children}</p> : null}
        {action ? <div style={{ marginTop: 'var(--s4)' }}>{action}</div> : null}
      </div>
    </div>
  );
}
