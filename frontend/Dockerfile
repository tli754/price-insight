FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=builder /app/.output ./.output
RUN chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
