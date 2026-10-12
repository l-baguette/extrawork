/**
 * How WhatsApp works for the site team, shown as one short exchange rather than
 * described.
 *
 * Each turn demonstrates one rule from spec 2026-10-12 ("WhatsApp conversation
 * rules", D6): a sender on two projects is asked which one, once; the answer
 * sticks, so the second message is not asked again; photos without change
 * language are saved as files; a message with a price and "can we" becomes a
 * request for the designer to review; every reply names the one word that
 * corrects it. The reply wording is illustrative and the caption says so,
 * because the exact text belongs to the WhatsApp service and may change.
 *
 * Set as a ruled log, not as chat bubbles: it is a record of what was sent and
 * what happened, and imitating the WhatsApp interface would suggest this page
 * is something it is not.
 */

interface Turn {
  from: 'site' | 'extrawork';
  text: string[];
  attachment?: string;
}

const TURNS: Turn[] = [
  {
    from: 'site',
    attachment: '3 photos',
    text: ['Kitchen false ceiling done.'],
  },
  {
    from: 'extrawork',
    text: [
      'Which project is this for? Reply with a number.',
      '1  P-0004 3BHK, Baner',
      '2  P-0006 Villa, Wakad',
    ],
  },
  { from: 'site', text: ['1'] },
  {
    from: 'extrawork',
    text: [
      'Saved 3 photos to P-0004, in the From WhatsApp folder. Your designer can see them.',
      'Reply REQUEST if this was a change request.',
    ],
  },
  {
    from: 'site',
    text: ['Can we add 2 more points above the counter? ₹4,500 extra, no delay.'],
  },
  {
    from: 'extrawork',
    text: [
      'Request P-0004-R05 is with your designer for review.',
      'Reply FILE if this was only a note.',
    ],
  },
];

export function WhatsAppThread() {
  return (
    <figure className="lp-thread">
      <ol className="lp-thread-log">
        {TURNS.map((turn, i) => (
          <li key={i} className={turn.from === 'site' ? 'lp-turn' : 'lp-turn lp-turn-reply'}>
            <span className="lp-turn-who">
              {turn.from === 'site' ? 'Site supervisor' : 'ExtraWork'}
            </span>
            <div className="lp-turn-text">
              {turn.attachment ? <span className="lp-turn-attach">{turn.attachment}</span> : null}
              {turn.text.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="lp-thread-caption">
        An example. The second message is not asked about again: the project is remembered for two
        hours.
      </figcaption>
    </figure>
  );
}
