'use client';

import { useId } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectSummaryDto } from '@extrawork/contracts';

/**
 * The timeline's project filter. A select that navigates, because the page
 * itself is server-rendered from its search params.
 */
export function ProjectFilter({
  projects,
  value,
  hrefFor,
}: {
  projects: ProjectSummaryDto[];
  value: string | null;
  /** Destination for each choice, keyed by project id ('' for all). */
  hrefFor: Record<string, string>;
}) {
  const router = useRouter();
  const id = useId();
  if (projects.length < 2) return null;
  return (
    <div className="cal-filter">
      <label htmlFor={id} className="sr-only">
        Project
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => {
          const target = hrefFor[event.target.value];
          if (target) router.push(target);
        }}
      >
        <option value="">All projects</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.projectNumber} · {project.title}
          </option>
        ))}
      </select>
    </div>
  );
}
