/**
 * Stable machine-readable error codes. Clients branch on `code`, never on the
 * human message. Report §7.2 (error envelope) and Appendix B ("what stable error
 * codes may the client handle?").
 *
 * Adding a code is backwards compatible; changing the meaning of one is not.
 */
export const ERROR_CODES = {
  // --- Request shape -------------------------------------------------------
  VALIDATION_FAILED: 400,
  MALFORMED_JSON: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  MISSING_IDEMPOTENCY_KEY: 400,
  MISSING_IF_MATCH: 428,

  // --- Identity and access -------------------------------------------------
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  REAUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  ORGANIZATION_REQUIRED: 403,
  NOT_A_MEMBER: 403,
  ORGANIZATION_SUSPENDED: 403,

  // --- Resources -----------------------------------------------------------
  NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  CHANGE_ORDER_NOT_FOUND: 404,
  CONTACT_NOT_FOUND: 404,
  ATTACHMENT_NOT_FOUND: 404,
  EMPLOYEE_NOT_FOUND: 404,

  // --- Domain invariants ---------------------------------------------------
  INVALID_STATE_TRANSITION: 409,
  ALREADY_DECIDED: 409,
  VERSION_SUPERSEDED: 409,
  REQUEST_EXPIRED: 410,
  TOKEN_REVOKED: 410,
  TOKEN_INVALID: 404,
  LOCK_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  ETAG_MISMATCH: 412,
  CURRENCY_MISMATCH: 422,
  NEGATIVE_REVISED_TOTAL: 422,
  EMPTY_CHANGE: 422,
  // The typed name is the signature. Recording a decision under a name that is
  // not the approver's would attribute it to someone who did not make it.
  SIGNER_NAME_MISMATCH: 422,
  BASELINE_LOCKED: 409,
  PROJECT_CLOSED: 409,
  PROJECT_INTEGRITY_REVIEW: 409,
  ATTACHMENT_NOT_READY: 409,
  ATTACHMENT_IMMUTABLE: 409,
  DUPLICATE_NUMBER: 409,
  // A phone number identifies exactly one employee system-wide (migration 0005):
  // an inbound message from a number registered twice cannot be attributed to a
  // tenant, and guessing is the cross-tenant mistake §3.2 forbids.
  EMPLOYEE_PHONE_TAKEN: 409,

  // --- Assurance -----------------------------------------------------------
  ASSURANCE_REQUIRED: 403,
  ASSURANCE_UNAVAILABLE: 503,
  OTP_INVALID: 400,
  OTP_EXPIRED: 410,
  OTP_ATTEMPTS_EXCEEDED: 429,

  // --- Entitlements --------------------------------------------------------
  ENTITLEMENT_EXCEEDED: 402,
  SUBSCRIPTION_READ_ONLY: 402,
  FEATURE_NOT_ENTITLED: 402,

  // --- Files ---------------------------------------------------------------
  FILE_TYPE_NOT_ALLOWED: 415,
  FILE_TOO_LARGE: 413,
  FILE_SCAN_FAILED: 422,
  FILE_CONTENT_MISMATCH: 422,

  // --- Throughput ----------------------------------------------------------
  RATE_LIMITED: 429,

  // --- Providers and platform ---------------------------------------------
  WEBHOOK_SIGNATURE_INVALID: 401,
  PROVIDER_UNAVAILABLE: 502,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Human-safe default messages. They must never leak internals or tokens. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Some of the submitted values are not valid.',
  MALFORMED_JSON: 'The request body could not be parsed as JSON.',
  PAYLOAD_TOO_LARGE: 'The request body is larger than the allowed limit.',
  UNSUPPORTED_MEDIA_TYPE: 'This endpoint expects application/json.',
  MISSING_IDEMPOTENCY_KEY: 'This command requires an Idempotency-Key header.',
  MISSING_IF_MATCH: 'This update requires an If-Match header with the current version tag.',

  UNAUTHENTICATED: 'You need to sign in to continue.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  REAUTHENTICATION_REQUIRED: 'Please confirm your identity again to perform this action.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  CSRF_FAILED: 'The request could not be verified. Please refresh and try again.',
  ORGANIZATION_REQUIRED: 'Select an organization before continuing.',
  NOT_A_MEMBER: 'You are not a member of this organization.',
  ORGANIZATION_SUSPENDED: 'This organization is suspended. Contact support.',

  NOT_FOUND: 'The requested item could not be found.',
  CUSTOMER_NOT_FOUND: 'That customer could not be found.',
  PROJECT_NOT_FOUND: 'That project could not be found.',
  CHANGE_ORDER_NOT_FOUND: 'That change request could not be found.',
  CONTACT_NOT_FOUND: 'That contact could not be found.',
  ATTACHMENT_NOT_FOUND: 'That attachment could not be found.',
  EMPLOYEE_NOT_FOUND: 'That employee could not be found.',

  INVALID_STATE_TRANSITION: 'This change request cannot move to that state.',
  ALREADY_DECIDED: 'A decision has already been recorded for this request.',
  VERSION_SUPERSEDED: 'This request has been replaced by a newer version.',
  REQUEST_EXPIRED: 'This approval link has expired.',
  TOKEN_REVOKED: 'This approval link is no longer active.',
  TOKEN_INVALID: 'This approval link is not valid.',
  LOCK_CONFLICT: 'Someone else updated this draft. Review the differences before saving.',
  IDEMPOTENCY_KEY_REUSED: 'This idempotency key was already used with a different request.',
  IDEMPOTENCY_IN_PROGRESS: 'An identical request is still being processed. Retry shortly.',
  ETAG_MISMATCH: 'This request changed since you loaded it. Reload and try again.',
  CURRENCY_MISMATCH: 'The currency must match the project currency.',
  NEGATIVE_REVISED_TOTAL: 'This change would make the revised contract total negative.',
  EMPTY_CHANGE: 'A change request needs at least one line item or a schedule impact.',
  SIGNER_NAME_MISMATCH:
    'Enter your full name exactly as it appears on this request. Nothing has been recorded.',
  BASELINE_LOCKED:
    'The baseline cannot be edited after the first request is sent. Record a baseline amendment instead.',
  PROJECT_CLOSED: 'This project is closed.',
  PROJECT_INTEGRITY_REVIEW: 'This project is under integrity review. New sends are paused.',
  ATTACHMENT_NOT_READY: 'An attachment is still being processed. Try again in a moment.',
  ATTACHMENT_IMMUTABLE:
    'Attachments cannot be removed after a version is sent. Create a revision instead.',
  DUPLICATE_NUMBER: 'That document number is already in use.',
  EMPLOYEE_PHONE_TAKEN: 'That phone number is already registered to an employee.',

  ASSURANCE_REQUIRED: 'Additional verification is required before you can decide.',
  ASSURANCE_UNAVAILABLE: 'The required verification method is unavailable right now.',
  OTP_INVALID: 'That code is not correct.',
  OTP_EXPIRED: 'That code has expired. Request a new one.',
  OTP_ATTEMPTS_EXCEEDED: 'Too many attempts. Please wait before trying again.',

  ENTITLEMENT_EXCEEDED: 'Your plan limit for this action has been reached.',
  SUBSCRIPTION_READ_ONLY:
    'Your subscription is inactive. Existing records remain readable and exportable.',
  FEATURE_NOT_ENTITLED: 'Your plan does not include this feature.',

  FILE_TYPE_NOT_ALLOWED: 'That file type is not allowed.',
  FILE_TOO_LARGE: 'That file is larger than the allowed limit.',
  FILE_SCAN_FAILED: 'That file did not pass the safety scan.',
  FILE_CONTENT_MISMATCH: 'The uploaded file does not match what was declared.',

  RATE_LIMITED: 'Too many requests. Please slow down and try again.',

  WEBHOOK_SIGNATURE_INVALID: 'The webhook signature could not be verified.',
  PROVIDER_UNAVAILABLE: 'An upstream provider is unavailable. The action was not completed.',
  NOT_IMPLEMENTED: 'That capability is not available in this release.',
  INTERNAL_ERROR: 'Something went wrong on our side. The action may not have been completed.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
};

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

/**
 * The single error type crossing the application boundary. Domain and
 * application layers throw it; the HTTP layer renders it. Carrying the code
 * (not the status) keeps transport concerns out of the domain.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** Errors flagged as expected are logged at `warn`, not `error`. */
  readonly expected: boolean;

  constructor(
    code: ErrorCode,
    options: { message?: string; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(options.message ?? ERROR_MESSAGES[code], { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = options.details;
    this.expected = this.status < 500;
  }

  static is(value: unknown): value is AppError {
    return value instanceof AppError;
  }

  toEnvelope(requestId: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
