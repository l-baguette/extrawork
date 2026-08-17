import { uuidv7 } from 'uuidv7';

/**
 * UUIDv7 identifiers — report §7.2: "UUIDv7 identifiers improve index locality;
 * never expose sequential database IDs."
 *
 * Generated in the application so an id is available before the INSERT, which
 * lets the audit event, the outbox payload and the row itself all reference the
 * same id inside one transaction.
 */
export function newId(): string {
  return uuidv7();
}

/** Sentinel used where `document_sequences.project_id` means "organization scope". */
export const ORG_SCOPE_UUID = '00000000-0000-0000-0000-000000000000';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
