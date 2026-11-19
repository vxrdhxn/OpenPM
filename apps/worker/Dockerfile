FROM node:22-alpine AS builder
WORKDIR /app

# Install npm workspaces deps
COPY package*.json ./
COPY apps/worker/package.json ./apps/worker/
COPY tsconfig.base.json ./
RUN npm ci

# Copy source
COPY apps/worker/ ./apps/worker/

# Build
WORKDIR /app/apps/worker
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

# Use non-root user for security (Requirement)
RUN addgroup -S appgroup -g 1001 && adduser -S appuser -G appgroup -u 1001

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
RUN npm ci --omit=dev
# The app runs with plain `node`; drop the package managers bundled in the base image so their
# dependencies (which Trivy flags) are not shipped.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

USER appuser

# The worker has no API port; its metrics server answers /healthz (process up, event loop responsive).
# It does not depend on Postgres or Redis, so an outage of either never marks the worker unhealthy:
# it keeps retrying jobs instead of being restarted in a loop (docs/jobs.md).
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${METRICS_PORT:-9100}/healthz" || exit 1

CMD ["node", "apps/worker/dist/index.js"]
