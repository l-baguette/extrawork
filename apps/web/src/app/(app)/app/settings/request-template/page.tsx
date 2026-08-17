import type { RequestTemplateDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { ErrorPanel } from '@/components/error-panel';
import { TemplateEditor } from './template-editor';

/**
 * The copy your customers read on the approval page.
 *
 * What is editable here is the *presentation* — heading, introduction, terms,
 * payment note. What is not, and never will be, is the assurance language and
 * the disclaimer: those describe what the record actually is, and a seller
 * rewording them would let the product overstate its own evidence (report §3.3,
 * §12.4). They are rendered read-only below so the owner can see exactly what
 * their customer is told.
 */
export const dynamic = 'force-dynamic';

export default async function RequestTemplatePage() {
  const result = await serverGet<RequestTemplateDto>('/v1/settings/request-template');

  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) return <ErrorPanel message={result.message} />;

  return (
    <main className="page">
      <h1 style={{ marginBottom: 'var(--space-2)' }}>Approval page wording</h1>
      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        What your customer reads when they open an approval link. Editing this does not change any
        request already sent — each one keeps the wording it was sent with.
      </p>

      <TemplateEditor initial={result.data} />
    </main>
  );
}
