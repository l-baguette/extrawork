import type { CalendarDto, MilestoneListDto, ProjectDto } from '@extrawork/contracts';
import { serverGet } from '@/lib/server-fetch';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { addDays, todayIn } from '@/lib/calendar';
import { ProjectTimeline } from './project-timeline';

/**
 * Project timeline — spec 2026-10-12, D14: the project's milestones (managed
 * by the designers, read by everyone on the project) and every other dated
 * fact on it — start, completion, request links about to lapse, decisions.
 */
export const dynamic = 'force-dynamic';

export default async function ProjectTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await serverGet<ProjectDto>(`/v1/projects/${id}`);
  if (!project.ok && project.status === 401) return <SignInPrompt />;
  if (!project.ok) return <LoadError message={project.message} />;

  const today = todayIn(project.data.timezone);
  // The calendar answers at most 400 days at a time: half a year back,
  // the rest ahead.
  const [milestones, calendar] = await Promise.all([
    serverGet<MilestoneListDto>(`/v1/projects/${id}/milestones`),
    serverGet<CalendarDto>(
      `/v1/calendar?from=${addDays(today, -180)}&to=${addDays(today, 219)}&projectId=${id}`,
    ),
  ]);
  if (!milestones.ok) return <LoadError message={milestones.message} />;

  return (
    <ProjectTimeline
      project={project.data}
      today={today}
      initialMilestones={milestones.data.items}
      canManage={milestones.data.canManage}
      events={calendar.ok ? calendar.data.events : []}
      eventsFailed={!calendar.ok}
    />
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="banner banner-error" role="alert">
      The timeline could not be loaded: {message} Your records are unaffected.
    </div>
  );
}
