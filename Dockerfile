FROM node:24.21.0-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps ./apps
RUN pnpm build

FROM build AS api-package
RUN pnpm --filter @blackwood/api deploy --prod --legacy /out/api

FROM node:24.21.0-bookworm-slim AS api
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
WORKDIR /app
COPY --from=api-package --chown=node:node /out/api ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM caddy:2.11.7-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/web/dist /srv
