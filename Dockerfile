# syntax=docker/dockerfile:1.7
# One Dockerfile, three runtime targets: api, bot, web.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# API and bot are bundled into single files (workspace packages included), so the runtime
# images need no node_modules at all.
RUN npm run build -w @navbat/api && npm run build -w @navbat/bot
ARG VITE_API_URL=""
ARG VITE_BUSINESS_SLUG=demo
ARG VITE_BOT_USERNAME=""
ENV VITE_API_URL=$VITE_API_URL VITE_BUSINESS_SLUG=$VITE_BUSINESS_SLUG VITE_BOT_USERNAME=$VITE_BOT_USERNAME
RUN npm run build -w @navbat/web

FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/main.js"]

FROM node:22-alpine AS bot
WORKDIR /app
ENV NODE_ENV=production HEARTBEAT_FILE=/tmp/navbat-bot-heartbeat
COPY --from=build /app/apps/bot/dist ./dist
USER node
# The worker touches the heartbeat file on every tick (every 15 s).
HEALTHCHECK --interval=20s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "const s=require('fs').statSync(process.env.HEARTBEAT_FILE);process.exit(Date.now()-s.mtimeMs<60000?0:1)"
CMD ["node", "dist/main.js"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
