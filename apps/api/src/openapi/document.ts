import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ChangeOrderSchema,
  CreateChangeOrderSchema,
  CreateCustomerSchema,
  CreateEmployeeSchema,
  CreateOrganizationSchema,
  CreateProjectSchema,
  CreateUploadSchema,
  CustomerSchema,
  CustomerSummarySchema,
  DashboardSchema,
  DecisionInputSchema,
  DecisionReceiptSchema,
  ERROR_CODES,
  ExtraWorkReportSchema,
  InviteMembershipSchema,
  OrganizationSchema,
  OtpChallengeSchema,
  OtpVerifySchema,
  PresignedUploadSchema,
  PreviewSchema,
  ProjectSchema,
  PublicRequestSchema,
  SearchResultsSchema,
  SendChangeOrderSchema,
  SendResultSchema,
  EmployeeSchema,
  InboundMessageSchema,
  RequestTemplateSchema,
  UpdateDraftSchema,
  UpdateRequestTemplateSchema,
} from '@extrawork/contracts';

/**
 * OpenAPI document generated from the same Zod schemas the routes validate
 * with — report §7.2 and §14.1 ("Zod plus generated OpenAPI ... OpenAPI remains
 * the integration contract"). Generating it means the document cannot drift
 * from the runtime validation, and `api/openapi.test.ts` fails the build if the
 * committed file is stale.
 */

type JsonObject = Record<string, unknown>;

const componentSchemas: Record<string, z.ZodTypeAny> = {
  CreateOrganization: CreateOrganizationSchema,
  Organization: OrganizationSchema,
  InviteMembership: InviteMembershipSchema,
  CreateCustomer: CreateCustomerSchema,
  Customer: CustomerSchema,
  CustomerSummary: CustomerSummarySchema,
  CreateProject: CreateProjectSchema,
  Project: ProjectSchema,
  CreateChangeOrder: CreateChangeOrderSchema,
  UpdateDraft: UpdateDraftSchema,
  ChangeOrder: ChangeOrderSchema,
  Preview: PreviewSchema,
  SendChangeOrder: SendChangeOrderSchema,
  SendResult: SendResultSchema,
  PublicRequest: PublicRequestSchema,
  DecisionInput: DecisionInputSchema,
  DecisionReceipt: DecisionReceiptSchema,
  OtpChallenge: OtpChallengeSchema,
  OtpVerify: OtpVerifySchema,
  CreateUpload: CreateUploadSchema,
  PresignedUpload: PresignedUploadSchema,
  Dashboard: DashboardSchema,
  SearchResults: SearchResultsSchema,
  ExtraWorkReport: ExtraWorkReportSchema,
  CreateEmployee: CreateEmployeeSchema,
  Employee: EmployeeSchema,
  UpdateRequestTemplate: UpdateRequestTemplateSchema,
  RequestTemplate: RequestTemplateSchema,
  InboundMessage: InboundMessageSchema,
};

function schemaRef(name: string): JsonObject {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonBody(name: string, required = true): JsonObject {
  return {
    required,
    content: { 'application/json': { schema: schemaRef(name) } },
  };
}

function jsonResponse(description: string, name?: string): JsonObject {
  return {
    description,
    ...(name ? { content: { 'application/json': { schema: schemaRef(name) } } } : {}),
  };
}

const errorResponse = (description: string): JsonObject => ({
  description,
  content: { 'application/json': { schema: schemaRef('ErrorEnvelope') } },
});

const commonErrors: JsonObject = {
  '400': errorResponse('Validation failed'),
  '401': errorResponse('Not authenticated'),
  '403': errorResponse('Not permitted'),
  '404': errorResponse('Not found'),
  '409': errorResponse('Conflict: state, lock, or idempotency'),
  '429': errorResponse('Rate limited'),
  '500': errorResponse('Internal error'),
};

const idempotencyHeader: JsonObject = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 8 },
  description: 'Report §7.6. Repeating a key with the same payload replays the stored result.',
};

