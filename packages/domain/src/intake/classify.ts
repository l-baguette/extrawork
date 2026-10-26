/**
 * What a WhatsApp message is for — spec 2026-10-12, D6 and the "WhatsApp
 * conversation rules".
 *
 * WhatsApp becomes a project channel rather than a request form, so every
 * inbound message is one of three things:
 *
 *   - a COMMAND the bot answers (help, projects, contracts, a numbered choice,
 *     or a one-word correction of the last item);
 *   - a REQUEST, which becomes a proposal for the designer to review;
 *   - CONTENT — photos, files, a note — filed into the project's
 *     "From WhatsApp" folder.
 *
 * The rule the spec settles on is to classify and offer a one-word correction,
 * never to ask "request or file?" every time: asking would add exactly the
 * friction the notes warn against, and a wrong guess costs one word to undo.
 * So this errs towards CONTENT when nothing in the message points at a change:
 * filing a request as a note loses nothing, while turning a site photo into a
 * request puts a phantom change in front of the homeowner's designer.
 *
 * Pure: no I/O, no clock. The intake service supplies the parser's signals.
 */

export type IntakeCommand =
  | { command: 'HELP' }
  | { command: 'PROJECTS' }
  | { command: 'CONTRACTS' }
  | { command: 'STATUS' }
  /** Re-file the last item as a change request. */
  | { command: 'CONVERT_TO_REQUEST' }
  /** Re-file the last item as a file or note, withdrawing the request. */
  | { command: 'CONVERT_TO_CONTENT' }
  /** An answer to "which project?": a 1-based list position. */
  | { command: 'CHOOSE'; index: number }
  /** An answer naming the project by its number, e.g. "P-0004". */
  | { command: 'CHOOSE_PROJECT'; projectNumber: string };

export type MessageIntent =
  | ({ kind: 'COMMAND' } & IntakeCommand)
  | { kind: 'REQUEST'; reasons: RequestSignal[] }
  | { kind: 'CONTENT' };

/** Why a message was read as a request — logged with the inbound row. */
export type RequestSignal = 'AMOUNT' | 'DAYS' | 'LABELLED_FIELDS' | 'CHANGE_LANGUAGE';

export interface ParserSignals {
  /** The parser found a price it could read (even an ambiguous one). */
  hasAmount: boolean;
  /** The parser found a time impact in days. */
  hasDays: boolean;
  /** How many `label: value` lines the parser recognised (cost:, why:, …). */
  labelledFieldCount: number;
}

const COMMANDS: ReadonlyArray<[RegExp, IntakeCommand]> = [
  [/^(help|\?|menu|format|how)$/, { command: 'HELP' }],
  [/^(projects?|my projects|list)$/, { command: 'PROJECTS' }],
  [
    /^(contracts?|records?|history|past contracts|all contracts|documents|approvals)$/,
    { command: 'CONTRACTS' },
  ],
  [/^(status|pending|open requests?)$/, { command: 'STATUS' }],
  [/^(request|change|make it a request|it'?s a request)$/, { command: 'CONVERT_TO_REQUEST' }],
  [/^(file|note|just a file|just a note|save it|it'?s a file)$/, { command: 'CONVERT_TO_CONTENT' }],
];

/**
 * Change language, matched as whole words or phrases. Kept to what a
 * contractor or homeowner actually writes when they want something different
 * from the agreed scope, in English and the common Hinglish forms.
 */
const CHANGE_PATTERNS: readonly RegExp[] = [
  /\bcan (we|you)\b/,
  /\bcould (we|you)\b/,
  /\bplease (add|change|remove|shift|move|replace|make|do|put|fix|extend|increase|reduce)\b/,
  /\b(we|i) (want|need|would like)\b/,
  /\binstead of\b/,
  /\brather than\b/,
  /\b(extra|additional) (work|cost|charge|charges|item|items|point|points)\b/,
  /\bchange (the|it|this|to)\b/,
  /\b(shift|relocate|replace|remove) (the|it|this|a|an)\b/,
  /\badd (a|an|one|two|three|four|another|more)\b/,
  /\bupgrade\b/,
  /\bkar ?do\b/,
  /\bchahiye\b/,
  /\bbadal\b/,
];

/**
 * Reads a pending "which project?" answer. Only meaningful while the sender has
 * a pending choice; the service decides that, this only parses.
 */
export function parseChoice(body: string): IntakeCommand | null {
  const text = body.trim();
  const index = /^(?:#|no\.?\s*)?(\d{1,2})[.)]?$/i.exec(text);
  if (index?.[1]) {
    const value = Number.parseInt(index[1], 10);
    if (value >= 1) return { command: 'CHOOSE', index: value };
  }
  const project = /^p\s*-?\s*(\d{1,6})$/i.exec(text);
  if (project?.[1]) {
    return { command: 'CHOOSE_PROJECT', projectNumber: `P-${project[1].padStart(4, '0')}` };
  }
  return null;
}

export function detectCommand(body: string): IntakeCommand | null {
  const text = body
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');
  if (text.length === 0 || text.length > 40) return null;
  for (const [pattern, command] of COMMANDS) {
    if (pattern.test(text)) return command;
  }
  return null;
}

export function hasChangeLanguage(body: string): boolean {
  const text = body.toLowerCase().replace(/\s+/g, ' ');
  return CHANGE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Classifies a message that is not a pending choice. `mediaCount` matters only
 * in one direction: a photo with no words is content, but a photo whose
 * caption asks for a change is a request with its evidence attached.
 */
export function classifyMessage(
  body: string,
  mediaCount: number,
  signals: ParserSignals,
): MessageIntent {
  const command = detectCommand(body);
  if (command && mediaCount === 0) return { kind: 'COMMAND', ...command };

  const reasons: RequestSignal[] = [];
  if (signals.hasAmount) reasons.push('AMOUNT');
  if (signals.hasDays) reasons.push('DAYS');
  // One label could be a caption ("site: Sharma flat"); two or more is the
  // documented request format.
  if (signals.labelledFieldCount >= 2) reasons.push('LABELLED_FIELDS');
  if (hasChangeLanguage(body)) reasons.push('CHANGE_LANGUAGE');

  if (reasons.length > 0) return { kind: 'REQUEST', reasons };
  return { kind: 'CONTENT' };
}
