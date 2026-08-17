/**
 * JSON Canonicalization Scheme (RFC 8785).
 *
 * Report §8.3 requires a documented canonicalizer so that a snapshot digest is
 * reproducible: "Serialize with JSON Canonicalization Scheme or an equivalently
 * documented canonicalizer, then compute SHA-256."
 *
 * The rules implemented here:
 *  - object members are sorted by the UTF-16 code-unit sequence of their names;
 *  - no insignificant whitespace;
 *  - strings use the shortest escape form defined by RFC 8785 §3.2.2.2;
 *  - numbers are serialised with ECMAScript `Number::toString` semantics
 *    (ES2020 §7.1.12.1), which is what `String(n)` produces, except that
 *    exponential forms are normalised per RFC 8785 §3.2.2.3;
 *  - `undefined`, functions and symbols are not representable and throw, so a
 *    field can never be silently dropped from evidence.
 *
 * `CANONICALIZER_VERSION` is stored alongside every digest. If this algorithm
 * ever changes, the version changes with it and old digests stay verifiable.
 */
export const CANONICALIZER_VERSION = 'jcs-rfc8785-v1';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

const ESCAPES: Record<string, string> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
};

function serializeString(value: string): string {
  let out = '"';
  for (const char of value) {
    const escape = ESCAPES[char];
    if (escape) {
      out += escape;
      continue;
    }
    const code = char.codePointAt(0) as number;
    // RFC 8785: control characters below 0x20 use \u00XX; everything else is literal.
    out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : char;
  }
  return `${out}"`;
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError('NaN and Infinity cannot be canonicalized');
  }
  // -0 canonicalizes to 0 (RFC 8785 §3.2.2.3).
  if (value === 0) return '0';

  const text = String(value);
  // ES `toString` emits e.g. "1e+21" / "1e-7"; RFC 8785 keeps that form but
  // normalises the exponent sign and drops a leading zero in the exponent.
  if (!text.includes('e')) return text;
  const [mantissa, exponent] = text.split('e') as [string, string];
  const sign = exponent.startsWith('-') ? '-' : '+';
  const digits = exponent.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '');
  return `${mantissa}e${sign}${digits}`;
}

/**
 * Sorts by UTF-16 code units, which is what `Array.prototype.sort` on strings
 * already does in JavaScript, matching RFC 8785 §3.2.3.
 */
function sortKeys(keys: string[]): string[] {
  return [...keys].sort();
}

function serializeValue(value: unknown, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value);
    case 'bigint':
      // Deliberate: a bigint has no JSON representation, and silently coercing
      // one would make an evidence digest depend on a lossy conversion.
      throw new CanonicalizationError(
        `bigint at ${path} must be converted to a string or safe integer before canonicalization`,
      );
    case 'string':
      return serializeString(value);
    case 'undefined':
      throw new CanonicalizationError(`undefined at ${path} cannot be canonicalized`);
    case 'function':
    case 'symbol':
      throw new CanonicalizationError(`${typeof value} at ${path} cannot be canonicalized`);
    default:
      break;
  }

  if (Array.isArray(value)) {
    const parts = value.map((item, index) => serializeValue(item, `${path}[${index}]`));
    return `[${parts.join(',')}]`;
  }

  if (value instanceof Date) {
    throw new CanonicalizationError(
      `Date at ${path} must be converted to an ISO string before canonicalization`,
    );
  }

  const record = value as Record<string, unknown>;
  const keys = sortKeys(Object.keys(record));
  const members = keys.map((key) => {
    const child = record[key];
    if (child === undefined) {
      throw new CanonicalizationError(`undefined at ${path}.${key} cannot be canonicalized`);
    }
    return `${serializeString(key)}:${serializeValue(child, `${path}.${key}`)}`;
  });
  return `{${members.join(',')}}`;
}

/** Returns the canonical UTF-8 JSON text for a value. */
export function canonicalize(value: unknown): string {
  return serializeValue(value, '$');
}

/** Canonical bytes, which is what gets hashed. */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), 'utf8');
}
