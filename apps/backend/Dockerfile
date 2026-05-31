FROM node:22-alpine AS base
RUN npm install -g pnpm turbo
WORKDIR /app

FROM base AS builder
# Copy workspace manifests for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/backend/package.json ./apps/backend/

# Install only backend dependencies
RUN pnpm install --filter @price-insight/backend --frozen-lockfile

# Copy source and build
COPY apps/backend/ ./apps/backend/
COPY prompts/ ./prompts/
RUN pnpm turbo build --filter @price-insight/backend

FROM node:22-alpine AS runner
RUN apk add --no-cache tini
RUN npm install -g pnpm
WORKDIR /app

# Copy workspace manifests so pnpm can resolve the lockfile
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/backend/package.json ./apps/backend/

# Install production dependencies only
RUN pnpm install --filter @price-insight/backend --prod --frozen-lockfile

COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=builder /app/prompts ./prompts

RUN chown -R node:node /app
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/backend
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
