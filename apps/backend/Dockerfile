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
WORKDIR /app/apps/backend

COPY --from=builder /app/apps/backend/package.json ./
RUN pnpm install --prod --frozen-lockfile || true
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/drizzle ./drizzle
COPY --from=builder /app/prompts /app/prompts

RUN chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
