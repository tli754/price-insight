FROM node:22-alpine AS base
RUN npm install -g pnpm turbo
WORKDIR /app

FROM base AS builder
# Copy workspace manifests for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/leads/package.json ./apps/leads/

# Install only leads dependencies
RUN pnpm install --filter @price-insight/leads --frozen-lockfile

# Copy source and build
COPY apps/leads/ ./apps/leads/
RUN pnpm turbo build --filter @price-insight/leads

FROM node:22-alpine AS runner
RUN apk add --no-cache tini
RUN npm install -g pnpm
WORKDIR /app

# Copy workspace manifests so pnpm can resolve the lockfile
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/leads/package.json ./apps/leads/

# Install production dependencies only
RUN pnpm install --filter @price-insight/leads --prod --frozen-lockfile

COPY --from=builder /app/apps/leads/dist ./apps/leads/dist

RUN chown -R node:node /app
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/leads
EXPOSE 4100
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
