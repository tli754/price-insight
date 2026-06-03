FROM node:22-alpine AS base
RUN npm install -g pnpm turbo
WORKDIR /app

FROM base AS builder
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/gateway/package.json ./apps/gateway/

RUN pnpm install --filter @price-insight/gateway --frozen-lockfile

COPY apps/gateway/ ./apps/gateway/
RUN pnpm turbo build --filter @price-insight/gateway

FROM node:22-alpine AS runner
RUN apk add --no-cache tini
RUN npm install -g pnpm
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/gateway/package.json ./apps/gateway/

RUN pnpm install --filter @price-insight/gateway --prod --frozen-lockfile

COPY --from=builder /app/apps/gateway/dist ./apps/gateway/dist

RUN chown -R node:node /app
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/gateway
EXPOSE 4001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
