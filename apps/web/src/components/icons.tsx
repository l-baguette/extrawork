/**
 * Icons drawn in the schedule's own grammar.
 *
 * A stock icon set inside a committed form is the lapse that gives a design
 * away, so these are drawn to the same rules as everything else: a 16px grid,
 * 1.5px strokes, square caps and joins, no curves where a corner would do. They
 * read as marks on a drawing rather than as app furniture.
 */

type IconProps = { className?: string };

function Svg({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flex: '0 0 auto' }}
    >
      {children}
    </svg>
  );
}

/** A ruled sheet — the schedule itself. */
export function IconSheet(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" />
      <path d="M2.25 6h11.5M2.25 9.5h11.5M6 6v7.75" />
    </Svg>
  );
}

/** Stacked slabs — a project rising. */
export function IconProjects(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.25" y="9.25" width="11.5" height="4.5" />
      <rect x="4.25" y="5.25" width="7.5" height="4" />
      <path d="M6.25 5.25v-3h3.5v3" />
    </Svg>
  );
}

/** An inbound mark — a message arriving from outside the sheet. */
export function IconRequests(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" />
      <path d="M2.25 3.25 8 8.25l5.75-5" />
    </Svg>
  );
}

/** A tally of people. */
export function IconEmployees(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.25" y="2.25" width="4.5" height="4.5" />
      <path d="M2.25 13.75v-2.5a2 2 0 0 1 2-2h4.5a2 2 0 0 1 2 2v2.5" />
      <path d="M11 6.25h2.75M11 9.25h2.75" />
    </Svg>
  );
}

/** A client record card. */
export function IconCustomers(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" />
      <rect x="4.5" y="5.5" width="3.5" height="3.5" />
      <path d="M10 6.25h3.75M10 9h3.75M4.5 11h9.25" />
    </Svg>
  );
}

/** A bar chart with a baseline — the totals sheet. */
export function IconReports(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.25 13.75h11.5" />
      <rect x="3.25" y="8.25" width="2.5" height="4" />
      <rect x="6.75" y="5.25" width="2.5" height="7" />
      <rect x="10.25" y="2.75" width="2.5" height="9.5" />
    </Svg>
  );
}

/** A set square — the tool you change the drawing with. */
export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 13.5 13.5 13.5 13.5 2.5Z" />
      <path d="M6 11.5h5.5M8.25 9h3.25" />
    </Svg>
  );
}

/** A handset — the WhatsApp simulator. */
export function IconSimulator(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.25" y="1.75" width="7.5" height="12.5" />
      <path d="M6.75 12.25h2.5" />
      <path d="M6.5 4.25h3" />
    </Svg>
  );
}

/** Row affordance. */
export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 3.5 5 4.5-5 4.5" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.75v10.5M2.75 8h10.5" />
    </Svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.25 4h11.5M2.25 8h11.5M2.25 12h11.5" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
    </Svg>
  );
}

export function IconSignOut(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.75 2.75H2.75v10.5h7" />
      <path d="M6.5 8h6.75M10.75 5.5 13.25 8l-2.5 2.5" />
    </Svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.25" y="2.25" width="5.5" height="5.5" />
      <path d="M2.75 13.75v-1.5a3 3 0 0 1 3-3h4.5a3 3 0 0 1 3 3v1.5" />
    </Svg>
  );
}

export function IconBuilding(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.75" y="2.25" width="7.5" height="11.5" />
      <path d="M10.25 6.25h3v7.5" />
      <path d="M5 5h2.5M5 7.75h2.5M5 10.5h2.5" />
    </Svg>
  );
}

/** A calendar sheet — the timeline. */
export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.25" y="3.25" width="11.5" height="10.5" />
      <path d="M2.25 6.5h11.5M5.5 1.75v3M10.5 1.75v3M5 9h1.5M9.5 9H11M5 11.5h1.5" />
    </Svg>
  );
}

/** A tray with a notch — the inbox. */
export function IconInbox(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.25 9.25V13.75h11.5V9.25M2.25 9.25 4 2.75h8l1.75 6.5M2.25 9.25h3.5l.75 1.75h3l.75-1.75h3.5" />
    </Svg>
  );
}

/** A folder — project files. */
export function IconFolder(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.25 4.25v9.5h11.5v-7.5H7.5L6 4.25z" />
    </Svg>
  );
}

/** Two people side by side — collaborators. */
export function IconPeople(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7.25a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM11.5 7.25a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM1.5 13v-1.75L3 9.75h2l1.5 1.5V13M9 13v-1.75l1.5-1.5h2l1.5 1.5V13" />
    </Svg>
  );
}

/** A chain link — a linked folder. */
export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.75 9.25 9.25 6.75M5.5 7.5 3.75 9.25a2.12 2.12 0 0 0 3 3L8.5 10.5M10.5 8.5l1.75-1.75a2.12 2.12 0 0 0-3-3L7.5 5.5" />
    </Svg>
  );
}

/** A switch between two sheets — the workspace switcher. */
export function IconSwap(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 5.5h9.5L10 3M13 10.5H3.5L6 13" />
    </Svg>
  );
}

/** A tick in a box — reviewed. */
export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3.5 8.5 3 3 6-7" />
    </Svg>
  );
}

/** A page with a folded corner — a document or note. */
export function IconDocument(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.25 1.75v12.5h9.5V5.25l-3.5-3.5zM9.25 1.75v3.5h3.5M5.5 8.5h5M5.5 11h5" />
    </Svg>
  );
}

/** An upward arrow out of a tray — upload. */
export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 10.5V2.5M4.75 5.5 8 2.25l3.25 3.25M2.25 10v3.75h11.5V10" />
    </Svg>
  );
}