const ifMatchHeader: JsonObject = {
  name: 'If-Match',
  in: 'header',
  required: true,
  schema: { type: 'string' },
  description: 'Optimistic concurrency tag from the resource ETag (report §7.2, §7.8).',
};

const pathParam = (name: string, description: string): JsonObject => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description,
});

export function buildOpenApiDocument(): JsonObject {
  const schemas: JsonObject = {
    ErrorEnvelope: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message', 'requestId'],
          properties: {
            code: { type: 'string', enum: Object.keys(ERROR_CODES) },
            message: { type: 'string' },
            requestId: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  };

  for (const [name, schema] of Object.entries(componentSchemas)) {
    schemas[name] = zodToJsonSchema(schema, {
      target: 'openApi3',
      $refStrategy: 'none',
    }) as JsonObject;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'ExtraWork API',
      version: '1.0.0',
      description:
        'WhatsApp-first contract-change and approval ledger.\n\n' +
        'Three surfaces: `/v1` (authenticated business), `/public/v1` (no-account customer ' +
        'approval), `/webhooks/v1` (provider callbacks). Money is always integer minor units. ' +
        'Quantities are decimal strings. Instants are ISO-8601 UTC.',
      license: { name: 'Proprietary' },
    },
    servers: [{ url: '/', description: 'This deployment' }],
    tags: [
      { name: 'auth', description: 'Sign-in and organization onboarding' },
      { name: 'organizations', description: 'Organization profile, members, entitlements' },
      { name: 'customers', description: 'Customers and contacts' },
      { name: 'projects', description: 'Projects, baselines, dashboards' },
      { name: 'change-orders', description: 'Change composition, preview, send, evidence' },
      { name: 'files', description: 'Private uploads' },
      { name: 'reports', description: 'Reporting and export' },
      { name: 'employees', description: 'WhatsApp intake roster, template and request log' },
      { name: 'public-approval', description: 'No-account customer decision surface' },
      { name: 'webhooks', description: 'Provider callbacks' },
      { name: 'ops', description: 'Health and metrics' },
    ],
    components: {
      schemas,
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'ew_session',
          description:
            'HTTP-only session cookie. Mutations additionally require the X-CSRF-Token header ' +
            'matching the ew_csrf cookie (report §6.5, §12.1).',
        },
        publicSessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'ew_public',
          description:
            'Short-lived public approval session, created when a valid link is first opened.',
        },
      },
    },
    security: [{ sessionCookie: [] }],
    paths: {
      '/healthz': {
        get: {
          tags: ['ops'],
          summary: 'Liveness probe',
          security: [],
          responses: { '200': { description: 'Process is alive' } },
        },
      },
      '/readyz': {
        get: {
          tags: ['ops'],
          summary: 'Readiness probe (checks the database)',
          security: [],
          responses: {
            '200': { description: 'Ready' },
            '503': { description: 'Not ready' },
          },
        },
      },
      '/metrics': {
        get: {
          tags: ['ops'],
          summary: 'Prometheus metrics',
          security: [],
          responses: { '200': { description: 'Metric exposition' } },
        },
      },

      '/v1/auth/sign-in': {
        post: {
          tags: ['auth'],
          summary: 'Request a sign-in link',
          security: [],
          description:
            'Always returns 202 regardless of whether the address exists, to avoid account enumeration.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: { email: { type: 'string', format: 'email' } },
                },
              },
            },
          },
          responses: {
            '202': { description: 'Link dispatched if the address is known' },
            ...commonErrors,
          },
        },
      },
      '/v1/auth/verify': {
        post: {
          tags: ['auth'],
          summary: 'Exchange a sign-in credential for a session',
          security: [],
          responses: { '200': { description: 'Session cookies set' }, ...commonErrors },
        },
      },
      '/v1/auth/me': {
        get: {
          tags: ['auth'],
          summary: 'Current user and memberships',
          responses: { '200': { description: 'Current user' }, ...commonErrors },
        },
      },
      '/v1/auth/sign-out': {
        post: {
          tags: ['auth'],
          summary: 'Revoke the current session',
          responses: { '204': { description: 'Signed out' }, ...commonErrors },
        },
      },

      '/v1/organizations': {
        post: {
          tags: ['organizations'],
          summary: 'Create an organization and become its owner',
          requestBody: jsonBody('CreateOrganization'),
          responses: { '201': { description: 'Created' }, ...commonErrors },
        },
      },
      '/v1/organizations/current': {
        get: {
          tags: ['organizations'],
          summary: 'Current organization with subscription and entitlements',
          responses: { '200': jsonResponse('Organization', 'Organization'), ...commonErrors },
        },
        patch: {
          tags: ['organizations'],
          summary: 'Update organization policy',
          responses: { '200': { description: 'Updated' }, ...commonErrors },
        },
      },
      '/v1/memberships': {
        get: {
          tags: ['organizations'],
          summary: 'List members',
          responses: { '200': { description: 'Members' }, ...commonErrors },
        },
      },
      '/v1/memberships/invitations': {
        post: {
          tags: ['organizations'],
          summary: 'Invite a member',
          requestBody: jsonBody('InviteMembership'),
          responses: { '201': { description: 'Invited' }, ...commonErrors },
        },
      },
      '/v1/memberships/{userId}': {
        patch: {
          tags: ['organizations'],
          summary: 'Change a member role',
          parameters: [pathParam('userId', 'Member user id')],
          responses: { '204': { description: 'Updated' }, ...commonErrors },
        },
        delete: {
          tags: ['organizations'],
          summary: 'Revoke a member and their sessions',
          parameters: [pathParam('userId', 'Member user id')],
          responses: { '204': { description: 'Revoked' }, ...commonErrors },
        },
      },

      '/v1/customers': {
        get: {
          tags: ['customers'],
          summary: 'List and search customers',
          responses: { '200': { description: 'Customer page' }, ...commonErrors },
        },
        post: {
          tags: ['customers'],
          summary: 'Create a customer with contacts',
          requestBody: jsonBody('CreateCustomer'),
          responses: { '201': { description: 'Created' }, ...commonErrors },
        },
      },
      '/v1/customers/{id}': {
        get: {
          tags: ['customers'],
          summary: 'Customer with contacts, projects and duplicate suggestions',
          parameters: [pathParam('id', 'Customer id')],
          responses: { '200': jsonResponse('Customer', 'Customer'), ...commonErrors },
        },
        patch: {
          tags: ['customers'],
          summary: 'Update a customer',
          parameters: [pathParam('id', 'Customer id')],
          responses: { '200': { description: 'Updated' }, ...commonErrors },
        },
      },
      '/v1/customers/{id}/contacts': {
        post: {
          tags: ['customers'],
          summary: 'Add a contact',
          parameters: [pathParam('id', 'Customer id')],
          responses: { '201': { description: 'Created' }, ...commonErrors },
        },
      },
      '/v1/customers/{id}/merge': {
        post: {
          tags: ['customers'],
          summary: 'Merge a duplicate customer into this one',
          parameters: [pathParam('id', 'Surviving customer id')],
          responses: { '200': { description: 'Merged' }, ...commonErrors },
        },
      },
      '/v1/contacts/{id}': {
        patch: {
          tags: ['customers'],
          summary: 'Update a contact',
          parameters: [pathParam('id', 'Contact id')],
          responses: { '200': { description: 'Updated' }, ...commonErrors },
        },
      },

      '/v1/employees': {
        get: {
          tags: ['employees'],
          summary: 'List employees who may raise a request by WhatsApp',
          responses: { '200': { description: 'Employee roster' }, ...commonErrors },
        },
        post: {
          tags: ['employees'],
          summary: 'Register an employee by phone number',
          requestBody: jsonBody('CreateEmployee'),
          responses: {
            '201': { description: 'Created' },
            '409': errorResponse('EMPLOYEE_PHONE_TAKEN if the number is already registered'),
            ...commonErrors,
          },
        },
      },
      '/v1/employees/{id}': {
        get: {
          tags: ['employees'],
          summary: 'One employee with project assignments',
          parameters: [pathParam('id', 'Employee id')],
          responses: { '200': { description: 'Employee' }, ...commonErrors },
        },
        patch: {
          tags: ['employees'],
          summary: 'Update an employee, their assignments or approval ceiling',
          parameters: [pathParam('id', 'Employee id')],
          responses: {
            '200': { description: 'Updated' },
            '409': errorResponse('EMPLOYEE_PHONE_TAKEN if the new number is already registered'),
            ...commonErrors,
          },
        },
        delete: {
          tags: ['employees'],
          summary: 'Remove an employee and free their phone number',
          parameters: [pathParam('id', 'Employee id')],
          responses: { '204': { description: 'Removed' }, ...commonErrors },
        },
      },
      '/v1/settings/request-template': {
        get: {
          tags: ['employees'],
          summary: 'The customer-facing copy shown on the approval page',
          responses: { '200': { description: 'Template' }, ...commonErrors },
        },
        patch: {
          tags: ['employees'],
          summary: 'Edit the customer-facing copy (assurance language is not editable)',
          requestBody: jsonBody('UpdateRequestTemplate'),
          responses: { '200': { description: 'Updated' }, ...commonErrors },
        },
      },
      '/v1/requests': {
        get: {
          tags: ['employees'],
          summary: 'Every inbound message received, including rejected ones',
          responses: { '200': { description: 'Request log page' }, ...commonErrors },
        },
      },
      '/v1/requests/{id}': {
        get: {
          tags: ['employees'],
          summary: 'One inbound message with the reply that was sent',
          parameters: [pathParam('id', 'Inbound message id')],
          responses: { '200': { description: 'Inbound message' }, ...commonErrors },
        },
      },

      '/v1/projects': {
        get: {
          tags: ['projects'],
          summary: 'List projects',
          responses: { '200': { description: 'Project page' }, ...commonErrors },
        },
        post: {
          tags: ['projects'],
          summary: 'Create a project and record its baseline',
          requestBody: jsonBody('CreateProject'),
          responses: { '201': { description: 'Created' }, ...commonErrors },
        },
      },
      '/v1/projects/{id}': {
        get: {
          tags: ['projects'],
          summary: 'Project workspace with revised totals',
          parameters: [pathParam('id', 'Project id')],
          responses: { '200': jsonResponse('Project', 'Project'), ...commonErrors },
        },
        patch: {
          tags: ['projects'],
          summary: 'Update project details',
          parameters: [pathParam('id', 'Project id')],
          responses: { '200': { description: 'Updated' }, ...commonErrors },
        },
      },
      '/v1/projects/{id}/baseline': {
        patch: {
          tags: ['projects'],
          summary: 'Correct the baseline before the first request is sent',
          parameters: [pathParam('id', 'Project id')],
          responses: {
            '200': { description: 'Updated' },
            '409': errorResponse('BASELINE_LOCKED once a request has been sent'),
            ...commonErrors,
          },
        },
      },
      '/v1/projects/{id}/baseline-amendments': {
        post: {
          tags: ['projects'],
          summary: 'Record an explicit, audited baseline amendment',
          parameters: [pathParam('id', 'Project id')],
          responses: { '201': { description: 'Amended' }, ...commonErrors },
        },
      },
      '/v1/projects/{id}/close': {
        post: {
          tags: ['projects'],
          summary: 'Close a project and start its retention clock',
          parameters: [pathParam('id', 'Project id')],
          responses: { '204': { description: 'Closed' }, ...commonErrors },
        },
      },
      '/v1/projects/{id}/change-register': {
        get: {
          tags: ['projects'],
          summary: 'Change register with revised totals',
          parameters: [pathParam('id', 'Project id')],
          responses: { '200': { description: 'Register' }, ...commonErrors },
        },
      },
      '/v1/projects/{id}/evidence-pack': {
        post: {
          tags: ['reports'],
          summary: 'Request a project evidence pack',
          parameters: [pathParam('id', 'Project id')],
          responses: { '202': { description: 'Queued' }, ...commonErrors },
        },
      },
      '/v1/projects/{id}/accounting-export': {
        get: {
          tags: ['reports'],
          summary: 'Approved changes in the accounting hand-off model',
          parameters: [pathParam('id', 'Project id')],
          responses: { '200': { description: 'Export model' }, ...commonErrors },
        },
      },
      '/v1/dashboard': {
        get: {
          tags: ['projects'],
          summary: 'Operational dashboard cards',
          responses: { '200': jsonResponse('Dashboard', 'Dashboard'), ...commonErrors },
        },
      },
      '/v1/search': {
        get: {
          tags: ['projects'],
          summary: 'Tenant-scoped search',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
          ],
          responses: { '200': jsonResponse('Results', 'SearchResults'), ...commonErrors },
        },
      },

      '/v1/change-orders': {
        get: {
          tags: ['change-orders'],
          summary: 'List change requests',
          responses: { '200': { description: 'Change page' }, ...commonErrors },
        },
      },
      '/v1/projects/{projectId}/change-orders': {
        post: {
          tags: ['change-orders'],
          summary: 'Create a change request draft',
          parameters: [pathParam('projectId', 'Project id')],
          requestBody: jsonBody('CreateChangeOrder'),
          responses: { '201': { description: 'Draft created' }, ...commonErrors },
        },
      },
      '/v1/change-orders/{id}': {
        get: {
          tags: ['change-orders'],
          summary: 'Change request with current version, history and decision',
          parameters: [pathParam('id', 'Change order id')],
          responses: { '200': jsonResponse('Change order', 'ChangeOrder'), ...commonErrors },
        },
      },
      '/v1/change-orders/{id}/draft': {
        patch: {
          tags: ['change-orders'],
          summary: 'Autosave the draft under an optimistic lock',
          parameters: [pathParam('id', 'Change order id'), ifMatchHeader],
          requestBody: jsonBody('UpdateDraft'),
          responses: {
            '200': { description: 'Saved' },
            '412': errorResponse('ETag mismatch'),
            ...commonErrors,
          },
        },
      },
      '/v1/change-orders/{id}/preview': {
        post: {
          tags: ['change-orders'],
          summary: 'Server-calculated customer preview and send blockers',
          parameters: [pathParam('id', 'Change order id')],
          responses: { '200': jsonResponse('Preview', 'Preview'), ...commonErrors },
        },
      },
      '/v1/change-orders/{id}/send': {
        post: {
          tags: ['change-orders'],
          summary: 'Freeze the version and issue the approval link',
          description:
            'Returns the approval URL exactly once. Only the SHA-256 of the token is stored.',
          parameters: [pathParam('id', 'Change order id')],
          requestBody: jsonBody('SendChangeOrder', false),
          responses: { '201': jsonResponse('Sent', 'SendResult'), ...commonErrors },
        },
      },
      '/v1/change-orders/{id}/share-intent': {
        post: {
          tags: ['change-orders'],
          summary: 'Record that the native share sheet was opened',
          parameters: [pathParam('id', 'Change order id')],
          responses: { '204': { description: 'Recorded' }, ...commonErrors },
        },
      },
      '/v1/change-orders/{id}/revisions': {
        post: {
          tags: ['change-orders'],
          summary: 'Create the next version and supersede the current one',
          parameters: [pathParam('id', 'Change order id')],
          responses: { '201': { description: 'Revision created' }, ...commonErrors },
        },
      },
      '/v1/change-orders/{id}/cancel': {
        post: {
          tags: ['change-orders'],
          summary: 'Cancel an undecided change request',
          parameters: [pathParam('id', 'Change order id')],
          responses: { '204': { description: 'Cancelled' }, ...commonErrors },
        },
      },
      '/v1/change-orders/{id}/reminders': {
        post: {
          tags: ['change-orders'],
          summary: 'Prepare a reminder message',
          parameters: [pathParam('id', 'Change order id')],
          responses: { '200': { description: 'Reminder prepared' }, ...commonErrors },
        },
      },
      '/v1/change-orders/{id}/attachments': {
        post: {
          tags: ['change-orders'],
          summary: 'Attach a scanned file to the draft',
          parameters: [pathParam('id', 'Change order id')],
          responses: { '201': { description: 'Attached' }, ...commonErrors },
        },
      },
      '/v1/change-orders/{id}/attachments/{attachmentId}': {
        delete: {
          tags: ['change-orders'],
          summary: 'Remove an attachment from a draft',
          parameters: [pathParam('id', 'Change order id'), pathParam('attachmentId', 'File id')],
          responses: {
            '204': { description: 'Removed' },
            '409': errorResponse('ATTACHMENT_IMMUTABLE after send'),
            ...commonErrors,
          },
        },
      },
      '/v1/change-orders/{id}/events': {
        get: {
          tags: ['change-orders'],
          summary: 'Audit history with a live hash-chain verification',
          parameters: [pathParam('id', 'Change order id')],
          responses: { '200': { description: 'Events' }, ...commonErrors },
        },
      },
      '/v1/change-orders/{id}/evidence': {
        get: {
          tags: ['change-orders'],
          summary: 'Evidence pack status and signed download link',
          parameters: [pathParam('id', 'Change order id')],
          responses: { '200': { description: 'Evidence status' }, ...commonErrors },
        },
      },

      '/v1/uploads': {
        post: {
          tags: ['files'],
          summary: 'Create a short-lived signed upload into quarantine',
          requestBody: jsonBody('CreateUpload'),
          responses: { '201': jsonResponse('Upload target', 'PresignedUpload'), ...commonErrors },
        },
      },
      '/v1/uploads/complete': {
        post: {
          tags: ['files'],
          summary: 'Signal upload completion and queue the scan',
          responses: { '200': { description: 'Queued for scanning' }, ...commonErrors },
        },
      },
      '/v1/files/{id}': {
        get: {
          tags: ['files'],
          summary: 'File metadata and, once clean, a signed link',
          parameters: [pathParam('id', 'File id')],
          responses: { '200': { description: 'File' }, ...commonErrors },
        },
      },

      '/v1/reports/extra-work': {
        get: {
          tags: ['reports'],
          summary: 'Documented extra-work summary',
          responses: { '200': jsonResponse('Report', 'ExtraWorkReport'), ...commonErrors },
        },
      },
      '/v1/reports/extra-work.csv': {
        get: {
          tags: ['reports'],
          summary: 'Extra-work summary as CSV',
          responses: { '200': { description: 'CSV' }, ...commonErrors },
        },
      },
      '/v1/exports/{id}': {
        get: {
          tags: ['reports'],
          summary: 'Export job status and signed download',
          parameters: [pathParam('id', 'Export id')],
          responses: { '200': { description: 'Export' }, ...commonErrors },
        },
      },

      '/public/v1/requests/{token}': {
        get: {
          tags: ['public-approval'],
          summary: 'Resolve an approval link',
          security: [],
          description:
            'Returns the minimal projection the customer needs to decide. Sets a short-lived ' +
            'public session cookie. Responses are no-store and noindex.',
          parameters: [
            {
              name: 'token',
              in: 'path',
              required: true,
              schema: { type: 'string', minLength: 43, maxLength: 43 },
              description: 'Opaque 32-byte URL-safe base64 token. Never logged.',
            },
          ],
          responses: {
            '200': jsonResponse('Approval request', 'PublicRequest'),
            '404': errorResponse('TOKEN_INVALID'),
            '409': errorResponse('VERSION_SUPERSEDED'),
            '410': errorResponse('REQUEST_EXPIRED or TOKEN_REVOKED'),
            '429': errorResponse('Rate limited'),
          },
        },
      },
      '/public/v1/requests/{token}/otp': {
        post: {
          tags: ['public-approval'],
          summary: 'Send a verification code for A1 assurance',
          security: [{ publicSessionCookie: [] }],
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '201': jsonResponse('Challenge issued', 'OtpChallenge'),
            '503': errorResponse('ASSURANCE_UNAVAILABLE — never silently downgraded'),
            ...commonErrors,
          },
        },
      },
      '/public/v1/requests/{token}/otp/verify': {
        post: {
          tags: ['public-approval'],
          summary: 'Verify the code and raise the session assurance level',
          security: [{ publicSessionCookie: [] }],
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody('OtpVerify'),
          responses: { '200': { description: 'Verification result' }, ...commonErrors },
        },
      },
      '/public/v1/requests/{token}/decisions': {
        post: {
          tags: ['public-approval'],
          summary: 'Record an approve, decline or revision request',
          security: [{ publicSessionCookie: [] }],
          description:
            'Atomic and idempotent. The first committed terminal decision wins; a second ' +
            'receives 409 ALREADY_DECIDED with the recorded state.',
          parameters: [
            { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
            idempotencyHeader,
            { ...ifMatchHeader, required: false },
          ],
          requestBody: jsonBody('DecisionInput'),
          responses: {
            '201': jsonResponse('Decision recorded', 'DecisionReceipt'),
            '409': errorResponse('ALREADY_DECIDED or VERSION_SUPERSEDED'),
            '410': errorResponse('REQUEST_EXPIRED'),
            '412': errorResponse('ETAG_MISMATCH'),
            ...commonErrors,
          },
        },
      },
      '/public/v1/receipts/{token}': {
        get: {
          tags: ['public-approval'],
          summary: 'Decision receipt and evidence link',
          security: [],
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Receipt' }, '404': errorResponse('Not found') },
        },
      },

      '/webhooks/v1/meta/whatsapp': {
        get: {
          tags: ['webhooks'],
          summary: 'Meta webhook challenge verification',
          security: [],
          responses: { '200': { description: 'Challenge echoed' } },
        },
        post: {
          tags: ['webhooks'],
          summary: 'WhatsApp delivery and status events',
          security: [],
          description: 'Signature is verified over the raw body before any parsing.',
          responses: {
            '200': { description: 'Accepted (duplicates also return 200)' },
            '401': errorResponse('WEBHOOK_SIGNATURE_INVALID'),
          },
        },
      },
      '/webhooks/v1/razorpay': {
        post: {
          tags: ['webhooks'],
          summary: 'Payment status events',
          security: [],
          responses: {
            '200': { description: 'Accepted' },
            '401': errorResponse('WEBHOOK_SIGNATURE_INVALID'),
          },
        },
      },
      '/webhooks/v1/auth': {
        post: {
          tags: ['webhooks'],
          summary: 'Managed-auth provider events',
          security: [],
          responses: { '200': { description: 'Accepted' } },
        },
      },
      '/webhooks/v1/esign/{provider}': {
        post: {
          tags: ['webhooks'],
          summary: 'E-signature provider events (deferred; returns 501)',
          security: [],
          parameters: [
            { name: 'provider', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '501': errorResponse('NOT_IMPLEMENTED') },
        },
      },
    },
  };
}
