import type { ProjectWorkspaceDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { FilesWorkspace } from './files-workspace';

/**
 * Project files — spec 2026-10-12, D10–D12. The project as a shared folder:
 * drawings, quotes, photos, links and notes, each folder shared with exactly
 * the people its visibility says. Reading the workspace creates the default
 * folders the first time anyone opens it.
 */
export const dynamic = 'force-dynamic';

export default async function ProjectFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await serverGet<ProjectWorkspaceDto>(`/v1/projects/${id}/workspace`);
  if (!result.ok && result.status === 401) return <SignInPrompt />;
  if (!result.ok) {
    // Inside the project layout's <main>, so a banner rather than ErrorPanel.
    return (
      <div className="banner banner-error" role="alert">
        The files could not be loaded: {result.message} Your records are unaffected.
      </div>
    );
  }
  return <FilesWorkspace projectId={id} initial={result.data} />;
}
