# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY apps apps
RUN npm run db:generate && npm run build

# The migration job needs the Prisma CLI; it is not included in the API runtime.
FROM build AS migrate
WORKDIR /app/apps/api
USER node
CMD ["npm", "run", "db:migrate"]

FROM build AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM base AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/storage && chown node:node /app/storage
WORKDIR /app/apps/api
USER node
EXPOSE 3001
CMD ["node", "src/server.ts"]

FROM nginx:1.28-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
