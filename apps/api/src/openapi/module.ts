import type { z } from 'zod';

/**
 * Feature modules contribute paths and component schemas to the generated
 * document without editing one shared object literal — the three-party
 * workspace (spec 2026-10-12) arrived as several parallel slices, and this is
 * what keeps them from colliding in `document.ts`.
 */

export type JsonObject = Record<string, unknown>;

export interface OpenApiHelpers {
  schemaRef(name: string): JsonObject;
  jsonBody(name: string, required?: boolean): JsonObject;
  jsonResponse(description: string, name?: string): JsonObject;
  errorResponse(description: string): JsonObject;
  commonErrors: JsonObject;
  pathParam(name: string, description: string): JsonObject;
}

export interface OpenApiModule {
  schemas: Record<string, z.ZodTypeAny>;
  paths(helpers: OpenApiHelpers): JsonObject;
}
