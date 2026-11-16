FROM node:22-alpine AS builder
WORKDIR /app

# Install npm workspaces deps
COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY tsconfig.base.json ./
RUN npm ci

# Copy source
COPY apps/api/ ./apps/api/

# Build
WORKDIR /app/apps/api
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

# Use non-root user for security (Requirement)
RUN addgroup -S appgroup -g 1001 && adduser -S appuser -G appgroup -u 1001

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
RUN npm ci --omit=dev
# The app runs with plain `node`; drop the package managers bundled in the base image so their
# dependencies (which Trivy flags) are not shipped.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \n    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \n    /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=builder /app/apps/api/dist ./apps/api/dist

# bcrypt and DNS lookups (so new database/Redis connections) share Node's libuv thread pool, 4
# threads by default. A burst of logins used to occupy all of them and stall every other request
# (docs/load-testing.md); the API also caps concurrent bcrypt work (security/passwords.ts).
ENV UV_THREADPOOL_SIZE=16

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
