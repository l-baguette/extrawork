# Multi-stage build — report §11.1: "Worker as a second process from the same
# image", and the web app deployed separately.
#
# One dependency install and one TypeScript build are shared by every target, so
# the API and worker are guaranteed to run identical domain code.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# --- Dependencies -----------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/application/package.json packages/application/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/files/package.json packages/files/
COPY packages/integrations/package.json packages/integrations/
COPY packages/observability/package.json packages/observability/
COPY packages/runtime/package.json packages/runtime/
COPY packages/testkit/package.json packages/testkit/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

# --- Build ------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm build:server

# --- API --------------------------------------------------------------------
FROM base AS server
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]

# --- Worker -----------------------------------------------------------------
# Chromium is only needed here: the worker renders evidence PDFs (report §8.5).
FROM base AS worker
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates fonts-liberation fonts-noto-core fonts-noto-color-emoji \
     libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
     libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
     libpango-1.0-0 libcairo2 libasound2 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
RUN pnpm exec playwright install chromium
USER node
CMD ["node", "apps/worker/dist/main.js"]

# --- Web --------------------------------------------------------------------
FROM deps AS web-build
COPY . .
RUN pnpm --filter @extrawork/web build

FROM base AS web
ENV NODE_ENV=production
COPY --from=web-build /app /app
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@extrawork/web", "start"]
