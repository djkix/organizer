# syntax=docker/dockerfile:1.7
# Images d'Organizer : api, worker, web, sortie. Contexte : la racine du dépôt (voir .dockerignore).
# Construites par la CI (.github/workflows/ci.yml) ; publiées sur GHCR à chaque étiquette v*.

ARG NODE_IMAGE=node:22.22-alpine3.22
ARG CADDY_IMAGE=caddy:2.10-alpine
ARG ALPINE_IMAGE=alpine:3.22

# Manifestes seulement : la couche d'installation ne bouge que si les dépendances changent.
FROM ${NODE_IMAGE} AS outils
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /depot
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma packages/db/prisma

FROM outils AS construction
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @organizer/api --filter @organizer/worker build \
 && pnpm --filter @organizer/web build \
 && node apps/web/scripts/entetes.mjs caddy apps/web/build/index.html > /csp.caddy

# Dépendances de production, même verrou ; le client Prisma est généré ici (postinstall de @organizer/db).
FROM outils AS dependances-api
RUN pnpm install --frozen-lockfile --prod --filter @organizer/api...

FROM outils AS dependances-worker
RUN pnpm install --frozen-lockfile --prod --filter @organizer/worker...

FROM ${NODE_IMAGE} AS base-node
RUN apk add --no-cache openssl tini
WORKDIR /app
ENV NODE_ENV=production PROMPTS_DIR=/app/prompts CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
COPY prompts /app/prompts
LABEL org.opencontainers.image.source=https://github.com/djkix/organizer
ENTRYPOINT ["/sbin/tini", "--"]

FROM base-node AS api
RUN apk add --no-cache ffmpeg
# Ni npm, ni npx, ni corepack à l'exécution (le CVE de tar est dans npm) : tout passe par node.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=dependances-api /depot /app
COPY --from=construction /depot/apps/api/dist /app/apps/api/dist
USER 1000:1000
EXPOSE 3000
CMD ["node", "apps/api/dist/main.mjs"]

FROM base-node AS worker
# Ni npm, ni npx, ni corepack à l'exécution (le CVE de tar est dans npm) : tout passe par node.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=dependances-worker /depot /app
COPY --from=construction /depot/apps/worker/dist /app/apps/worker/dist
USER 1000:1000
CMD ["node", "apps/worker/dist/main.mjs"]

FROM ${CADDY_IMAGE} AS web
# Racine en lecture seule : Caddy range son état éventuel dans /tmp (tmpfs).
ENV XDG_DATA_HOME=/tmp XDG_CONFIG_HOME=/tmp
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=construction /csp.caddy /etc/caddy/csp.caddy
COPY --from=construction /depot/apps/web/build /srv
LABEL org.opencontainers.image.source=https://github.com/djkix/organizer
USER 1000:1000
EXPOSE 8080

FROM ${ALPINE_IMAGE} AS sortie
RUN apk add --no-cache squid
COPY infra/sortie/squid.conf /etc/squid/squid.conf
LABEL org.opencontainers.image.source=https://github.com/djkix/organizer
USER squid
EXPOSE 3128
CMD ["squid", "-N", "-d", "1", "-f", "/etc/squid/squid.conf"]
