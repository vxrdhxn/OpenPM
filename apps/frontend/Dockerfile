FROM node:20-alpine AS builder
WORKDIR /app

# Install npm workspaces deps
COPY package*.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY tsconfig.base.json ./
RUN npm install

# Copy source
COPY apps/frontend/ ./apps/frontend/

# Build
WORKDIR /app/apps/frontend
RUN npm run build

FROM node:20-alpine AS runner
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

CMD ["node", "apps/frontend/server.js"]
