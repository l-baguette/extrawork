import { hashOpaqueToken, type JobRow } from '@extrawork/db';
import { decryptApprovalUrl, systemTenantContext } from '@extrawork/domain';
import type { WorkerContext } from '../context.js';
import {
  PermanentJobError,
  optionalPayloadString,
  requirePayloadUuid,
  requireTenant,
} from '../runner.js';

/**
 * Emails a collaborator invitation — spec 2026-10-12, D1. Slice A.
 *
 * The invite link exists only as a hash in `project_invitations`, so the API
 * seals the plaintext link into this job with the approval-link helper, bound
 * to the tenant and the invitation (`invitation:<id>`, kept disjoint from
 * request links). The ciphertext is erased when the job completes.
 *
 * Idempotent and self-cancelling: the link is sent only while it is still the
 * invitation's current link and the invitation is still open. A refreshed
 * invitation (new token) queued its own job, so this one goes quiet rather
 * than mailing a link that no longer works.
 */
export async function sendInvitation(job: JobRow, ctx: WorkerContext): Promise<void> {
  const invitationId = requirePayloadUuid(job, 'invitationId');
  const organizationId = requireTenant(job, optionalPayloadString(job, 'organizationId'));
  const sealed = optionalPayloadString(job, 'inviteUrlCiphertext');
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const log = ctx.logger.child({ invitationId, step: 'send-invitation' });

  if (!sealed) {
    throw new PermanentJobError('INVITE_LINK_MISSING', 'Invitation job carries no sealed link');
  }
  let inviteUrl: string;
  try {
    inviteUrl = decryptApprovalUrl(sealed, ctx.env.APPROVAL_LINK_ENCRYPTION_SECRET, {
      organizationId,
      versionId: `invitation:${invitationId}`,
    });
  } catch {
    throw new PermanentJobError('INVITE_LINK_INVALID', 'Invitation job carries an invalid link');
  }

  const invitation = await ctx.repos.collaboration.findForDelivery(ctx.db, tenant, invitationId);
  if (!invitation) {
    log.debug('invitation no longer exists; nothing to send');
    return;
  }
  if (invitation.status !== 'PENDING') {
    log.debug({ status: invitation.status }, 'invitation is no longer open; email skipped');
    return;
  }
  const token = inviteUrl.slice(inviteUrl.lastIndexOf('/') + 1);
  if (!hashOpaqueToken(token).equals(invitation.tokenSha256)) {
    log.debug('invitation was re-sent with a new link; this one is superseded');
    return;
  }

  const gateway = ctx.app.integrations.email;
  if (!gateway.canDeliver) {
    // The designer always has the link in the app to share on WhatsApp, so a
    // gateway that cannot send is not a failure worth retrying.
    log.debug({ channel: gateway.channel }, 'email gateway cannot deliver');
    return;
  }

  const inviter = invitation.invitedByName ?? invitation.organizationName;
  const greeting = invitation.displayName ? `Hello ${invitation.displayName},` : 'Hello,';
  await gateway.send({
    to: { email: invitation.email, name: invitation.displayName ?? invitation.email },
    subject: `${inviter} invited you to ${invitation.projectTitle} on ExtraWork`,
    body: [
      greeting,
      '',
      `${inviter} at ${invitation.organizationName} invited you to collaborate on ` +
        `${invitation.projectTitle}.`,
      ...(invitation.message ? ['', invitation.message] : []),
      '',
      `Open the invitation: ${inviteUrl}`,
      '',
      `Sign in or create a free account with this email address (${invitation.email}) to accept.`,
      `The link works until ${invitation.expiresAt.toUTCString()}.`,
      '',
      `If you were not expecting this, you can ignore it.`,
    ].join('\n'),
    purpose: 'INVITATION',
    // One email per link: a retry after a crash between "sent" and "job
    // completed" collapses at the provider.
    idempotencyKey: `invitation:${invitation.id}:${invitation.expiresAt.getTime()}`,
    organizationName: invitation.organizationName,
  });
  log.info('invitation emailed');
}
