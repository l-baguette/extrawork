/**
 * Event catalogue — report Appendix A. Events are versioned contracts: add
 * fields compatibly, and introduce a new `.v2` topic for breaking changes.
 *
 * `DOMAIN_EVENTS` names the audit-event types written to `audit_events`.
 * `OUTBOX_TOPICS` names the topics a worker subscribes to. They overlap by
 * design: an audit event describes what happened, an outbox event asks for a
 * side effect that must not run inside the domain transaction (report §7.6).
 */

export const DOMAIN_EVENTS = {
  ORGANIZATION_CREATED: 'organization.created.v1',
  MEMBERSHIP_INVITED: 'membership.invited.v1',
  MEMBERSHIP_ROLE_CHANGED: 'membership.role_changed.v1',
  MEMBERSHIP_REVOKED: 'membership.revoked.v1',
  CUSTOMER_CREATED: 'customer.created.v1',
  CUSTOMER_UPDATED: 'customer.updated.v1',
  CUSTOMER_MERGED: 'customer.merged.v1',
  CONTACT_CREATED: 'contact.created.v1',
  CONTACT_UPDATED: 'contact.updated.v1',
  PROJECT_CREATED: 'project.created.v1',
  PROJECT_BASELINE_RECORDED: 'project.baseline_recorded.v1',
  PROJECT_BASELINE_AMENDED: 'project.baseline_amended.v1',
  PROJECT_CLOSED: 'project.closed.v1',
  PROJECT_EXPORT_GENERATED: 'project.export_generated.v1',
  CHANGE_ORDER_CREATED: 'change_order.created.v1',
  CHANGE_ORDER_DRAFT_UPDATED: 'change_order.draft_updated.v1',
  CHANGE_ORDER_VERSION_FROZEN: 'change_order.version_frozen.v1',
  CHANGE_ORDER_SENT: 'change_order.sent.v1',
  CHANGE_ORDER_SHARE_INTENT_OPENED: 'change_order.share_intent_opened.v1',
  APPROVAL_REQUEST_VIEWED: 'approval.request_viewed.v1',
  APPROVAL_OTP_SENT: 'approval.otp_sent.v1',
  APPROVAL_PHONE_VERIFIED: 'approval.phone_verified.v1',
  APPROVAL_DECIDED: 'approval.decided.v1',
  CHANGE_ORDER_REVISION_REQUESTED: 'change_order.revision_requested.v1',
  CHANGE_ORDER_SUPERSEDED: 'change_order.superseded.v1',
  CHANGE_ORDER_EXPIRED: 'change_order.expired.v1',
  CHANGE_ORDER_CANCELLED: 'change_order.cancelled.v1',
  DOCUMENT_EVIDENCE_GENERATED: 'document.evidence_generated.v1',
  MESSAGE_SEND_REQUESTED: 'message.send_requested.v1',
  MESSAGE_STATUS_CHANGED: 'message.status_changed.v1',
  PAYMENT_REQUESTED: 'payment.requested.v1',
  PAYMENT_STATUS_CHANGED: 'payment.status_changed.v1',
  DATA_RETENTION_DUE: 'data.retention_due.v1',
  DATA_DELETED: 'data.deleted.v1',
  SUPPORT_ACCESS_GRANTED: 'support.access_granted.v1',
  SUPPORT_ACCESS_REVOKED: 'support.access_revoked.v1',
  INTEGRITY_MISMATCH_DETECTED: 'integrity.mismatch_detected.v1',
  INTEGRITY_PROJECTION_REBUILT: 'integrity.projection_rebuilt.v1',
  EMPLOYEE_CREATED: 'employee.created.v1',
  EMPLOYEE_UPDATED: 'employee.updated.v1',
  EMPLOYEE_REMOVED: 'employee.removed.v1',
  REQUEST_TEMPLATE_UPDATED: 'request_template.updated.v1',
  FILE_UPLOAD_REGISTERED: 'file.upload_registered.v1',
  FILE_SCAN_COMPLETED: 'file.scan_completed.v1',
  SUBSCRIPTION_CHANGED: 'subscription.changed.v1',
  REPAIR_APPLIED: 'repair.applied.v1',
} as const;

