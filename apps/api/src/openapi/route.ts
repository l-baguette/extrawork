import type { FastifyInstance } from 'fastify';
import { buildOpenApiDocument } from './document.js';

/** Serves the generated contract plus a dependency-free viewer. */
export async function registerOpenApiRoute(app: FastifyInstance): Promise<void> {
  const document = buildOpenApiDocument();

  app.get('/openapi.json', async (_request, reply) =>
    reply.header('cache-control', 'public, max-age=300').send(document),
  );

  // A tiny self-contained index. Report §11.3 forbids third-party scripts on
  // approval pages; the same rule is applied here for consistency, so this is
  // plain HTML with no CDN dependency.
  app.get('/docs', async (_request, reply) => {
    const paths = document.paths as Record<
      string,
      Record<string, { summary?: string; tags?: string[] }>
    >;
    const rows = Object.entries(paths)
      .flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, op]) => ({
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? '',
          tag: op.tags?.[0] ?? '',
        })),
      )
      .sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path));

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ExtraWork API</title>
<style>
  :root{color-scheme:light dark}
  body{font:15px/1.5 system-ui,-apple-system,sans-serif;margin:0;padding:2rem;max-width:60rem}
  h1{font-size:1.4rem;margin:0 0 .25rem}
  p{color:#666;margin:0 0 1.5rem}
  table{border-collapse:collapse;width:100%}
  th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #8883;vertical-align:top}
  code{font:13px ui-monospace,monospace}
  .m{font-weight:600;font-size:12px;padding:.1rem .35rem;border:1px solid #8886;border-radius:3px}
  tr[data-t]:first-child{border-top:2px solid #8886}
</style></head><body>
<h1>ExtraWork API</h1>
<p>Machine-readable contract: <a href="/openapi.json">/openapi.json</a></p>
<table><thead><tr><th>Tag</th><th>Method</th><th>Path</th><th>Summary</th></tr></thead><tbody>
${rows
  .map(
    (r) =>
      `<tr data-t="${escapeHtml(r.tag)}"><td>${escapeHtml(r.tag)}</td><td><span class="m">${r.method}</span></td><td><code>${escapeHtml(r.path)}</code></td><td>${escapeHtml(r.summary)}</td></tr>`,
  )
  .join('\n')}
</tbody></table></body></html>`;

    return reply.type('text/html; charset=utf-8').send(html);
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
