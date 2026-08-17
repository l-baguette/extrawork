/**
 * Row value coercion for raw SQL results.
 *
 * Why this exists: `drizzle.execute()` on node-postgres installs its own type
 * parsers that deliberately return **strings** for `timestamptz`, `timestamp`,
 * `date` and `interval`, so that Drizzle's typed query builder can apply its
 * own column mappers. Raw `sql` templates get no such mapper, so a column the
 * TypeScript type calls a `Date` arrives as a string at runtime and
 * `.toISOString()` throws.
 *
 * The repository layer uses explicit SQL on purpose (report §9.1: "Drizzle plus
 * explicit SQL", §14.4: locks and constraints must stay visible), so every
 * mapper runs its values through these helpers. That makes the string/Date
 * boundary explicit at exactly one layer instead of depending on driver
 * internals that are not configurable.
 *
 * `bigint` gets the same treatment for a different reason: node-postgres
 * returns `int8` as a string to avoid silent precision loss, and money in this
 * system is always `bigint` (report §8.1), never a JavaScript number.
 */

export function toDate(value: unknown): Date {
  const parsed = toDateOrNull(value);
  if (!parsed) {
    throw new TypeError(`Expected a timestamp, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(normalizePostgresTimestamp(value));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }
  return null;
}

/**
 * PostgreSQL renders `timestamptz` as `2026-08-14 06:00:17.366842-04`, which is
 * not ISO-8601 in two ways: a space instead of `T`, and an hour-only timezone
 * offset. Parsing of non-ISO date strings is implementation-defined, so both
 * are normalised before `new Date` sees the value.
 *
 * A timestamp with no offset at all is UTC: the database stores `timestamptz`
 * and every write goes through `.toISOString()`, per report §2.2 ("timestamps
 * are stored in UTC"). Leaving it offset-less would make the parse depend on
 * the server's local timezone.
 */
export function normalizePostgresTimestamp(value: string): string {
  let text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}[ T]/.test(text)) return text;
  text = text.replace(' ', 'T');

  // `+05`, `-04`  ->  `+05:00`, `-04:00`
  text = text.replace(/([+-]\d{2})$/, '$1:00');
  // `+0530`       ->  `+05:30`
  text = text.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');

  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(text);
  return hasZone ? text : `${text}Z`;
}

/**
 * `date` columns (no time component) stay as `YYYY-MM-DD` strings all the way
 * to the API, per report §7.2. This only strips a time part if the driver
 * added one.
 */
export function toLocalDateOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : null;
}

export function toBigInt(value: unknown): bigint {
  const parsed = toBigIntOrNull(value);
  if (parsed === null) {
    throw new TypeError(`Expected an integer, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function toBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new TypeError(`Refusing to coerce non-integer ${value} to bigint`);
    }
    return BigInt(value);
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) return null;
  return BigInt(text);
}

export function toInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return Math.trunc(value);
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function toBoolean(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  return text === 't' || text === 'true' || text === '1';
}

/** `bytea` arrives as a Buffer, but survives a hex round-trip defensively. */
export function toBuffer(value: unknown): Buffer {
  const parsed = toBufferOrNull(value);
  if (!parsed) throw new TypeError('Expected a bytea value');
  return parsed;
}

export function toBufferOrNull(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  const text = String(value);
  return Buffer.from(text.startsWith('\\x') ? text.slice(2) : text, 'hex');
}

/** `jsonb` is already parsed by node-postgres; this guards a string fallback. */
export function toJsonOrNull<T = Record<string, unknown>>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

/** `integer[]` may arrive as a Postgres array literal string. */
export function toIntArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((v) => toInt(v));
  if (typeof value === 'string') {
    return value
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((part) => part.length > 0)
      .map((part) => toInt(part));
  }
  return [];
}
