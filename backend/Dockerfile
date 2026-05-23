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
RUN npm ci --omit=dev && \
    npm install --no-save drizzle-kit && \
    npm cache clean --force
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/drizzle.config.ts ./
COPY --from=builder /app/backend/src/db ./src/db
COPY prompts/ /app/prompts/
COPY --from=builder /app/backend/start.sh ./start.sh
RUN chown -R node:node /app && chmod +x /app/backend/start.sh
ENV NODE_ENV=production
USER node
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "start.sh"]
