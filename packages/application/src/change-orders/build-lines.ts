import { AppError, type LineItemInput } from '@extrawork/contracts';
import type { LineItemWrite } from '@extrawork/db';
import { calculateLine, type LineItemCalcInput } from '@extrawork/domain';

/**
 * Converts wire line items into calculated rows. Every path that writes line
 * items goes through here, so the stored `subtotal/tax/total` can only ever be
 * what the canonical engine produced (ADR-005).
 */
export function toCalcInputs(lines: readonly LineItemInput[]): LineItemCalcInput[] {
  return lines.map((line) => ({
    quantity: line.quantity,
    unitPriceMinor: BigInt(line.unitPriceMinor),
    taxRateBps: line.taxRateBps,
    direction: line.direction,
  }));
}

export function buildLineItemWrites(lines: readonly LineItemInput[]): LineItemWrite[] {
  return lines.map((line) => {
    const calc = calculateLine({
      quantity: line.quantity,
      unitPriceMinor: BigInt(line.unitPriceMinor),
      taxRateBps: line.taxRateBps,
      direction: line.direction,
    });
    return {
      description: line.description,
      quantity: line.quantity,
      unit: line.unit ?? null,
      direction: line.direction,
      unitPriceMinor: BigInt(line.unitPriceMinor),
      taxRateBps: line.taxRateBps,
      subtotalMinor: calc.subtotalMinor,
      taxMinor: calc.taxMinor,
      totalMinor: calc.totalMinor,
    };
  });
}

/**
 * ETag for *contractor* optimistic concurrency on a draft (report §7.2, §6.3).
 * `lock_version` is the right basis here: it moves on every write, which is
 * exactly what a concurrent-edit guard needs.
 */
export function versionEtag(versionId: string, lockVersion: number): string {
  return `"${versionId}:${lockVersion}"`;
}

/**
 * ETag for the *public* decision POST (report §4.5).
 *
 * Deliberately NOT `lock_version`. The question the customer's `If-Match`
 * answers is "am I deciding on exactly what I was shown?", and the answer is
 * the frozen canonical snapshot, which report §8.3 calls the commercial
 * identity of the version. `lock_version` moves for reasons that change nothing
 * the customer can see — most importantly the SENT -> VIEWED transition written
 * during their own first page load, which would otherwise make the ETag stale
 * before they could ever use it.
 *
 * A superseding revision is a different version with its own token, so the
 * supersede case is caught by token revocation, not by this tag.
 */
export function publicDecisionEtag(version: {
  id: string;
  canonicalSha256: Buffer | null;
}): string {
  if (!version.canonicalSha256) {
    // A sent version always has a frozen snapshot; the database enforces it.
    throw new AppError('INTERNAL_ERROR', {
      message: 'A sent version is missing its canonical snapshot digest',
    });
  }
  return `"${version.canonicalSha256.toString('hex').slice(0, 32)}"`;
}

/** Compares a submitted `If-Match` against an expected tag, tolerating `W/` and `*`. */
export function etagMatches(submitted: string | undefined, expected: string): boolean {
  if (!submitted) return true;
  const cleaned = submitted.replace(/^W\//, '').trim();
  return cleaned === '*' || cleaned === expected;
}

export function parseEtag(
  etag: string | undefined,
): { versionId: string; lockVersion: number } | null {
  if (!etag) return null;
  const cleaned = etag.replace(/^W\//, '').replace(/^"|"$/g, '');
  const [versionId, lockVersion] = cleaned.split(':');
  if (!versionId || !lockVersion) return null;
  const parsed = Number.parseInt(lockVersion, 10);
  if (Number.isNaN(parsed)) return null;
  return { versionId, lockVersion: parsed };
}
