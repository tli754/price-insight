FROM node:22-alpine AS base
RUN npm install -g pnpm turbo
WORKDIR /app

FROM base AS builder
# Copy workspace manifests for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/frontend/package.json ./apps/frontend/

# Install only frontend dependencies
RUN pnpm install --filter @price-insight/frontend --frozen-lockfile

# Copy source and build
COPY apps/frontend/ ./apps/frontend/
# nuxt.config.ts reads NUXT_BACKEND_URL/NUXT_LEADS_URL at build time to bake the
# /api, /auth and /leads-api proxy targets into the Nitro output — they must be
# the real service URLs, not the container-runtime defaults, or every deployed
# image silently proxies to localhost.
ARG NUXT_BACKEND_URL=http://localhost:4000
ARG NUXT_LEADS_URL=http://localhost:4100
RUN NUXT_BACKEND_URL=$NUXT_BACKEND_URL NUXT_LEADS_URL=$NUXT_LEADS_URL pnpm turbo build --filter @price-insight/frontend

FROM node:22-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=builder /app/apps/frontend/.output ./.output
RUN chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
