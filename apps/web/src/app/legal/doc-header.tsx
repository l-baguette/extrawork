import { POLICY_VERSION } from '@extrawork/contracts';
import { legalIdentity } from '@/lib/legal';

/**
 * The title block for a published document.
 *
 * Set like the title block on a drawing rather than a web page header: the name
 * of the sheet, one line saying what it is for, then a ruled strip of labelled
 * cells recording which revision the reader is holding and who issued it. That
 * strip is the difference between a policy that reads as *issued* and one that
 * reads as marketing copy, and it is the first thing a payment aggregator or a
 * regulator looks for.
 */
export function DocHeader({
  code,
  title,
  standfirst,
}: {
  /** Short document code shown in the title block, e.g. `PRIVACY`. */
  code: string;
  title: string;
  standfirst: React.ReactNode;
}) {
  const identity = legalIdentity();

  return (
    <header className="doc-head">
      <h1>{title}</h1>
      <p className="doc-standfirst">{standfirst}</p>

      <dl className="doc-meta">
        <div>
          <dt>Document</dt>
          <dd>{code}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{POLICY_VERSION}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>{POLICY_VERSION}</dd>
        </div>
        <div>
          <dt>Issued by</dt>
          <dd>{identity.entityName}</dd>
        </div>
      </dl>
    </header>
  );
}
