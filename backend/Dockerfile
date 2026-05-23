FROM node:22-alpine AS builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:22-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app/backend
COPY --from=builder /app/backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/drizzle ./drizzle
COPY prompts/ /app/prompts/
RUN chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
