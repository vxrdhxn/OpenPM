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
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \n    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \n    /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

USER appuser
CMD ["node", "apps/worker/dist/index.js"]
