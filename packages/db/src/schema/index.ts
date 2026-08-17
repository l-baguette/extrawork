import {
  bigint,
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema mirroring `migrations/*.sql`.
 *
 * The SQL migrations are authoritative — they carry the CHECK constraints,
 * partial indexes and triggers that Drizzle cannot express, and report §9.1
 * explicitly wants "Drizzle plus explicit SQL". This file exists for typed
 * queries; `pnpm --filter @extrawork/db typecheck` plus the integration tests
 * keep the two in step.
 */

// --- Custom column types ---------------------------------------------------

/** bigint that reaches TypeScript as a real bigint, never a lossy number. */
const bigintNumeric = customType<{ data: bigint; driverData: string }>({
  dataType: () => 'bigint',
  fromDriver: (value) => BigInt(value),
  toDriver: (value) => value.toString(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** numeric(18,3) kept as a decimal string so it never becomes a float. */
const decimalString = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(18,3)',
});

const intArray = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'integer[]',
  fromDriver: (value) =>
    value
      .replace(/^{|}$/g, '')
      .split(',')
      .filter(Boolean)
      .map((v) => Number.parseInt(v, 10)),
  toDriver: (value) => `{${value.join(',')}}`,
});

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

// --- Enums -----------------------------------------------------------------

export const membershipRole = pgEnum('membership_role', [
  'OWNER',
  'ADMIN',
  'PROJECT_MANAGER',
  'FINANCE',
  'VIEWER',
]);
export const projectStatus = pgEnum('project_status', [
  'ACTIVE',
  'ON_HOLD',
  'CLOSED',
  'ARCHIVED',
  'INTEGRITY_REVIEW',
]);
export const changeType = pgEnum('change_type', [
  'ADDITION',
  'DEDUCTION',
  'SUBSTITUTION',
  'TIME_ONLY',
]);
export const versionStatus = pgEnum('version_status', [
  'DRAFT',
  'SENT',
  'VIEWED',
  'REVISION_REQUESTED',
  'APPROVED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'SUPERSEDED',
]);
export const decisionType = pgEnum('decision_type', ['APPROVE', 'DECLINE', 'REQUEST_REVISION']);
export const assuranceLevel = pgEnum('assurance_level', ['A0', 'A1', 'A2']);
export const actorType = pgEnum('actor_type', [
  'USER',
  'CUSTOMER',
  'SYSTEM',
  'SUPPORT',
  'PROVIDER',
]);
export const scanStatus = pgEnum('scan_status', [
  'PENDING',
  'SCANNING',
  'CLEAN',
  'REJECTED',
  'FAILED',
]);
export const jobStatus = pgEnum('job_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'DEAD_LETTER',
]);
export const employeeStatus = pgEnum('employee_status', ['ACTIVE', 'SUSPENDED', 'REMOVED']);
export const inboundStatus = pgEnum('inbound_status', [
  'RECEIVED',
  'REJECTED_UNKNOWN_SENDER',
  'REJECTED_NOT_AUTHORIZED',
  'REJECTED_UNPARSEABLE',
  'REJECTED_POLICY',
  'ACCEPTED',
]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// --- Organizations ---------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
  legalName: text('legal_name'),
  gstin: text('gstin'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  defaultCurrency: char('default_currency', { length: 3 }).notNull().default('INR'),
  retentionMonths: integer('retention_months').notNull().default(36),
  status: text('status').notNull().default('ACTIVE'),
  brandPrimaryColor: text('brand_primary_color'),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  reminderPolicyHours: intArray('reminder_policy_hours').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  lockVersion: integer('lock_version').notNull().default(1),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  authProvider: text('auth_provider').notNull().default('local'),
  authProviderSubject: text('auth_provider_subject').notNull(),
  emailNormalized: text('email_normalized').notNull(),
  displayName: text('display_name').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  lastAuthenticatedAt: ts('last_authenticated_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: membershipRole('role').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    invitedByUserId: uuid('invited_by_user_id'),
    invitationTokenHash: bytea('invitation_token_hash'),
    invitationExpiresAt: ts('invitation_expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  activeOrganizationId: uuid('active_organization_id'),
  csrfTokenHash: bytea('csrf_token_hash').notNull(),
  authenticatedAt: ts('authenticated_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  ipHash: bytea('ip_hash'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const authChallenges = pgTable('auth_challenges', {
  id: uuid('id').primaryKey(),
  emailNormalized: text('email_normalized').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  purpose: text('purpose').notNull(),
  organizationId: uuid('organization_id'),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// --- Customers -------------------------------------------------------------

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    displayName: text('display_name').notNull(),
    legalName: text('legal_name'),
    notes: text('notes'),
    searchDocument: tsvector('search_document'),
    mergedIntoCustomerId: uuid('merged_into_customer_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    lockVersion: integer('lock_version').notNull().default(1),
  },
  (t) => [index('customers_org_idx').on(t.organizationId, t.updatedAt)],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    name: text('name').notNull(),
    phoneE164: text('phone_e164'),
    emailNormalized: text('email_normalized'),
    isDefaultApprover: boolean('is_default_approver').notNull().default(false),
    authorityNote: text('authority_note'),
    whatsappOptInStatus: text('whatsapp_opt_in_status').notNull().default('UNKNOWN'),
    whatsappOptInAt: ts('whatsapp_opt_in_at'),
    whatsappOptInSource: text('whatsapp_opt_in_source'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('contacts_customer_idx').on(t.organizationId, t.customerId)],
);

// --- Projects --------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    projectNumber: text('project_number').notNull(),
    title: text('title').notNull(),
    siteAddressJson: jsonb('site_address_json'),
    status: projectStatus('status').notNull().default('ACTIVE'),
    currency: char('currency', { length: 3 }).notNull(),
    timezone: text('timezone').notNull(),
    baselineSubtotalMinor: bigintNumeric('baseline_subtotal_minor').notNull(),
    baselineTaxMinor: bigintNumeric('baseline_tax_minor').notNull(),
    baselineTotalMinor: bigintNumeric('baseline_total_minor').notNull(),
    approvedDeltaMinor: bigintNumeric('approved_delta_minor').notNull(),
    revisedTotalMinor: bigintNumeric('revised_total_minor').notNull(),
    approvedScheduleDeltaDays: integer('approved_schedule_delta_days').notNull().default(0),
    startDate: date('start_date'),
    expectedCompletionDate: date('expected_completion_date'),
    defaultApproverContactId: uuid('default_approver_contact_id'),
    baselineDocumentFileId: uuid('baseline_document_file_id'),
    hasSentChange: boolean('has_sent_change').notNull().default(false),
    searchDocument: tsvector('search_document'),
    retentionUntil: date('retention_until'),
    closedAt: ts('closed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    lockVersion: integer('lock_version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('projects_org_number_key').on(t.organizationId, t.projectNumber),
    index('projects_org_status_idx').on(t.organizationId, t.status, t.updatedAt),
  ],
);

export const baselineVersions = pgTable('baseline_versions', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  subtotalMinor: bigintNumeric('subtotal_minor').notNull(),
  taxMinor: bigintNumeric('tax_minor').notNull(),
  totalMinor: bigintNumeric('total_minor').notNull(),
  reason: text('reason'),
  effectiveDate: date('effective_date'),
  supportingFileId: uuid('supporting_file_id'),
  recordedByUserId: uuid('recorded_by_user_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const projectMembers = pgTable(
  'project_members',
  {
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

// --- Files -----------------------------------------------------------------

export const fileObjects = pgTable('file_objects', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id'),
  storageKey: text('storage_key').notNull(),
  promotedStorageKey: text('promoted_storage_key'),
  originalFilename: text('original_filename').notNull(),
  declaredMimeType: text('declared_mime_type'),
  detectedMimeType: text('detected_mime_type'),
  byteSize: bigintNumeric('byte_size').notNull(),
  sha256: bytea('sha256'),
  scanStatus: scanStatus('scan_status').notNull().default('PENDING'),
  scanDetail: text('scan_detail'),
  scannedAt: ts('scanned_at'),
  storageVersion: text('storage_version'),
  purpose: text('purpose').notNull().default('CHANGE_ATTACHMENT'),
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),
  derivativeStorageKey: text('derivative_storage_key'),
  uploadedByUserId: uuid('uploaded_by_user_id'),
  uploadedAt: ts('uploaded_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// --- Change orders ---------------------------------------------------------

export const changeOrders = pgTable(
  'change_orders',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    number: text('number').notNull(),
    type: changeType('type').notNull(),
    currentVersionId: uuid('current_version_id'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    reversalOfChangeOrderId: uuid('reversal_of_change_order_id'),
    searchDocument: tsvector('search_document'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('change_orders_project_number_key').on(t.projectId, t.number),
    index('changes_project_created_idx').on(t.organizationId, t.projectId, t.createdAt),
  ],
);

export const changeOrderVersions = pgTable(
  'change_order_versions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    changeOrderId: uuid('change_order_id').notNull(),
    projectId: uuid('project_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: versionStatus('status').notNull().default('DRAFT'),
    type: changeType('type').notNull(),
    title: text('title').notNull(),
    scopeDescription: text('scope_description').notNull(),
    reason: text('reason'),
    scheduleDeltaDays: integer('schedule_delta_days').notNull().default(0),
    revisedCompletionDate: date('revised_completion_date'),
    approverContactId: uuid('approver_contact_id').notNull(),
    assuranceRequired: assuranceLevel('assurance_required').notNull().default('A0'),
    currency: char('currency', { length: 3 }).notNull(),
    subtotalDeltaMinor: bigintNumeric('subtotal_delta_minor').notNull(),
    taxDeltaMinor: bigintNumeric('tax_delta_minor').notNull(),
    totalDeltaMinor: bigintNumeric('total_delta_minor').notNull(),
    baselineTotalMinor: bigintNumeric('baseline_total_minor'),
    priorApprovedDeltaMinor: bigintNumeric('prior_approved_delta_minor'),
    revisedContractTotalMinor: bigintNumeric('revised_contract_total_minor'),
    canonicalSnapshot: jsonb('canonical_snapshot'),
    canonicalSha256: bytea('canonical_sha256'),
    canonicalizerVersion: text('canonicalizer_version'),
    termsVersion: text('terms_version'),
    sentAt: ts('sent_at'),
    viewedAt: ts('viewed_at'),
    decidedAt: ts('decided_at'),
    expiresAt: ts('expires_at'),
    supersededByVersionId: uuid('superseded_by_version_id'),
    createdByUserId: uuid('created_by_user_id'),
    // Migration 0005. The template text is frozen alongside the canonical
    // snapshot so a later edit by the owner cannot change what a customer
    // already agreed to.
    templateSnapshot: jsonb('template_snapshot'),
    templateVersion: integer('template_version'),
    origin: text('origin').notNull().default('WEB'),
    raisedByEmployeeId: uuid('raised_by_employee_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    lockVersion: integer('lock_version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('versions_change_version_key').on(t.changeOrderId, t.versionNumber),
    index('versions_project_status_idx').on(t.organizationId, t.projectId, t.status),
    index('versions_origin_idx').on(t.organizationId, t.origin, t.createdAt),
  ],
);

export const lineItems = pgTable(
  'line_items',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    versionId: uuid('version_id').notNull(),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: decimalString('quantity').notNull(),
    unit: text('unit'),
    direction: smallint('direction').notNull(),
    unitPriceMinor: bigintNumeric('unit_price_minor').notNull(),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    subtotalMinor: bigintNumeric('subtotal_minor').notNull(),
    taxMinor: bigintNumeric('tax_minor').notNull(),
    totalMinor: bigintNumeric('total_minor').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('line_items_version_position_key').on(t.versionId, t.position)],
);

export const versionAttachments = pgTable(
  'version_attachments',
  {
    organizationId: uuid('organization_id').notNull(),
    versionId: uuid('version_id').notNull(),
    fileObjectId: uuid('file_object_id').notNull(),
    position: integer('position').notNull(),
    caption: text('caption'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.fileObjectId] })],
);

// --- Approvals -------------------------------------------------------------

export const approvalTokens = pgTable('approval_tokens', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  versionId: uuid('version_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  approverContactId: uuid('approver_contact_id').notNull(),
  assuranceRequired: assuranceLevel('assurance_required').notNull(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  revokedReason: text('revoked_reason'),
  viewCount: integer('view_count').notNull().default(0),
  firstViewedAt: ts('first_viewed_at'),
  lastViewedAt: ts('last_viewed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const publicSessions = pgTable('public_sessions', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  approvalTokenId: uuid('approval_token_id').notNull(),
  versionId: uuid('version_id').notNull(),
  sessionTokenHash: bytea('session_token_hash').notNull(),
  csrfTokenHash: bytea('csrf_token_hash').notNull(),
  assuranceAchieved: assuranceLevel('assurance_achieved').notNull().default('A0'),
  verifiedPhoneE164: text('verified_phone_e164'),
  verifiedAt: ts('verified_at'),
  ipHash: bytea('ip_hash'),
  userAgent: text('user_agent'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  publicSessionId: uuid('public_session_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  destinationE164: text('destination_e164').notNull(),
  codeHash: bytea('code_hash').notNull(),
  salt: text('salt').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  providerMessageId: text('provider_message_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id').notNull(),
  versionId: uuid('version_id').notNull(),
  type: decisionType('type').notNull(),
  signerName: text('signer_name').notNull(),
  signerComment: text('signer_comment'),
  assuranceAchieved: assuranceLevel('assurance_achieved').notNull(),
  verifiedPhoneE164: text('verified_phone_e164'),
  publicSessionId: uuid('public_session_id'),
  ipHash: bytea('ip_hash'),
  userAgent: text('user_agent'),
  declarationText: text('declaration_text').notNull(),
  termsVersion: text('terms_version').notNull(),
  occurredAt: ts('occurred_at').notNull(),
  receiptTokenHash: bytea('receipt_token_hash'),
  receiptDisplayId: text('receipt_display_id').notNull(),
  // Migration 0005. The signature image itself lives in private object storage;
  // only its digest and storage key are in the row. This raises the quality of
  // the evidence, not the legal class of the record (report §3.3).
  signatureSha256: bytea('signature_sha256'),
  signatureStorageKey: text('signature_storage_key'),
  signatureKind: text('signature_kind'),
  signatureWidth: integer('signature_width'),
  signatureHeight: integer('signature_height'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// --- Audit -----------------------------------------------------------------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id'),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    eventType: text('event_type').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    payload: jsonb('payload').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    previousHash: bytea('previous_hash'),
    eventHash: bytea('event_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('audit_aggregate_seq_key').on(t.aggregateType, t.aggregateId, t.sequence)],
);

// --- Infrastructure --------------------------------------------------------

export const documentSequences = pgTable(
  'document_sequences',
  {
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    kind: text('kind').notNull(),
    nextValue: integer('next_value').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.projectId, t.kind] })],
);

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id'),
  topic: text('topic').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').notNull(),
  availableAt: ts('available_at').notNull().defaultNow(),
  attemptCount: integer('attempt_count').notNull().default(0),
  leasedUntil: ts('leased_until'),
  publishedAt: ts('published_at'),
  lastErrorCode: text('last_error_code'),
  lastErrorAt: ts('last_error_at'),
  deadLetteredAt: ts('dead_lettered_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const jobQueue = pgTable('job_queue', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id'),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key'),
  payload: jsonb('payload').notNull(),
  priority: integer('priority').notNull().default(50),
  status: jobStatus('status').notNull().default('PENDING'),
  availableAt: ts('available_at').notNull().defaultNow(),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(6),
  leasedUntil: ts('leased_until'),
  leasedBy: text('leased_by'),
  lastError: text('last_error'),
  lastErrorAt: ts('last_error_at'),
  completedAt: ts('completed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const webhookInbox = pgTable('webhook_inbox', {
  id: uuid('id').primaryKey(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id'),
  providerEventId: text('provider_event_id').notNull(),
  signatureVerified: boolean('signature_verified').notNull().default(false),
  rawPayload: jsonb('raw_payload').notNull(),
  headers: jsonb('headers'),
  providerEventAt: ts('provider_event_at'),
  receivedAt: ts('received_at').notNull().defaultNow(),
  processedAt: ts('processed_at'),
  processError: text('process_error'),
});

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey(),
    scope: text('scope').notNull(),
    subjectId: text('subject_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: bytea('request_hash').notNull(),
    status: text('status').notNull().default('IN_PROGRESS'),
    resourceId: uuid('resource_id'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [uniqueIndex('idempotency_scope_key').on(t.scope, t.subjectId, t.idempotencyKey)],
);

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    bucketKey: text('bucket_key').notNull(),
    windowStart: ts('window_start').notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bucketKey, t.windowStart] })],
);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  versionId: uuid('version_id'),
  contactId: uuid('contact_id'),
  channel: text('channel').notNull(),
  purpose: text('purpose').notNull(),
  status: text('status').notNull().default('PENDING'),
  suppressionReason: text('suppression_reason'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  dedupeKey: text('dedupe_key'),
  errorCode: text('error_code'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const messageEvents = pgTable('message_events', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  messageId: uuid('message_id').notNull(),
  status: text('status').notNull(),
  providerEventAt: ts('provider_event_at'),
  receivedAt: ts('received_at').notNull().defaultNow(),
  payload: jsonb('payload'),
});

export const generatedDocuments = pgTable('generated_documents', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id'),
  versionId: uuid('version_id'),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('PENDING'),
  storageKey: text('storage_key'),
  fileSha256: bytea('file_sha256'),
  byteSize: bigintNumeric('byte_size'),
  templateVersion: text('template_version').notNull(),
  rendererVersion: text('renderer_version'),
  generatorVersion: text('generator_version'),
  storageObjectVersion: text('storage_object_version'),
  manifest: jsonb('manifest'),
  manifestSha256: bytea('manifest_sha256'),
  error: text('error'),
  requestedAt: ts('requested_at').notNull().defaultNow(),
  generatedAt: ts('generated_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  planCode: text('plan_code').notNull(),
  status: text('status').notNull(),
  currentPeriodStart: ts('current_period_start').notNull(),
  currentPeriodEnd: ts('current_period_end').notNull(),
  graceEndsAt: ts('grace_ends_at'),
  provider: text('provider'),
  providerSubscriptionId: text('provider_subscription_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const entitlementCounters = pgTable(
  'entitlement_counters',
  {
    organizationId: uuid('organization_id').notNull(),
    periodStart: ts('period_start').notNull(),
    completedDecisions: integer('completed_decisions').notNull().default(0),
    sends: integer('sends').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.periodStart] })],
);

export const paymentIntents = pgTable('payment_intents', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id'),
  versionId: uuid('version_id'),
  amountMinor: bigintNumeric('amount_minor').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  status: text('status').notNull().default('CREATED'),
  provider: text('provider'),
  providerOrderId: text('provider_order_id'),
  providerPaymentId: text('provider_payment_id'),
  checkoutUrl: text('checkout_url'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const supportAccessGrants = pgTable('support_access_grants', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  grantedToUserId: uuid('granted_to_user_id').notNull(),
  grantedByUserId: uuid('granted_by_user_id').notNull(),
  reason: text('reason').notNull(),
  scope: text('scope').notNull().default('METADATA'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const dataSubjectRequests = pgTable('data_subject_requests', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id'),
  requestType: text('request_type').notNull(),
  status: text('status').notNull().default('RECEIVED'),
  resolutionNote: text('resolution_note'),
  requestedAt: ts('requested_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
  resolvedByUserId: uuid('resolved_by_user_id'),
});

export const legalHolds = pgTable('legal_holds', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id'),
  reason: text('reason').notNull(),
  placedByUserId: uuid('placed_by_user_id'),
  placedAt: ts('placed_at').notNull().defaultNow(),
  releasedAt: ts('released_at'),
  releasedByUserId: uuid('released_by_user_id'),
});

export const repairEvents = pgTable('repair_events', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id'),
  targetTable: text('target_table').notNull(),
  targetId: uuid('target_id'),
  command: text('command').notNull(),
  reason: text('reason').notNull(),
  beforeDigest: bytea('before_digest'),
  afterDigest: bytea('after_digest'),
  beforeValue: jsonb('before_value'),
  afterValue: jsonb('after_value'),
  performedBy: text('performed_by').notNull(),
  approvedBy: text('approved_by'),
  performedAt: ts('performed_at').notNull().defaultNow(),
});

export const reminderSchedules = pgTable('reminder_schedules', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  versionId: uuid('version_id').notNull(),
  policyStep: integer('policy_step').notNull(),
  channel: text('channel').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  dueAt: ts('due_at').notNull(),
  sentAt: ts('sent_at'),
  suppressedReason: text('suppressed_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// --- WhatsApp intake (migration 0005) --------------------------------------

/**
 * Employees have no login. They are addressed solely by the phone number the
 * owner registered, which is why `employees_phone_global_idx` in the migration
 * makes an active number unique across every organization, not just within one.
 */
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    roleNote: text('role_note'),
    status: employeeStatus('status').notNull().default('ACTIVE'),
    allProjects: boolean('all_projects').notNull().default(false),
    /** Per-request ceiling in minor units. Null means no ceiling. */
    maxRequestMinor: bigintNumeric('max_request_minor'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    lockVersion: integer('lock_version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('employees_org_phone_key').on(t.organizationId, t.phoneE164),
    index('employees_org_idx').on(t.organizationId, t.status),
  ],
);

export const employeeProjectAssignments = pgTable(
  'employee_project_assignments',
  {
    organizationId: uuid('organization_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    projectId: uuid('project_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.employeeId, t.projectId] }),
    index('employee_assignments_project_idx').on(t.projectId),
  ],
);

/**
 * Every inbound message, authenticated or not. `organizationId` is nullable on
 * purpose: when the sender is unknown there is no tenant to attribute it to,
 * and inventing one would be a cross-tenant guess.
 */
export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id'),
    employeeId: uuid('employee_id'),
    projectId: uuid('project_id'),
    changeOrderId: uuid('change_order_id'),
    provider: text('provider').notNull().default('whatsapp'),
    providerMessageId: text('provider_message_id').notNull(),
    fromPhoneE164: text('from_phone_e164').notNull(),
    body: text('body'),
    mediaCount: integer('media_count').notNull().default(0),
    status: inboundStatus('status').notNull().default('RECEIVED'),
    parsed: jsonb('parsed'),
    rejectionReason: text('rejection_reason'),
    replyText: text('reply_text'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [
    uniqueIndex('inbound_messages_provider_key').on(t.provider, t.providerMessageId),
    index('inbound_messages_org_idx').on(t.organizationId, t.receivedAt),
    index('inbound_messages_phone_idx').on(t.fromPhoneE164, t.receivedAt),
  ],
);

/**
 * Owner-editable customer-facing copy, one row per organization. The assurance
 * language and disclaimer are deliberately absent: they describe what the
 * record actually is, live in `packages/contracts/src/assurance.ts`, and are
 * not editable by the seller (report §3.3, §12.4).
 */
export const requestTemplates = pgTable('request_templates', {
  organizationId: uuid('organization_id').primaryKey(),
  heading: text('heading').notNull(),
  intro: text('intro').notNull(),
  termsBody: text('terms_body').notNull(),
  paymentNote: text('payment_note'),
  footerNote: text('footer_note'),
  templateVersion: integer('template_version').notNull().default(1),
  updatedByUserId: uuid('updated_by_user_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Migration bookkeeping, created by the runner itself. */
export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  checksum: text('checksum').notNull(),
  appliedAt: ts('applied_at').notNull().defaultNow(),
});
