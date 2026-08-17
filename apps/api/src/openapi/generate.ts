#!/usr/bin/env tsx
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from './document.js';

/**
 * Writes `docs/openapi/openapi.json`. CI runs this and fails if the working
 * tree changes, so the committed contract can never drift from the schemas
 * (report §7.2, §11.4).
 */
const outputDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/openapi',
);

await mkdir(outputDir, { recursive: true });
const target = path.join(outputDir, 'openapi.json');
await writeFile(target, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`, 'utf8');
process.stdout.write(`OpenAPI written to ${target}\n`);