export type DomainEventType = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

export const OUTBOX_TOPICS = {
  APPROVAL_DECIDED: 'approval.decided.v1',
  CHANGE_ORDER_SENT: 'change_order.sent.v1',
  MESSAGE_SEND_REQUESTED: 'message.send_requested.v1',
  DOCUMENT_EVIDENCE_REQUESTED: 'document.evidence_requested.v1',
  FILE_SCAN_REQUESTED: 'file.scan_requested.v1',
  REMINDER_SCHEDULED: 'reminder.scheduled.v1',
  PAYMENT_REQUESTED: 'payment.requested.v1',
  WEBHOOK_RECEIVED: 'webhook.received.v1',
  PROJECT_EXPORT_REQUESTED: 'project.export_requested.v1',
} as const;

export type OutboxTopic = (typeof OUTBOX_TOPICS)[keyof typeof OUTBOX_TOPICS];

/**
 * Job kinds executed by the worker, ordered by the priority list in report
 * §13.4 (lower number = handled first under backpressure).
 */
export const JOB_KINDS = {
  GENERATE_EVIDENCE: 'generate_evidence',
  SEND_DECISION_RECEIPT: 'send_decision_receipt',
  /**
   * Tells the contractor's own people a customer decided. Separate from the
   * customer receipt: different recipients, and a failure to reach the team
   * must never retry the customer's copy.
   */
  NOTIFY_TEAM_DECISION: 'notify_team_decision',
  SEND_REQUEST_MESSAGE: 'send_request_message',
  SEND_OTP: 'send_otp',
  SEND_REMINDER: 'send_reminder',
  SCAN_FILE: 'scan_file',
  GENERATE_EXPORT: 'generate_export',
  EXPIRE_REQUESTS: 'expire_requests',
  CHECK_PROJECT_INTEGRITY: 'check_project_integrity',
  APPLY_RETENTION: 'apply_retention',
  RECONCILE_MESSAGES: 'reconcile_messages',
  NORMALIZE_WEBHOOK: 'normalize_webhook',
} as const;

export type JobKind = (typeof JOB_KINDS)[keyof typeof JOB_KINDS];

export const JOB_PRIORITY: Record<JobKind, number> = {
  [JOB_KINDS.GENERATE_EVIDENCE]: 10,
  [JOB_KINDS.SEND_DECISION_RECEIPT]: 10,
  // Just behind the customer's own receipt: the team wants to know quickly,
  // but never at the cost of the customer's confirmation.
  [JOB_KINDS.NOTIFY_TEAM_DECISION]: 15,
  [JOB_KINDS.SEND_REQUEST_MESSAGE]: 20,
  [JOB_KINDS.SEND_OTP]: 30,
  [JOB_KINDS.SEND_REMINDER]: 40,
  [JOB_KINDS.NORMALIZE_WEBHOOK]: 45,
  [JOB_KINDS.SCAN_FILE]: 50,
  [JOB_KINDS.EXPIRE_REQUESTS]: 55,
  [JOB_KINDS.GENERATE_EXPORT]: 60,
  [JOB_KINDS.CHECK_PROJECT_INTEGRITY]: 70,
  [JOB_KINDS.APPLY_RETENTION]: 80,
  [JOB_KINDS.RECONCILE_MESSAGES]: 90,
};

/** Report §7.6 retry schedule for non-urgent jobs, then dead-letter. */
export const RETRY_BACKOFF_SECONDS = [30, 120, 600, 3_600, 21_600] as const;
export const MAX_JOB_ATTEMPTS = RETRY_BACKOFF_SECONDS.length + 1;

export function nextRetryDelaySeconds(attemptCount: number): number | null {
  const entry = RETRY_BACKOFF_SECONDS[attemptCount - 1];
  return entry ?? null;
}
