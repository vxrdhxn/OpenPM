FROM node:22-alpine AS builder
WORKDIR /app

# Install npm workspaces deps
COPY package*.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY tsconfig.base.json ./
RUN npm ci

# Copy source
COPY apps/frontend/ ./apps/frontend/
# attachments.test.ts imports the server's allowlist (relative, on purpose) and `next build`
# type-checks it, so that one file has to be present in the build stage.
COPY apps/api/src/attachments/policy.ts ./apps/api/src/attachments/policy.ts

# Browser-side URLs are inlined at build time (see src/lib/endpoints.ts). Leave them empty for an
# image that works on any domain behind the Helm chart's Ingress (same-origin /api and /ws); set them
# when the API lives on another origin, as Docker Compose does.
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_WS_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

# Build
WORKDIR /app/apps/frontend
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

# Use non-root user for security (Requirement)
RUN addgroup -S appgroup -g 1001 && adduser -S appuser -G appgroup -u 1001

# The app runs with plain `node`; drop the package managers bundled in the base image so their
# dependencies (which Trivy flags) are not shipped.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Copy standalone build output
COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static

USER appuser
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/ || exit 1

CMD ["node", "apps/frontend/server.js"]
