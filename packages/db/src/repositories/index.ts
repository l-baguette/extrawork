import type { Database } from '../client.js';
import {
  InMemoryRateLimiter,
  LocalReadRateLimiter,
  PostgresRateLimiter,
  type RateLimiter,
} from '../rate-limit.js';
import { auditWriter, type AuditWriter } from './audit.js';
import { ApprovalRepository } from './approvals.js';
import { ChangeOrderRepository } from './change-orders.js';
import { CustomerRepository } from './customers.js';
import { DocumentRepository, MessageRepository, WebhookInboxRepository } from './documents.js';
import { EmployeeRepository } from './employees.js';
import { FileRepository } from './files.js';
import { IdentityRepository } from './identity.js';
import { InboundMessageRepository } from './inbound-messages.js';
import { OrganizationRepository } from './organizations.js';
import { ProjectRepository } from './projects.js';
import { ReminderRepository } from './reminders.js';
import { ReportingRepository, SupportRepository } from './reporting.js';
import { RequestTemplateRepository } from './request-templates.js';

/**
 * One assembled repository set, constructed once per process and injected into
 * the application services. Keeping construction here means a test can swap the
 * database handle without any service knowing.
 */
export interface Repositories {
  identity: IdentityRepository;
  organizations: OrganizationRepository;
  customers: CustomerRepository;
  projects: ProjectRepository;
  changeOrders: ChangeOrderRepository;
  approvals: ApprovalRepository;
  files: FileRepository;
  documents: DocumentRepository;
  messages: MessageRepository;
  webhooks: WebhookInboxRepository;
  reminders: ReminderRepository;
  reporting: ReportingRepository;
  support: SupportRepository;
  // WhatsApp intake (migration 0005).
  employees: EmployeeRepository;
  inboundMessages: InboundMessageRepository;
  requestTemplates: RequestTemplateRepository;
  audit: AuditWriter;
  rateLimiter: RateLimiter;
}

export function createRepositories(
  db: Database,
  options: { rateLimitEnabled?: boolean; localAuthenticatedReads?: boolean } = {},
): Repositories {
  const rateLimitEnabled = options.rateLimitEnabled ?? true;
  const distributedRateLimiter = new PostgresRateLimiter(db, rateLimitEnabled);
  return {
    identity: new IdentityRepository(db),
    organizations: new OrganizationRepository(db),
    customers: new CustomerRepository(db),
    projects: new ProjectRepository(db),
    changeOrders: new ChangeOrderRepository(db),
    approvals: new ApprovalRepository(db),
    files: new FileRepository(db),
    documents: new DocumentRepository(db),
    messages: new MessageRepository(db),
    webhooks: new WebhookInboxRepository(db),
    reminders: new ReminderRepository(db),
    reporting: new ReportingRepository(db),
    support: new SupportRepository(db),
    employees: new EmployeeRepository(db),
    inboundMessages: new InboundMessageRepository(db),
    requestTemplates: new RequestTemplateRepository(db),
    audit: auditWriter,
    rateLimiter: options.localAuthenticatedReads
      ? new LocalReadRateLimiter(distributedRateLimiter, new InMemoryRateLimiter(rateLimitEnabled))
      : distributedRateLimiter,
  };
}
