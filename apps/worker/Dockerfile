FROM node:20-alpine AS builder
WORKDIR /app

# Install npm workspaces deps
COPY package*.json ./
COPY apps/worker/package.json ./apps/worker/
COPY tsconfig.base.json ./
RUN npm install

# Copy source
COPY apps/worker/ ./apps/worker/

# Build
WORKDIR /app/apps/worker
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# Use non-root user for security (Requirement)
RUN addgroup -S appgroup -g 1001 && adduser -S appuser -G appgroup -u 1001

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
RUN npm install --omit=dev

COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

USER appuser
CMD ["node", "apps/worker/dist/index.js"]
