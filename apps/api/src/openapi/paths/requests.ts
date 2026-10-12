import {
  ContractHistorySchema,
  DismissProposalSchema,
  InvoicingSchema,
  MarkInvoicedSchema,
  ParseIntakeRequestSchema,
  ParseIntakeResponseSchema,
  ProposalInputSchema,
  ProposalResultSchema,
  ReopenProjectSchema,
} from '@extrawork/contracts';
import type { OpenApiModule } from '../module.js';

/**
 * Requests that route through the designer (spec 2026-10-12, D4, D8, D9, D15):
 * proposals and their review, the Tier 1 B invoiced mark, Tier 1 C
 * paste-to-draft, and the project's contract history and reopen.
 */
export const requestsOpenApi: OpenApiModule = {
  schemas: {
    ProposalInput: ProposalInputSchema,
    ProposalResult: ProposalResultSchema,
    DismissProposal: DismissProposalSchema,
    MarkInvoiced: MarkInvoicedSchema,
    Invoicing: InvoicingSchema,
    ParseIntakeRequest: ParseIntakeRequestSchema,
    ParseIntakeResponse: ParseIntakeResponseSchema,
    ContractHistory: ContractHistorySchema,
    ReopenProject: ReopenProjectSchema,
  },
  paths: (h) => ({
    '/v1/projects/{projectId}/proposals': {
      post: {
        tags: ['change-orders'],
        summary: 'Raise a request for the designer to review',
        description:
          'Creates a DRAFT with review provenance. It may be incomplete (no price yet); the designer completes it and sends it, or dismisses it. Origin is PASTED when `pasted` is set, COLLABORATOR for a collaborator, otherwise WEB. `raisedByEmployeeId` is accepted from designer roles only and must be on the project.',
        parameters: [h.pathParam('projectId', 'Project id')],
        requestBody: h.jsonBody('ProposalInput'),
        responses: {
          '201': h.jsonResponse('Proposal created', 'ProposalResult'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/change-orders/{id}/dismiss': {
      post: {
        tags: ['change-orders'],
        summary: 'Dismiss a proposal without sending it',
        description:
          'Designer roles only, and only while the request awaits review (409 NOT_AWAITING_REVIEW otherwise). Cancels the draft and tells whoever raised it why.',
        parameters: [h.pathParam('id', 'Change order id')],
        requestBody: h.jsonBody('DismissProposal'),
        responses: { '204': { description: 'Dismissed' }, ...h.commonErrors },
      },
    },
    '/v1/change-orders/{id}/invoicing': {
      post: {
        tags: ['change-orders'],
        summary: 'Mark an approved change as invoiced',
        description:
          'Owner, admin or accounts. Bookkeeping only: outside the frozen snapshot. Rejected unless the current version is APPROVED.',
        parameters: [h.pathParam('id', 'Change order id')],
        requestBody: h.jsonBody('MarkInvoiced', false),
        responses: { '200': h.jsonResponse('Invoiced', 'Invoicing'), ...h.commonErrors },
      },
      delete: {
        tags: ['change-orders'],
        summary: 'Clear the invoiced mark',
        parameters: [h.pathParam('id', 'Change order id')],
        responses: { '204': { description: 'Cleared' }, ...h.commonErrors },
      },
    },
    '/v1/intake/parse': {
      post: {
        tags: ['change-orders'],
        summary: 'Read a pasted WhatsApp message (creates nothing)',
        description:
          'Paste-to-draft. Returns what was read, what is missing and the matched project, chosen only among projects the caller can see.',
        requestBody: h.jsonBody('ParseIntakeRequest'),
        responses: {
          '200': h.jsonResponse('What the message says', 'ParseIntakeResponse'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/projects/{id}/contract-history': {
      get: {
        tags: ['projects'],
        summary: 'Contract value over time with a running total',
        parameters: [h.pathParam('id', 'Project id')],
        responses: {
          '200': h.jsonResponse('Contract history', 'ContractHistory'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/projects/{id}/reopen': {
      post: {
        tags: ['projects'],
        summary: 'Reopen a closed project',
        parameters: [h.pathParam('id', 'Project id')],
        requestBody: h.jsonBody('ReopenProject', false),
        responses: { '204': { description: 'Reopened' }, ...h.commonErrors },
      },
    },
  }),
};
