FROM node:22-alpine AS builder
WORKDIR /app

# Install npm workspaces deps
COPY package*.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY tsconfig.base.json ./
RUN npm install

# Copy source
COPY apps/frontend/ ./apps/frontend/
# attachments.test.ts imports the server's allowlist (relative, on purpose) and `next build`
# type-checks it, so that one file has to be present in the build stage.
COPY apps/api/src/attachments/policy.ts ./apps/api/src/attachments/policy.ts

# Build
WORKDIR /app/apps/frontend
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

# Use non-root user for security (Requirement)
RUN addgroup -S appgroup -g 1001 && adduser -S appuser -G appgroup -u 1001

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
