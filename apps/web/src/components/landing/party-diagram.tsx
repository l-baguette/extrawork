/**
 * The three parties and what moves between them, drawn with HTML and CSS
 * rather than as a picture.
 *
 * An SVG would not reflow: at 360px it either shrinks its labels below reading
 * size or scrolls sideways. As markup, the same diagram runs left to right on a
 * desk and top to bottom on a phone, and a screen reader hears each arrow as a
 * sentence ("From the homeowner to you: questions and change requests, on
 * WhatsApp or their project page") instead of an unlabelled shape.
 *
 * The designer sits in the middle in an ink block, the system's one heavy
 * surface, because spec 2026-10-12 puts them there: everything goes through
 * the designer, and only the designer changes the record (D3, D4).
 */

interface Lane {
  what: string;
  via: string;
  /** Read before `what` by assistive technology; the arrow says it visually. */
  spoken: string;
}

function Node({
  title,
  who,
  children,
  centre = false,
}: {
  title: string;
  who: string;
  children: React.ReactNode;
  centre?: boolean;
}) {
  return (
    <div className={centre ? 'lp-node lp-node-centre' : 'lp-node'}>
      <div className="lp-node-head">
        <h3>{title}</h3>
        <p className="lp-node-who">{who}</p>
      </div>
      <div className="lp-node-body">{children}</div>
    </div>
  );
}

function Exchange({ forward, back }: { forward: Lane; back: Lane }) {
  return (
    <div className="lp-link">
      <p className="lp-lane lp-lane-forward">
        <span className="lp-arrow" aria-hidden="true" />
        <span className="lp-lane-text">
          <span className="sr-only">{forward.spoken} </span>
          <span className="lp-lane-what">{forward.what}</span>
          <span className="lp-lane-via">{forward.via}</span>
        </span>
      </p>
      <p className="lp-lane lp-lane-back">
        <span className="lp-arrow" aria-hidden="true" />
        <span className="lp-lane-text">
          <span className="sr-only">{back.spoken} </span>
          <span className="lp-lane-what">{back.what}</span>
          <span className="lp-lane-via">{back.via}</span>
        </span>
      </p>
    </div>
  );
}

export function PartyDiagram() {
  return (
    <figure className="lp-flow" aria-labelledby="lp-flow-caption">
      <div className="lp-flow-grid">
        <Node title="Construction company" who="Site supervisor, foreman, contractor">
          <p>Raises requests and sends photos and files from site.</p>
          <p className="lp-node-channel">
            WhatsApp, with no login. Anyone you invite can also use the web app.
          </p>
        </Node>

        <Exchange
          forward={{
            what: 'Requests, photos and files',
            via: 'on WhatsApp',
            spoken: 'From the construction company to you:',
          }}
          back={{
            what: 'Where each request stands',
            via: 'in the web app, or by asking on WhatsApp',
            spoken: 'From you to the construction company:',
          }}
        />

        <Node centre title="You, the designer" who="Interior designer or architect">
          <p>
            Checks each request, adds the price and the drawings, and sends it to the client or sets
            it aside. Only you change the project record.
          </p>
          <p className="lp-node-channel">The web app, on a laptop or a phone.</p>
        </Node>

        <Exchange
          forward={{
            what: 'A checked, priced request to decide',
            via: 'by a private link',
            spoken: 'From you to the homeowner:',
          }}
          back={{
            what: 'Change requests, photos and notes',
            via: 'on WhatsApp or their project page',
            spoken: 'From the homeowner to you:',
          }}
        />

        <Node title="Homeowner" who="Your client">
          <p>Sees the project, approves or declines each request, or asks for a change.</p>
          <p className="lp-node-channel">A link on their phone. No account.</p>
        </Node>
      </div>
      <figcaption id="lp-flow-caption" className="lp-flow-caption">
        The construction company and the homeowner never edit the record directly. What they send
        reaches you first, and the client only decides on what you send.
      </figcaption>
    </figure>
  );
}
