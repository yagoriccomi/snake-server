# syntax=docker/dockerfile:1
# =============================================================
#  snakethai-api — build multi-stage
#  A imagem final carrega SÓ o runtime + o JS compilado:
#  nada de TypeScript, devDependencies ou fonte. [#85]
#  O MESMO Dockerfile roda local (compose) e na Render — paridade. [#79][#81]
# =============================================================

# Imagem fixada por DIGEST, não por tag.
# Uma tag pode ser reapontada para outra imagem sem que este arquivo mude —
# o digest torna o build reproduzível e impede troca silenciosa da base. [#62]
# Para atualizar: docker pull node:<tag> && docker inspect node:<tag> --format '{{index .RepoDigests 0}}'
ARG NODE_IMAGE=node:22.14-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944

# ─────────────────────────────────────────────────────────────
#  Stage: base — versão do Node fixada, uma única fonte de verdade
# ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# ─────────────────────────────────────────────────────────────
#  Stage: deps — TODAS as dependências (inclui dev, para compilar)
#  Copiar só os manifests primeiro preserva o cache da layer
#  quando apenas o código-fonte muda.
# ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
# Sem --ignore-scripts aqui de propósito: esbuild (via vitest/tsx) precisa do
# script de instalação para baixar o binário da plataforma. Este stage NÃO vai
# para a imagem final — só o dist compilado por ele viaja adiante.
RUN npm ci

# ─────────────────────────────────────────────────────────────
#  Stage: dev — usado pelo docker-compose.yml (hot reload)
#  O código vem por bind mount; aqui só ficam as dependências.
# ─────────────────────────────────────────────────────────────
FROM deps AS dev
ENV NODE_ENV=development
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ─────────────────────────────────────────────────────────────
#  Stage: build — TypeScript → dist/
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ─────────────────────────────────────────────────────────────
#  Stage: prod-deps — árvore de dependências SEM as de dev
# ─────────────────────────────────────────────────────────────
FROM base AS prod-deps
COPY package.json package-lock.json* ./
# --ignore-scripts: nenhuma dependência de PRODUÇÃO (cloudinary, cors, express,
# express-rate-limit, helmet, zod) declara install script — verificado no
# package-lock. Com isso, nada de terceiros executa código arbitrário durante o
# build da árvore que efetivamente vai para a imagem. [#62][#55]
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ─────────────────────────────────────────────────────────────
#  Stage: runtime — o que efetivamente vai para produção
# ─────────────────────────────────────────────────────────────
FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000

# tini vira o PID 1: encaminha SIGTERM e evita processos zumbis.
# A Render envia SIGTERM ao hibernar/redeploy — sem isso o shutdown é sujo.
RUN apk add --no-cache tini

COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

# Menor privilégio: o processo NUNCA roda como root. [#55]
USER node

EXPOSE 3000

# Health check do container. Bate no /health, que é trivial e sem I/O —
# o mesmo endpoint que a Render usa e que o app chama para "acordar" o servidor. [#82]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
